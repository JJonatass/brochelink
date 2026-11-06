/**
 * Store de testes: mesmas operações do SupabaseStore, executadas como
 * service_role contra as migrations reais carregadas no PGlite.
 */
import type { ActorKind, BroochStatus, StatusAction } from "@/lib/brooches/transitions";
import { DomainError, domainErrorFromSqlState, type Batch, type Credential, type Store } from "@/lib/store/types";
import { asRole, type Db } from "./harness";

type PgErr = { code?: string; message: string; constraint?: string };

export class PgliteStore implements Store {
  /** ganchos para injetar falhas em testes de recuperação */
  public failNextCredentialInsert = false;
  public calls: string[] = [];

  constructor(private readonly db: Db) {}

  private async q<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      return await asRole(this.db, "service_role", null, async () => (await this.db.query<T>(sql, params)).rows);
    } catch (e) {
      const err = e as PgErr;
      throw domainErrorFromSqlState(err.code, err.message);
    }
  }

  async createBatch(i: { createdBy: string; quantity: number; idempotencyKey: string; label?: string | null }) {
    const [b] = await this.q<Batch>(`select * from public.create_generation_batch($1, $2, $3, $4)`, [
      i.createdBy,
      i.quantity,
      i.idempotencyKey,
      i.label ?? null,
    ]);
    return b;
  }
  async getBatch(id: string) {
    return (await this.q<Batch>(`select * from public.generation_batches where id = $1`, [id]))[0] ?? null;
  }
  async maxSequence(batchId: string) {
    const [r] = await this.q<{ m: number | null }>(
      `select max(sequence_in_batch) as m from public.brooches where batch_id = $1`,
      [batchId],
    );
    return r.m ?? 0;
  }
  async insertBrooches(batchId: string, rows: { sequence: number; publicCode: string }[]) {
    this.calls.push(`insertBrooches:${rows.length}`);
    if (!rows.length) return;
    try {
      await asRole(this.db, "service_role", null, () =>
        this.db.query(
          `insert into public.brooches (batch_id, sequence_in_batch, public_code)
           select $1, s, c from unnest($2::int[], $3::text[]) as t(s, c)
           on conflict (batch_id, sequence_in_batch) do nothing`,
          [batchId, rows.map((r) => r.sequence), rows.map((r) => r.publicCode)],
        ),
      );
    } catch (e) {
      const err = e as PgErr;
      if (err.code === "23505" && (err.constraint ?? err.message).includes("public_code")) {
        throw new DomainError("collision", err.message);
      }
      throw domainErrorFromSqlState(err.code, err.message);
    }
  }
  async broochesMissingCredentials(batchId: string, limit: number) {
    return this.q<{ id: string }>(`select id from public.brooches_missing_credentials($1, $2)`, [batchId, limit]);
  }
  async insertCredentials(rows: { broochId: string; codeHash: string; codeVersion: number }[]) {
    if (this.failNextCredentialInsert) {
      this.failNextCredentialInsert = false;
      throw new Error("falha simulada de rede ao inserir credenciais");
    }
    if (!rows.length) return;
    await this.q(
      `insert into public.activation_credentials (brooch_id, code_hash, code_version)
       select * from unnest($1::uuid[], $2::text[], $3::int[])
       on conflict (brooch_id) do nothing`,
      [rows.map((r) => r.broochId), rows.map((r) => r.codeHash), rows.map((r) => r.codeVersion)],
    );
  }
  async syncBatch(batchId: string, error?: string | null) {
    const [b] = await this.q<Batch>(`select * from public.sync_batch_progress($1, $2)`, [batchId, error ?? null]);
    return b;
  }
  async findBroochByCode(publicCode: string) {
    return (
      (
        await this.q<{ id: string; status: BroochStatus; owner_id: string | null }>(
          `select id, status, owner_id from public.brooches where public_code = $1`,
          [publicCode],
        )
      )[0] ?? null
    );
  }
  async getCredential(broochId: string) {
    const [c] = await this.q<Credential & { locked_until: Date | null; used_at: Date | null }>(
      `select * from public.activation_credentials where brooch_id = $1`,
      [broochId],
    );
    if (!c) return null;
    return {
      ...c,
      locked_until: c.locked_until ? new Date(c.locked_until).toISOString() : null,
      used_at: c.used_at ? new Date(c.used_at).toISOString() : null,
    };
  }
  async registerFailedActivation(broochId: string, max: number, lock: number) {
    const [r] = await this.q<{ failed_attempts: number; locked_until: Date | null }>(
      `select * from public.register_failed_activation($1, $2, $3)`,
      [broochId, max, lock],
    );
    return r ? { failed_attempts: r.failed_attempts, locked_until: r.locked_until ? new Date(r.locked_until).toISOString() : null } : null;
  }
  async activateBrooch(broochId: string, userId: string, destination: string, version: number) {
    try {
      const [r] = await this.q<{ ok: boolean }>(`select public.activate_brooch($1, $2, $3, $4) as ok`, [
        broochId,
        userId,
        destination,
        version,
      ]);
      return r.ok;
    } catch (e) {
      if (e instanceof DomainError && e.code === "conflict") return false;
      throw e;
    }
  }
  async updateDestination(broochId: string, actorId: string, actor: ActorKind, url: string) {
    const [r] = await this.q<{ old: string | null }>(`select public.update_destination($1, $2, $3, $4) as old`, [
      broochId,
      actorId,
      actor,
      url,
    ]);
    return r.old;
  }
  async setStatus(broochId: string, actorId: string, actor: ActorKind, action: StatusAction) {
    const [r] = await this.q<{ s: BroochStatus }>(`select public.set_brooch_status($1, $2, $3, $4) as s`, [
      broochId,
      actorId,
      actor,
      action,
    ]);
    return r.s;
  }
  async listBlockedDomains() {
    return (await this.q<{ domain: string }>(`select domain from public.blocked_domains`)).map((r) => r.domain);
  }
  async registerScan(i: { publicCode: string; ipHash: string | null; userAgent: string | null; country: string | null; record: boolean }) {
    const [r] = await this.q<{ brooch_id: string; status: BroochStatus; destination_url: string | null }>(
      `select * from public.register_scan($1, $2, $3, $4, $5)`,
      [i.publicCode, i.ipHash, i.userAgent, i.country, i.record],
    );
    return r ?? null;
  }
  async checkRateLimit(key: string, limit: number, windowSeconds: number) {
    const [r] = await this.q<{ ok: boolean }>(`select public.check_rate_limit($1, $2, $3) as ok`, [key, limit, windowSeconds]);
    return r.ok;
  }
}
