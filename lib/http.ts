import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, type Profile } from "@/lib/auth";
import { serverConfig } from "@/lib/config";
import { hashIp } from "@/lib/codes";
import { adminStore } from "@/lib/supabase/admin";
import { DomainError } from "@/lib/store/types";

export const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

export function errorJson(status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  return json({ error, message, ...extra }, status);
}

export function clientIp(req: NextRequest | Request): string {
  const h = req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "0.0.0.0").trim();
}

export function ipKey(req: NextRequest | Request): string {
  return hashIp(serverConfig().IP_HASH_SALT, clientIp(req));
}

/**
 * Proteção CSRF para rotas que alteram estado com cookie de sessão:
 * exige Origin (ou Referer) do próprio app.
 */
export function sameOrigin(req: NextRequest | Request): boolean {
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    const reqHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return host === reqHost || host === serverConfig().appHost;
  } catch {
    return false;
  }
}

type Guard =
  | { ok: true; profile: Profile }
  | { ok: false; response: NextResponse };

export async function guard(req: NextRequest | Request, opts: { admin?: boolean; mutation?: boolean } = {}): Promise<Guard> {
  if (opts.mutation && !sameOrigin(req)) {
    return { ok: false, response: errorJson(403, "csrf", "Origem da requisição não permitida.") };
  }
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, response: errorJson(401, "unauthenticated", "Faça login para continuar.") };
  if (opts.admin && profile.role !== "admin") {
    return { ok: false, response: errorJson(403, "forbidden", "Acesso restrito a administradores.") };
  }
  return { ok: true, profile };
}

/** Rate limit; devolve uma resposta 429 se excedido. */
export async function limit(key: string, max: number, windowSeconds: number): Promise<NextResponse | null> {
  const allowed = await adminStore().checkRateLimit(key, max, windowSeconds);
  return allowed
    ? null
    : errorJson(429, "rate_limited", "Muitas tentativas. Aguarde um pouco e tente novamente.");
}

export async function parseJson<T extends z.ZodType>(req: Request, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: errorJson(400, "invalid_json", "Corpo da requisição inválido.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorJson(422, "validation", parsed.error.issues[0]?.message ?? "Dados inválidos.", {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

export function domainErrorResponse(e: unknown) {
  if (e instanceof DomainError) {
    const map = { not_found: 404, forbidden: 403, conflict: 409, invalid: 422, collision: 409, internal: 500 } as const;
    const messages = {
      not_found: "Registro não encontrado.",
      forbidden: "Você não tem permissão para esta ação.",
      conflict: "Esta ação não é permitida no estado atual.",
      invalid: "Dados inválidos.",
      collision: "Conflito ao gerar identificadores. Tente novamente.",
      internal: "Erro interno. Tente novamente.",
    } as const;
    if (e.code === "internal") console.error("[domain]", e.message);
    return errorJson(map[e.code], e.code, messages[e.code]);
  }
  console.error("[unexpected]", e);
  return errorJson(500, "internal", "Erro interno. Tente novamente.");
}

export const uuidSchema = z.string().uuid();
