import type { NextRequest } from "next/server";
import { deriveActivationCode, formatActivationCode, hashActivationCode } from "@/lib/codes";
import { serverConfig } from "@/lib/config";
import { domainErrorResponse, errorJson, guard, json, limit, uuidSchema } from "@/lib/http";
import { domainErrorFromSqlState } from "@/lib/store/types";
import { createAdminClient } from "@/lib/supabase/admin";

/** Gera novo código de ativação (o anterior, impresso, deixa de valer). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { admin: true, mutation: true });
  if (!g.ok) return g.response;
  const id = uuidSchema.safeParse((await ctx.params).id);
  if (!id.success) return errorJson(404, "not_found", "Broche não encontrado.");
  const limited = await limit(`reset:${g.profile.id}`, 30, 3600);
  if (limited) return limited;

  const cfg = serverConfig();
  const db = createAdminClient();
  try {
    const { data: cred } = await db.from("activation_credentials").select("code_version").eq("brooch_id", id.data).maybeSingle();
    if (!cred) return errorJson(404, "not_found", "Credencial não encontrada.");
    const version = (cred.code_version as number) + 1;
    const code = deriveActivationCode(cfg.ACTIVATION_CODE_SECRET, id.data, version);
    const { error } = await db.rpc("reset_activation_code", {
      p_brooch_id: id.data,
      p_actor_id: g.profile.id,
      p_new_hash: hashActivationCode(cfg.ACTIVATION_HASH_PEPPER, id.data, version, code),
      p_new_version: version,
    });
    if (error) throw domainErrorFromSqlState(error.code, error.message);
    return json({ ok: true, activationCode: formatActivationCode(code), version });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
