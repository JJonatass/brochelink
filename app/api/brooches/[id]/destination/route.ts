import type { NextRequest } from "next/server";
import { z } from "zod";
import { resolveActor } from "@/lib/actor";
import { domainErrorResponse, errorJson, guard, json, limit, parseJson, uuidSchema } from "@/lib/http";
import { destinationPolicy } from "@/lib/policy";
import { changeDestination } from "@/lib/services/activation";
import { adminStore } from "@/lib/supabase/admin";
import { URL_ERROR_MESSAGES } from "@/lib/url-validation";

const schema = z.object({
  url: z.string().trim().min(1, "Informe o novo endereço.").max(2048),
  confirm: z.literal(true, { message: "Confirme a alteração." }),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { mutation: true });
  if (!g.ok) return g.response;
  const id = uuidSchema.safeParse((await ctx.params).id);
  if (!id.success) return errorJson(404, "not_found", "Broche não encontrado.");

  const limited = await limit(`destination:${g.profile.id}`, 30, 3600);
  if (limited) return limited;

  const body = await parseJson(req, schema);
  if (!body.ok) return body.response;

  try {
    const resolved = await resolveActor(g.profile, id.data);
    if (!resolved) return errorJson(404, "not_found", "Broche não encontrado.");
    const result = await changeDestination(
      adminStore(),
      { broochId: id.data, actorId: g.profile.id, actor: resolved.actor, url: body.data.url },
      destinationPolicy(),
    );
    if (!result.ok) return errorJson(422, "invalid_url", URL_ERROR_MESSAGES[result.reason], { field: "url" });
    return json({ ok: true, url: result.url, previous: result.previous });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
