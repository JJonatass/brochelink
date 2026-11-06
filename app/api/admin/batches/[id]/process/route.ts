import type { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { domainErrorResponse, errorJson, guard, json, limit, uuidSchema } from "@/lib/http";
import { processBatchChunk } from "@/lib/services/generation";
import { adminStore } from "@/lib/supabase/admin";

// Cada chamada processa no máximo GENERATION_CHUNK_SIZE broches.
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { admin: true, mutation: true });
  if (!g.ok) return g.response;
  const id = uuidSchema.safeParse((await ctx.params).id);
  if (!id.success) return errorJson(404, "not_found", "Lote não encontrado.");
  const limited = await limit(`batch:process:${g.profile.id}`, 240, 60);
  if (limited) return limited;

  const cfg = serverConfig();
  try {
    const batch = await processBatchChunk(adminStore(), id.data, {
      chunkSize: cfg.GENERATION_CHUNK_SIZE,
      codeSecret: cfg.ACTIVATION_CODE_SECRET,
      pepper: cfg.ACTIVATION_HASH_PEPPER,
    });
    return json({ batch });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
