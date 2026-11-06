import type { NextRequest } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { errorJson, guard, ipKey, json, limit, parseJson, domainErrorResponse } from "@/lib/http";
import { destinationPolicy } from "@/lib/policy";
import { activateBrooch } from "@/lib/services/activation";
import { adminStore } from "@/lib/supabase/admin";
import { URL_ERROR_MESSAGES } from "@/lib/url-validation";

const schema = z.object({
  publicCode: z.string().trim().min(1).max(32),
  activationCode: z.string().trim().min(1, "Informe o código de ativação.").max(32),
  destinationUrl: z.string().trim().min(1, "Informe o endereço de destino.").max(2048),
  confirm: z.literal(true, { message: "Confirme a ativação." }),
});

export async function POST(req: NextRequest) {
  const g = await guard(req, { mutation: true });
  if (!g.ok) return g.response;
  const cfg = serverConfig();

  const limited =
    (await limit(`activate:user:${g.profile.id}`, 10, 900)) ?? (await limit(`activate:ip:${ipKey(req)}`, 30, 900));
  if (limited) return limited;

  const body = await parseJson(req, schema);
  if (!body.ok) return body.response;

  try {
    const result = await activateBrooch(
      adminStore(),
      { ...body.data, userId: g.profile.id },
      {
        ...destinationPolicy(),
        pepper: cfg.ACTIVATION_HASH_PEPPER,
        maxAttempts: cfg.ACTIVATION_MAX_ATTEMPTS,
        lockSeconds: cfg.ACTIVATION_LOCK_SECONDS,
      },
    );
    if (result.ok) return json({ ok: true, broochId: result.broochId });
    switch (result.error) {
      case "not_found":
        return errorJson(404, "not_found", "Broche não encontrado.");
      case "not_available":
        return errorJson(
          409,
          "not_available",
          result.alreadyYours ? "Este broche já está ativado na sua conta." : "Este broche não está disponível para ativação.",
          { alreadyYours: result.alreadyYours },
        );
      case "locked":
        return errorJson(423, "locked", "Muitas tentativas incorretas. A ativação deste broche está temporariamente bloqueada.", {
          lockedUntil: result.lockedUntil,
        });
      case "invalid_code":
        return errorJson(
          400,
          "invalid_code",
          result.lockedUntil
            ? "Código incorreto. A ativação foi bloqueada temporariamente por excesso de tentativas."
            : `Código de ativação incorreto. Tentativas restantes antes do bloqueio: ${result.remainingAttempts}.`,
          { remainingAttempts: result.remainingAttempts, lockedUntil: result.lockedUntil },
        );
      case "invalid_url":
        return errorJson(422, "invalid_url", URL_ERROR_MESSAGES[result.reason], { field: "destinationUrl" });
      case "conflict":
        return errorJson(409, "conflict", "O broche acabou de ser ativado por outra pessoa ou o código mudou.");
    }
  } catch (e) {
    return domainErrorResponse(e);
  }
}
