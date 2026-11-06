/**
 * Contrato de persistência usado pelos serviços de domínio.
 * Produção: SupabaseStore (lib/store/supabase-store.ts).
 * Testes: PgliteStore (tests/db/pglite-store.ts), que executa as MESMAS
 * migrations e funções SQL num PostgreSQL real em memória.
 */
import type { ActorKind, BroochStatus, StatusAction } from "@/lib/brooches/transitions";

export type BatchStatus = "pending" | "processing" | "completed" | "failed";

export type Batch = {
  id: string;
  created_by: string;
  requested_quantity: number;
  generated_quantity: number;
  status: BatchStatus;
  idempotency_key: string;
  label: string | null;
  last_error: string | null;
  attempts: number;
  created_at: string;
  completed_at: string | null;
};

export type Credential = {
  brooch_id: string;
  code_hash: string;
  code_version: number;
  failed_attempts: number;
  locked_until: string | null;
  used_at: string | null;
};

export type ScanResult = { brooch_id: string; status: BroochStatus; destination_url: string | null };

export type DomainErrorCode = "not_found" | "forbidden" | "conflict" | "invalid" | "collision" | "internal";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DomainError";
  }
}

/** Mapeia SQLSTATE das funções SQL para erros de domínio. */
export function domainErrorFromSqlState(sqlState: string | undefined, message: string): DomainError {
  switch (sqlState) {
    case "42501":
      return new DomainError("forbidden", message);
    case "P0002":
      return new DomainError("not_found", message);
    case "P0001":
    case "23505":
      return new DomainError("conflict", message);
    case "22023":
    case "23514":
      return new DomainError("invalid", message);
    default:
      return new DomainError("internal", message);
  }
}

export interface Store {
  // geração
  createBatch(input: { createdBy: string; quantity: number; idempotencyKey: string; label?: string | null }): Promise<Batch>;
  getBatch(id: string): Promise<Batch | null>;
  maxSequence(batchId: string): Promise<number>;
  /** Insere broches; ignora (batch, sequence) já existentes. Lança DomainError('collision') se public_code colidir. */
  insertBrooches(batchId: string, rows: { sequence: number; publicCode: string }[]): Promise<void>;
  broochesMissingCredentials(batchId: string, limit: number): Promise<{ id: string }[]>;
  /** Insere credenciais; ignora brooch_id já existentes. */
  insertCredentials(rows: { broochId: string; codeHash: string; codeVersion: number }[]): Promise<void>;
  syncBatch(batchId: string, error?: string | null): Promise<Batch>;

  // ativação e gestão
  findBroochByCode(publicCode: string): Promise<{ id: string; status: BroochStatus; owner_id: string | null } | null>;
  getCredential(broochId: string): Promise<Credential | null>;
  registerFailedActivation(
    broochId: string,
    maxAttempts: number,
    lockSeconds: number,
  ): Promise<{ failed_attempts: number; locked_until: string | null } | null>;
  activateBrooch(broochId: string, userId: string, destination: string, codeVersion: number): Promise<boolean>;
  updateDestination(broochId: string, actorId: string, actor: ActorKind, url: string): Promise<string | null>;
  setStatus(broochId: string, actorId: string, actor: ActorKind, action: StatusAction): Promise<BroochStatus>;
  listBlockedDomains(): Promise<string[]>;

  // leitura e proteção
  registerScan(input: {
    publicCode: string;
    ipHash: string | null;
    userAgent: string | null;
    country: string | null;
    record: boolean;
  }): Promise<ScanResult | null>;
  checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}
