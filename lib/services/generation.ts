/**
 * Geração de broches em lotes — idempotente, incremental e retomável.
 *
 * Fluxo:
 *  1. createBatch(chave de idempotência) — repetir a requisição devolve o MESMO lote.
 *  2. processBatchChunk() é chamado repetidamente (pelo navegador do admin)
 *     até o lote ficar "completed". Cada chamada processa no máximo
 *     `chunkSize` broches, ficando bem abaixo do tempo máximo de uma função
 *     serverless e do limite de memória.
 *
 * Garantias:
 *  - Sem duplicatas: UNIQUE (batch_id, sequence_in_batch) + ON CONFLICT DO NOTHING.
 *  - Sem identificadores repetidos: UNIQUE (public_code); em colisão, novos códigos.
 *  - Recuperação de falha parcial: se a função cair entre inserir broches e
 *    inserir credenciais, a próxima chamada encontra os broches sem credencial
 *    e as completa (as credenciais são determinísticas, então reprocessar é seguro).
 *  - O progresso é sempre recalculado a partir das linhas reais (sync_batch_progress).
 */
import { deriveActivationCode, generatePublicCode, hashActivationCode } from "@/lib/codes";
import { DomainError, type Batch, type Store } from "@/lib/store/types";

export type GenerationOptions = {
  chunkSize: number;
  codeSecret: string;
  pepper: string;
  /** injetável para testes de colisão */
  generateCode?: () => string;
  maxCollisionRetries?: number;
};

export const CURRENT_CODE_VERSION = 1;

async function completeMissingCredentials(store: Store, batchId: string, limit: number, opts: GenerationOptions) {
  const missing = await store.broochesMissingCredentials(batchId, limit);
  if (missing.length === 0) return 0;
  await store.insertCredentials(
    missing.map(({ id }) => {
      const code = deriveActivationCode(opts.codeSecret, id, CURRENT_CODE_VERSION);
      return { broochId: id, codeHash: hashActivationCode(opts.pepper, id, CURRENT_CODE_VERSION, code), codeVersion: CURRENT_CODE_VERSION };
    }),
  );
  return missing.length;
}

export async function processBatchChunk(store: Store, batchId: string, opts: GenerationOptions): Promise<Batch> {
  const batch = await store.getBatch(batchId);
  if (!batch) throw new DomainError("not_found", "Lote não encontrado");
  if (batch.status === "completed") return batch;

  const chunk = Math.max(1, Math.floor(opts.chunkSize));
  const gen = opts.generateCode ?? generatePublicCode;
  const maxRetries = opts.maxCollisionRetries ?? 5;

  try {
    // 1) Recuperação: completa credenciais de broches inseridos numa tentativa anterior
    const repaired = await completeMissingCredentials(store, batchId, chunk, opts);

    // 2) Próxima faixa de sequências (se ainda houver orçamento nesta chamada)
    const budget = chunk - repaired;
    if (budget > 0) {
      const max = await store.maxSequence(batchId);
      const end = Math.min(batch.requested_quantity, max + budget);
      if (end > max) {
        const sequences = Array.from({ length: end - max }, (_, i) => max + 1 + i);
        for (let attempt = 0; ; attempt++) {
          try {
            await store.insertBrooches(
              batchId,
              sequences.map((sequence) => ({ sequence, publicCode: gen() })),
            );
            break;
          } catch (e) {
            if (e instanceof DomainError && e.code === "collision" && attempt < maxRetries) continue;
            throw e;
          }
        }
        await completeMissingCredentials(store, batchId, sequences.length, opts);
      }
    }
    return await store.syncBatch(batchId, null);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await store.syncBatch(batchId, message.slice(0, 500));
    } catch {
      /* mantém o erro original */
    }
    throw e;
  }
}

/** Divide uma faixa grande de exportação em partes de `size` itens. */
export function exportParts(total: number, size: number): { part: number; from: number; to: number }[] {
  const parts: { part: number; from: number; to: number }[] = [];
  for (let from = 1, part = 1; from <= total; from += size, part++) {
    parts.push({ part, from, to: Math.min(total, from + size - 1) });
  }
  return parts;
}
