import type { NextRequest } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { domainErrorResponse, errorJson, guard, json, limit, parseJson } from "@/lib/http";
import { adminStore } from "@/lib/supabase/admin";

const schema = z.object({
  quantity: z.coerce.number().int("A quantidade deve ser um número inteiro.").positive("A quantidade deve ser maior que zero."),
  idempotencyKey: z.string().min(8).max(100),
  label: z.string().trim().max(120).optional().nullable(),
});

/** Cria um lote (idempotente pela chave). O processamento ocorre em /process. */
export async function POST(req: NextRequest) {
  const g = await guard(req, { admin: true, mutation: true });
  if (!g.ok) return g.response;
  const limited = await limit(`batch:create:${g.profile.id}`, 30, 60);
  if (limited) return limited;

  const body = await parseJson(req, schema);
  if (!body.ok) return body.response;

  const cfg = serverConfig();
  if (body.data.quantity > cfg.MAX_QUANTITY_PER_BATCH) {
    return errorJson(
      422,
      "quantity_per_batch",
      `Cada lote aceita até ${cfg.MAX_QUANTITY_PER_BATCH.toLocaleString("pt-BR")} broches (limite configurável em MAX_QUANTITY_PER_BATCH). Para mais, crie vários lotes.`,
    );
  }
  try {
    const batch = await adminStore().createBatch({
      createdBy: g.profile.id,
      quantity: body.data.quantity,
      idempotencyKey: body.data.idempotencyKey,
      label: body.data.label ?? null,
    });
    return json({ batch, chunkSize: cfg.GENERATION_CHUNK_SIZE });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
