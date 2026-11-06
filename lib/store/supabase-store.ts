import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorKind, BroochStatus, StatusAction } from "@/lib/brooches/transitions";
import { DomainError, domainErrorFromSqlState, type Batch, type Credential, type Store } from "./types";

type PgError = { code?: string; message: string } | null;

function fail(error: PgError): never {
  throw domainErrorFromSqlState(error?.code, error?.message ?? "database error");
}

/**
 * Implementação de Store sobre o Supabase. Recebe um cliente com a
 * service_role (lib/supabase/admin.ts) — usado SOMENTE depois que a rota
 * autenticou e autorizou o usuário.
 */
export class SupabaseStore implements Store {
  constructor(private readonly db: SupabaseClient) {}

  async createBatch(input: { createdBy: string; quantity: number; idempotencyKey: string; label?: string | null }) {
    const { data, error } = await this.db.rpc("create_generation_batch", {
      p_created_by: input.createdBy,
      p_quantity: input.quantity,
      p_idempotency_key: input.idempotencyKey,
      p_label: input.label ?? null,
    });
    if (error) fail(error);
    return data as Batch;
  }

  async getBatch(id: string) {
    const { data, error } = await this.db.from("generation_batches").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return (data as Batch) ?? null;
  }

  async maxSequence(batchId: string) {
    const { data, error } = await this.db
      .from("brooches")
      .select("sequence_in_batch")
      .eq("batch_id", batchId)
      .order("sequence_in_batch", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail(error);
    return (data?.sequence_in_batch as number | undefined) ?? 0;
  }

  async insertBrooches(batchId: string, rows: { sequence: number; publicCode: string }[]) {
    if (rows.length === 0) return;
    const { error } = await this.db.from("brooches").upsert(
      rows.map((r) => ({ batch_id: batchId, sequence_in_batch: r.sequence, public_code: r.publicCode })),
      { onConflict: "batch_id,sequence_in_batch", ignoreDuplicates: true },
    );
    if (error) {
      if (error.code === "23505" && error.message.includes("public_code")) {
        throw new DomainError("collision", "Identificador público repetido");
      }
      fail(error);
    }
  }

  async broochesMissingCredentials(batchId: string, limit: number) {
    const { data, error } = await this.db.rpc("brooches_missing_credentials", { p_batch_id: batchId, p_limit: limit });
    if (error) fail(error);
    return ((data ?? []) as { id: string }[]).map((r) => ({ id: r.id }));
  }

  async insertCredentials(rows: { broochId: string; codeHash: string; codeVersion: number }[]) {
    if (rows.length === 0) return;
    const { error } = await this.db.from("activation_credentials").upsert(
      rows.map((r) => ({ brooch_id: r.broochId, code_hash: r.codeHash, code_version: r.codeVersion })),
      { onConflict: "brooch_id", ignoreDuplicates: true },
    );
    if (error) fail(error);
  }

  async syncBatch(batchId: string, error?: string | null) {
    const { data, error: e } = await this.db.rpc("sync_batch_progress", { p_batch_id: batchId, p_error: error ?? null });
    if (e) fail(e);
    return data as Batch;
  }

  async findBroochByCode(publicCode: string) {
    const { data, error } = await this.db
      .from("brooches")
      .select("id, status, owner_id")
      .eq("public_code", publicCode)
      .maybeSingle();
    if (error) fail(error);
    return (data as { id: string; status: BroochStatus; owner_id: string | null }) ?? null;
  }

  async getCredential(broochId: string) {
    const { data, error } = await this.db
      .from("activation_credentials")
      .select("brooch_id, code_hash, code_version, failed_attempts, locked_until, used_at")
      .eq("brooch_id", broochId)
      .maybeSingle();
    if (error) fail(error);
    return (data as Credential) ?? null;
  }

  async registerFailedActivation(broochId: string, maxAttempts: number, lockSeconds: number) {
    const { data, error } = await this.db.rpc("register_failed_activation", {
      p_brooch_id: broochId,
      p_max_attempts: maxAttempts,
      p_lock_seconds: lockSeconds,
    });
    if (error) fail(error);
    const row = (data as { failed_attempts: number; locked_until: string | null }[] | null)?.[0];
    return row ?? null;
  }

  async activateBrooch(broochId: string, userId: string, destination: string, codeVersion: number) {
    const { data, error } = await this.db.rpc("activate_brooch", {
      p_brooch_id: broochId,
      p_user_id: userId,
      p_destination: destination,
      p_code_version: codeVersion,
    });
    if (error) {
      if (error.code === "P0001") return false;
      fail(error);
    }
    return data === true;
  }

  async updateDestination(broochId: string, actorId: string, actor: ActorKind, url: string) {
    const { data, error } = await this.db.rpc("update_destination", {
      p_brooch_id: broochId,
      p_actor_id: actorId,
      p_actor: actor,
      p_new_url: url,
    });
    if (error) fail(error);
    return (data as string | null) ?? null;
  }

  async setStatus(broochId: string, actorId: string, actor: ActorKind, action: StatusAction) {
    const { data, error } = await this.db.rpc("set_brooch_status", {
      p_brooch_id: broochId,
      p_actor_id: actorId,
      p_actor: actor,
      p_action: action,
    });
    if (error) fail(error);
    return data as BroochStatus;
  }

  async listBlockedDomains() {
    const { data, error } = await this.db.from("blocked_domains").select("domain").limit(10_000);
    if (error) fail(error);
    return (data ?? []).map((r) => r.domain as string);
  }

  async registerScan(input: { publicCode: string; ipHash: string | null; userAgent: string | null; country: string | null; record: boolean }) {
    const { data, error } = await this.db.rpc("register_scan", {
      p_public_code: input.publicCode,
      p_ip_hash: input.ipHash,
      p_user_agent: input.userAgent,
      p_country: input.country,
      p_record: input.record,
    });
    if (error) fail(error);
    const row = (data as { brooch_id: string; status: BroochStatus; destination_url: string | null }[] | null)?.[0];
    return row ?? null;
  }

  async checkRateLimit(key: string, limit: number, windowSeconds: number) {
    const { data, error } = await this.db.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      // falha aberta no rate limit: indisponibilidade do contador não derruba o app
      console.error("[rate-limit]", error.message);
      return true;
    }
    return data === true;
  }
}
