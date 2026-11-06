/**
 * Testes de ponta a ponta da camada de dados + serviços, num PostgreSQL real
 * (PGlite) com as migrations de produção. Cobre os 11 cenários do item 12.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { deriveActivationCode, formatActivationCode, generatePublicCode } from "@/lib/codes";
import { activateBrooch, changeDestination } from "@/lib/services/activation";
import { processBatchChunk, CURRENT_CODE_VERSION } from "@/lib/services/generation";
import { decideRedirect } from "@/lib/redirect";
import { nextStatus, type BroochForTransition, type StatusAction } from "@/lib/brooches/transitions";
import { DomainError } from "@/lib/store/types";
import { asRole, createDb, createUser, type Db } from "./harness";
import { PgliteStore } from "./pglite-store";

const SECRET = "test-activation-secret-0123456789abcdef";
const PEPPER = "test-activation-pepper-0123456789abcdef";
const APP = "https://brochelink.test.app";
const GEN = { chunkSize: 4, codeSecret: SECRET, pepper: PEPPER };
const ACT = { pepper: PEPPER, maxAttempts: 3, lockSeconds: 900, appHosts: ["brochelink.test.app"] };

let db: Db;
let store: PgliteStore;
let adminId: string;
let aliceId: string;
let bobId: string;

async function runBatch(quantity: number, key = crypto.randomUUID()) {
  let batch = await store.createBatch({ createdBy: adminId, quantity, idempotencyKey: key });
  let guard = 0;
  while (batch.status !== "completed") {
    batch = await processBatchChunk(store, batch.id, GEN);
    if (++guard > 10_000) throw new Error("loop");
  }
  return batch;
}

async function broochesOf(batchId: string) {
  return (
    await db.query<{ id: string; public_code: string; status: string; sequence_in_batch: number }>(
      `select id, public_code, status, sequence_in_batch from public.brooches where batch_id = $1 order by sequence_in_batch`,
      [batchId],
    )
  ).rows;
}

beforeAll(async () => {
  db = await createDb();
  store = new PgliteStore(db);
  adminId = await createUser(db, "admin@brochelink.test", { role: "admin" }); // tentativa de escalonamento no signup
  aliceId = await createUser(db, "alice@example.com", { full_name: "Alice" });
  bobId = await createUser(db, "bob@example.com");
  await db.query(`select public.promote_to_admin('admin@brochelink.test')`); // procedimento seguro (SQL Editor)
});

describe("perfis e papel administrativo", () => {
  it("cadastro sempre cria proprietário, mesmo que o signup envie role=admin", async () => {
    const id = await createUser(db, "mallory@example.com", { role: "admin" });
    const { rows } = await db.query<{ role: string }>(`select role from public.profiles where id = $1`, [id]);
    expect(rows[0].role).toBe("owner");
  });

  it("usuário não consegue se promover a admin pela API", async () => {
    await expect(
      asRole(db, "authenticated", aliceId, () => db.query(`update public.profiles set role = 'admin' where id = $1`, [aliceId])),
    ).rejects.toThrow();
    const { rows } = await db.query<{ role: string }>(`select role from public.profiles where id = $1`, [aliceId]);
    expect(rows[0].role).toBe("owner");
  });

  it("promote_to_admin não é executável por nenhum papel da API", async () => {
    for (const role of ["anon", "authenticated", "service_role"] as const) {
      await expect(asRole(db, role, aliceId, () => db.query(`select public.promote_to_admin('alice@example.com')`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("usuário pode editar o próprio nome", async () => {
    await asRole(db, "authenticated", aliceId, () =>
      db.query(`update public.profiles set full_name = 'Alice B.' where id = $1`, [aliceId]),
    );
    const { rows } = await db.query<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [aliceId]);
    expect(rows[0].full_name).toBe("Alice B.");
  });
});

describe("1–4. geração de broches", () => {
  it("1. gera um único broche", async () => {
    const batch = await runBatch(1);
    expect(batch.generated_quantity).toBe(1);
    const [b] = await broochesOf(batch.id);
    expect(b.public_code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
    expect(b.status).toBe("available");
  });

  it("2. gera o lote inicial de 10 broches, em partes, com credenciais com hash", async () => {
    const batch = await runBatch(10);
    expect(batch.status).toBe("completed");
    expect(batch.generated_quantity).toBe(10);
    expect(batch.completed_at).not.toBeNull();
    const rows = await broochesOf(batch.id);
    expect(rows.map((r) => r.sequence_in_batch)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const creds = await db.query<{ code_hash: string }>(
      `select c.code_hash from public.activation_credentials c join public.brooches b on b.id = c.brooch_id where b.batch_id = $1`,
      [batch.id],
    );
    expect(creds.rows).toHaveLength(10);
    // o código em texto puro nunca é armazenado
    for (const [i, r] of rows.entries()) {
      const code = deriveActivationCode(SECRET, r.id, 1);
      expect(creds.rows[i].code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(creds.rows.some((c) => c.code_hash.includes(code))).toBe(false);
    }
  });

  it("3. gera novos lotes depois, sem alterar código nem estrutura, e os antigos continuam válidos", async () => {
    const first = await runBatch(3);
    const before = await broochesOf(first.id);
    const later = await runBatch(7);
    expect(later.generated_quantity).toBe(7);
    const after = await broochesOf(first.id);
    expect(after).toEqual(before);
    for (const b of before) {
      const r = await store.registerScan({ publicCode: b.public_code, ipHash: null, userAgent: null, country: null, record: false });
      expect(r?.status).toBe("available");
    }
  });

  it("idempotência: repetir a criação com a mesma chave devolve o mesmo lote", async () => {
    const key = crypto.randomUUID();
    const a = await store.createBatch({ createdBy: adminId, quantity: 5, idempotencyKey: key });
    const b = await store.createBatch({ createdBy: adminId, quantity: 5, idempotencyKey: key });
    expect(b.id).toBe(a.id);
    // cliques repetidos no "processar" não duplicam
    await Promise.all([processBatchChunk(store, a.id, { ...GEN, chunkSize: 10 }), processBatchChunk(store, a.id, { ...GEN, chunkSize: 10 })]);
    const done = await processBatchChunk(store, a.id, { ...GEN, chunkSize: 10 });
    expect(done.generated_quantity).toBe(5);
    expect(await broochesOf(a.id)).toHaveLength(5);
  });

  it("idempotência: mesma chave com parâmetros diferentes é recusada", async () => {
    const key = crypto.randomUUID();
    await store.createBatch({ createdBy: adminId, quantity: 2, idempotencyKey: key });
    await expect(store.createBatch({ createdBy: adminId, quantity: 3, idempotencyKey: key })).rejects.toBeInstanceOf(DomainError);
  });

  it("4. unicidade: o banco rejeita identificadores repetidos e a geração tenta outro", async () => {
    const existing = (await db.query<{ public_code: string }>(`select public_code from public.brooches limit 1`)).rows[0].public_code;
    await expect(
      db.query(`insert into public.brooches (public_code) values ($1)`, [existing]),
    ).rejects.toThrow(/brooches_public_code_key/);

    // força colisão na primeira tentativa
    let calls = 0;
    const generateCode = () => (calls++ === 0 ? existing : generatePublicCode());
    const batch = await store.createBatch({ createdBy: adminId, quantity: 1, idempotencyKey: crypto.randomUUID() });
    const done = await processBatchChunk(store, batch.id, { ...GEN, generateCode });
    expect(done.status).toBe("completed");
    expect(calls).toBeGreaterThan(1);
    const { rows } = await db.query<{ n: number; d: number }>(
      `select count(*)::int as n, count(distinct public_code)::int as d from public.brooches`,
    );
    expect(rows[0].n).toBe(rows[0].d);
  });

  it("não existe limite global: quantidade é qualquer inteiro positivo", async () => {
    const big = await store.createBatch({ createdBy: adminId, quantity: 10_000_000, idempotencyKey: crypto.randomUUID() });
    expect(big.requested_quantity).toBe(10_000_000);
    await expect(store.createBatch({ createdBy: adminId, quantity: 0, idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
  });
});

describe("10–11. lotes grandes e recuperação", () => {
  it("10. processa um lote grande em partes limitadas (cada chamada ≤ chunkSize)", async () => {
    const batch = await store.createBatch({ createdBy: adminId, quantity: 1234, idempotencyKey: crypto.randomUUID() });
    store.calls = [];
    let b = batch;
    let rounds = 0;
    while (b.status !== "completed") {
      b = await processBatchChunk(store, batch.id, { ...GEN, chunkSize: 250 });
      rounds++;
    }
    expect(rounds).toBe(5);
    expect(store.calls.every((c) => Number(c.split(":")[1]) <= 250)).toBe(true);
    expect(b.generated_quantity).toBe(1234);
    // paginação keyset por created_at/id funciona sobre o lote
    const page1 = await db.query<{ sequence_in_batch: number }>(
      `select sequence_in_batch from public.brooches where batch_id = $1 order by sequence_in_batch limit 100 offset 0`,
      [batch.id],
    );
    const last = await db.query<{ sequence_in_batch: number }>(
      `select sequence_in_batch from public.brooches where batch_id = $1 order by sequence_in_batch limit 100 offset 1200`,
      [batch.id],
    );
    expect(page1.rows).toHaveLength(100);
    expect(last.rows.map((r) => r.sequence_in_batch).at(-1)).toBe(1234);
  });

  it("11. recupera após falha parcial (broches inseridos, credenciais não)", async () => {
    const batch = await store.createBatch({ createdBy: adminId, quantity: 6, idempotencyKey: crypto.randomUUID() });
    store.failNextCredentialInsert = true;
    await expect(processBatchChunk(store, batch.id, GEN)).rejects.toThrow(/falha simulada/);

    const failed = await store.getBatch(batch.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.generated_quantity).toBe(0); // broches sem credencial não contam
    expect(await broochesOf(batch.id)).toHaveLength(4);

    let b = await processBatchChunk(store, batch.id, GEN); // retoma
    while (b.status !== "completed") b = await processBatchChunk(store, batch.id, GEN);
    expect(b.generated_quantity).toBe(6);
    expect(b.last_error).toBeNull();
    const rows = await broochesOf(batch.id);
    expect(rows.map((r) => r.sequence_in_batch)).toEqual([1, 2, 3, 4, 5, 6]);
    const missing = await store.broochesMissingCredentials(batch.id, 100);
    expect(missing).toHaveLength(0);
  });
});

describe("5–9. ativação, redirecionamento, destino, status e acesso", () => {
  let broochId: string;
  let publicCode: string;
  let code: string;

  beforeAll(async () => {
    const batch = await runBatch(2);
    const [b] = await broochesOf(batch.id);
    broochId = b.id;
    publicCode = b.public_code;
    code = deriveActivationCode(SECRET, b.id, CURRENT_CODE_VERSION);
  });

  it("6a. antes da ativação, a leitura leva à página de ativação", async () => {
    const r = await store.registerScan({ publicCode, ipHash: "x", userAgent: "ua", country: "br", record: true });
    expect(decideRedirect(r, APP, publicCode)).toEqual({ status: 302, location: `${APP}/ativar/${publicCode}`, kind: "activation" });
  });

  it("5a. código errado consome tentativas e bloqueia após o limite", async () => {
    const wrong = { publicCode, activationCode: "AAAA-AAAA-AAAA", destinationUrl: "https://example.com", userId: bobId };
    const r1 = await activateBrooch(store, wrong, ACT);
    expect(r1).toMatchObject({ ok: false, error: "invalid_code", remainingAttempts: 2 });
    await activateBrooch(store, wrong, ACT);
    const r3 = await activateBrooch(store, wrong, ACT);
    expect(r3).toMatchObject({ ok: false, error: "invalid_code", remainingAttempts: 0 });
    // mesmo com o código CERTO, está bloqueado
    const blocked = await activateBrooch(store, { ...wrong, activationCode: code }, ACT);
    expect(blocked).toMatchObject({ ok: false, error: "locked" });
    // destrava (simula passagem do tempo)
    await db.query(`update public.activation_credentials set locked_until = now() - interval '1 second' where brooch_id = $1`, [broochId]);
  });

  it("5b. rejeita destino inseguro sem consumir tentativa", async () => {
    const r = await activateBrooch(store, { publicCode, activationCode: code, destinationUrl: "http://example.com", userId: aliceId }, ACT);
    expect(r).toMatchObject({ ok: false, error: "invalid_url", reason: "not_https" });
    await db.query(`insert into public.blocked_domains (domain) values ('malware.example.net')`);
    const r2 = await activateBrooch(
      store,
      { publicCode, activationCode: code, destinationUrl: "https://x.malware.example.net/a", userId: aliceId },
      ACT,
    );
    expect(r2).toMatchObject({ ok: false, error: "invalid_url", reason: "blocked" });
  });

  it("5c. ativa com o código correto (formatado com hífens) e não permite reativação", async () => {
    const r = await activateBrooch(
      store,
      { publicCode, activationCode: formatActivationCode(code).toLowerCase(), destinationUrl: "https://alice.dev/portfolio", userId: aliceId },
      ACT,
    );
    expect(r).toEqual({ ok: true, broochId });
    const again = await activateBrooch(store, { publicCode, activationCode: code, destinationUrl: "https://evil.com", userId: bobId }, ACT);
    expect(again).toMatchObject({ ok: false, error: "not_available", alreadyYours: false });
    const hist = await db.query(`select * from public.destination_history where brooch_id = $1`, [broochId]);
    expect(hist.rows).toHaveLength(1);
  });

  it("5d. corrida: duas ativações simultâneas, só uma vence", async () => {
    const batch = await runBatch(1);
    const [b] = await broochesOf(batch.id);
    const c = deriveActivationCode(SECRET, b.id, 1);
    const results = await Promise.all([
      activateBrooch(store, { publicCode: b.public_code, activationCode: c, destinationUrl: "https://a.com", userId: aliceId }, ACT),
      activateBrooch(store, { publicCode: b.public_code, activationCode: c, destinationUrl: "https://b.com", userId: bobId }, ACT),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("6b. após ativar, qualquer leitura é redirecionada (302) e contabilizada", async () => {
    const r = await store.registerScan({ publicCode, ipHash: "h", userAgent: "Mozilla", country: "BR", record: true });
    expect(decideRedirect(r, APP, publicCode)).toEqual({ status: 302, location: "https://alice.dev/portfolio", kind: "destination" });
    const { rows } = await db.query<{ scan_count: number }>(`select scan_count::int from public.brooches where id = $1`, [broochId]);
    expect(rows[0].scan_count).toBe(2);
    expect(await store.registerScan({ publicCode: "ZZZZZZZZZZZZ", ipHash: null, userAgent: null, country: null, record: true })).toBeNull();
  });

  it("7. proprietário altera o destino; histórico registrado; próximas leituras usam o novo", async () => {
    const r = await changeDestination(store, { broochId, actorId: aliceId, actor: "owner", url: "https://alice.dev/novo" }, ACT);
    expect(r).toEqual({ ok: true, url: "https://alice.dev/novo", previous: "https://alice.dev/portfolio" });
    const scan = await store.registerScan({ publicCode, ipHash: null, userAgent: null, country: null, record: false });
    expect(scan?.destination_url).toBe("https://alice.dev/novo");
    const hist = await db.query<{ reason: string; old_url: string }>(
      `select reason, old_url from public.destination_history where brooch_id = $1 order by id`,
      [broochId],
    );
    expect(hist.rows.map((h) => h.reason)).toEqual(["activation", "owner_update"]);
    // outro usuário não pode alterar
    await expect(
      changeDestination(store, { broochId, actorId: bobId, actor: "owner", url: "https://bob.dev" }, ACT),
    ).rejects.toMatchObject({ code: "forbidden" });
    // URL inválida é recusada antes do banco
    expect(await changeDestination(store, { broochId, actorId: aliceId, actor: "owner", url: "https://127.0.0.1" }, ACT)).toEqual({
      ok: false,
      reason: "ip_address",
    });
  });

  it("8. suspensão e reativação (proprietário e admin)", async () => {
    expect(await store.setStatus(broochId, aliceId, "owner", "suspend")).toBe("suspended");
    let scan = await store.registerScan({ publicCode, ipHash: null, userAgent: null, country: null, record: true });
    expect(decideRedirect(scan, APP, publicCode).kind).toBe("suspended");
    expect(await store.setStatus(broochId, aliceId, "owner", "reactivate")).toBe("active");

    // suspensão administrativa: o proprietário não pode reativar
    expect(await store.setStatus(broochId, adminId, "admin", "suspend")).toBe("suspended");
    await expect(store.setStatus(broochId, aliceId, "owner", "reactivate")).rejects.toMatchObject({ code: "conflict" });
    expect(await store.setStatus(broochId, adminId, "admin", "reactivate")).toBe("active");

    // revogação é terminal
    const batch = await runBatch(1);
    const [b] = await broochesOf(batch.id);
    expect(await store.setStatus(b.id, adminId, "admin", "revoke")).toBe("revoked");
    await expect(store.setStatus(b.id, adminId, "admin", "reactivate")).rejects.toMatchObject({ code: "conflict" });
    scan = await store.registerScan({ publicCode: b.public_code, ipHash: null, userAgent: null, country: null, record: true });
    expect(decideRedirect(scan, APP, b.public_code).kind).toBe("revoked");
    // proprietário não pode revogar
    await expect(store.setStatus(broochId, aliceId, "owner", "revoke")).rejects.toMatchObject({ code: "conflict" });
  });

  it("8b. regras do front (transitions.ts) são idênticas às da função SQL", async () => {
    const cases: [BroochForTransition, "owner" | "admin", StatusAction][] = [];
    const statuses = ["available", "active", "suspended", "revoked"] as const;
    for (const status of statuses)
      for (const suspended_by of status === "suspended" ? (["owner", "admin", "system"] as const) : ([null] as const))
        for (const owned of [true, false])
          for (const actor of ["owner", "admin"] as const)
            for (const action of ["suspend", "reactivate", "revoke"] as const)
              cases.push([{ status, suspended_by, owner_id: owned ? aliceId : null, destination_url: owned ? "https://x.com" : null }, actor, action]);

    for (const [b, actor, action] of cases) {
      if (b.status === "active" && !b.owner_id) continue; // estado impossível (constraint)
      const id = (
        await db.query<{ id: string }>(
          `insert into public.brooches (public_code, status, owner_id, destination_url, suspended_by, revoked_at)
           values ($1, $2::public.brooch_status, $3, $4, $5::public.actor_kind, case when $2::text = 'revoked' then now() end) returning id`,
          [generatePublicCode(), b.status, b.owner_id, b.destination_url, b.suspended_by],
        )
      ).rows[0].id;
      const actorId = actor === "admin" ? adminId : aliceId;
      const expected = nextStatus(b, { kind: actor, id: actorId }, action);
      let got: string | null;
      try {
        got = await store.setStatus(id, actorId, actor, action);
      } catch {
        got = null;
      }
      expect({ b, actor, action, got }).toEqual({ b, actor, action, got: expected });
    }
  });

  it("9. RLS: cada usuário só vê os próprios broches; credenciais são inacessíveis", async () => {
    const asAlice = await asRole(db, "authenticated", aliceId, async () => (await db.query<{ owner_id: string }>(`select owner_id from public.brooches`)).rows);
    expect(asAlice.length).toBeGreaterThan(0);
    expect(asAlice.every((r) => r.owner_id === aliceId)).toBe(true);

    const asBob = await asRole(db, "authenticated", bobId, async () => (await db.query(`select * from public.brooches where id = $1`, [broochId])).rows);
    expect(asBob).toHaveLength(0);

    const asAnon = asRole(db, "anon", null, () => db.query(`select * from public.brooches`));
    await expect(asAnon).rejects.toThrow(/permission denied/);

    await expect(asRole(db, "authenticated", aliceId, () => db.query(`select * from public.activation_credentials`))).rejects.toThrow(
      /permission denied/,
    );

    const adminSees = await asRole(db, "authenticated", adminId, async () => (await db.query<{ n: number }>(`select count(*)::int n from public.brooches`)).rows[0].n);
    const total = (await db.query<{ n: number }>(`select count(*)::int n from public.brooches`)).rows[0].n;
    expect(adminSees).toBe(total);

    // estatísticas e histórico: dono vê, terceiro não
    const aliceScans = await asRole(db, "authenticated", aliceId, async () =>
      (await db.query(`select * from public.scan_events where brooch_id = $1`, [broochId])).rows,
    );
    const bobScans = await asRole(db, "authenticated", bobId, async () =>
      (await db.query(`select * from public.scan_events where brooch_id = $1`, [broochId])).rows,
    );
    expect(aliceScans.length).toBeGreaterThan(0);
    expect(bobScans).toHaveLength(0);
    const perDay = await asRole(db, "authenticated", aliceId, async () =>
      (await db.query<{ scans: number }>(`select scans::int from public.scans_per_day($1, 7)`, [broochId])).rows,
    );
    expect(perDay).toHaveLength(7);
    expect(perDay.reduce((s, r) => s + r.scans, 0)).toBe(aliceScans.length);
  });

  it("9b. usuários comuns não escrevem diretamente nem chamam RPCs de escrita", async () => {
    await expect(
      asRole(db, "authenticated", aliceId, () => db.query(`update public.brooches set destination_url = 'https://x.com' where id = $1`, [broochId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, "authenticated", aliceId, () => db.query(`insert into public.brooches (public_code) values ($1)`, [generatePublicCode()])),
    ).rejects.toThrow(/permission denied/);
    for (const sql of [
      `select public.create_generation_batch('${aliceId}', 5, 'abcdefgh-xyz', null)`,
      `select public.set_brooch_status('${broochId}', '${aliceId}', 'admin', 'revoke')`,
      `select public.activate_brooch('${broochId}', '${aliceId}', 'https://x.com', 1)`,
      `select * from public.register_scan('${publicCode}')`,
    ]) {
      await expect(asRole(db, "authenticated", aliceId, () => db.query(sql))).rejects.toThrow(/permission denied/);
    }
    await expect(asRole(db, "authenticated", aliceId, () => db.query(`select public.admin_overview()`))).rejects.toThrow(/forbidden/);
    const overview = await asRole(db, "authenticated", adminId, async () =>
      (await db.query<{ v: { total: number } }>(`select public.admin_overview() as v`)).rows[0].v,
    );
    expect(overview.total).toBeGreaterThan(0);
  });

  it("auditoria registra as ações e é somente-inserção", async () => {
    const { rows } = await db.query<{ action: string }>(`select distinct action from public.audit_logs`);
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["batch.create", "batch.complete", "brooch.activate", "brooch.destination_update", "brooch.suspend", "brooch.revoke", "profile.promote_admin"]));
    await expect(db.query(`delete from public.audit_logs`)).rejects.toThrow(/append-only/);
    await expect(db.query(`update public.audit_logs set action = 'x'`)).rejects.toThrow(/append-only/);
  });

  it("rate limit por janela", async () => {
    const key = `t:${crypto.randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await store.checkRateLimit(key, 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });

  it("exclusão de conta suspende os broches ativos do usuário", async () => {
    const carol = await createUser(db, "carol@example.com");
    const batch = await runBatch(1);
    const [b] = await broochesOf(batch.id);
    await activateBrooch(store, { publicCode: b.public_code, activationCode: deriveActivationCode(SECRET, b.id, 1), destinationUrl: "https://carol.dev", userId: carol }, ACT);
    await db.query(`delete from auth.users where id = $1`, [carol]);
    const scan = await store.registerScan({ publicCode: b.public_code, ipHash: null, userAgent: null, country: null, record: false });
    expect(scan?.status).toBe("suspended");
  });
});
