import type { NextRequest } from "next/server";
import { z } from "zod";
import { resolveActor } from "@/lib/actor";
import { domainErrorResponse, errorJson, guard, json, limit, parseJson, uuidSchema } from "@/lib/http";
import { adminStore } from "@/lib/supabase/admin";

const schema = z.object({ action: z.enum(["suspend", "reactivate", "revoke"]) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { mutation: true });
  if (!g.ok) return g.response;
  const id = uuidSchema.safeParse((await ctx.params).id);
  if (!id.success) return errorJson(404, "not_found", "Broche não encontrado.");

  const limited = await limit(`status:${g.profile.id}`, 60, 3600);
  if (limited) return limited;

  const body = await parseJson(req, schema);
  if (!body.ok) return body.response;

  try {
    const resolved = await resolveActor(g.profile, id.data);
    if (!resolved) return errorJson(404, "not_found", "Broche não encontrado.");
    const status = await adminStore().setStatus(id.data, g.profile.id, resolved.actor, body.data.action);
    return json({ ok: true, status });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
