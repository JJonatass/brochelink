import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorJson, guard, json, parseJson } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDomain } from "@/lib/url-validation";

const addSchema = z.object({ domain: z.string().min(3).max(253), reason: z.string().trim().max(200).optional() });
const delSchema = z.object({ domain: z.string().min(3).max(253) });

export async function POST(req: NextRequest) {
  const g = await guard(req, { admin: true, mutation: true });
  if (!g.ok) return g.response;
  const body = await parseJson(req, addSchema);
  if (!body.ok) return body.response;
  const domain = normalizeDomain(body.data.domain);
  if (!domain) return errorJson(422, "invalid_domain", "Domínio inválido.");
  const db = createAdminClient();
  const { error } = await db
    .from("blocked_domains")
    .upsert({ domain, reason: body.data.reason ?? null, created_by: g.profile.id }, { onConflict: "domain" });
  if (error) return errorJson(500, "internal", "Não foi possível salvar.");
  await db.rpc("write_audit", { p_actor_id: g.profile.id, p_actor: "admin", p_action: "blocklist.add", p_entity_type: "domain", p_entity_id: domain, p_metadata: { reason: body.data.reason ?? null } });
  return json({ ok: true, domain });
}

export async function DELETE(req: NextRequest) {
  const g = await guard(req, { admin: true, mutation: true });
  if (!g.ok) return g.response;
  const body = await parseJson(req, delSchema);
  if (!body.ok) return body.response;
  const db = createAdminClient();
  const { error } = await db.from("blocked_domains").delete().eq("domain", body.data.domain);
  if (error) return errorJson(500, "internal", "Não foi possível remover.");
  await db.rpc("write_audit", { p_actor_id: g.profile.id, p_actor: "admin", p_action: "blocklist.remove", p_entity_type: "domain", p_entity_id: body.data.domain, p_metadata: {} });
  return json({ ok: true });
}
