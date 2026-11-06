/**
 * URL pública permanente impressa no QR Code: /b/{IDENTIFICADOR}
 * Visitantes não precisam de conta. Resposta: sempre HTTP 302, sem cache.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isValidPublicCode, normalizeCode } from "@/lib/codes";
import { serverConfig } from "@/lib/config";
import { decideRedirect, isLikelyBot, REDIRECT_HEADERS } from "@/lib/redirect";
import { ipKey } from "@/lib/http";
import { adminStore } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Ctx = { params: Promise<{ code: string }> };

function redirectTo(location: string) {
  return new NextResponse(null, { status: 302, headers: { Location: location, ...REDIRECT_HEADERS } });
}

async function handle(req: NextRequest, ctx: Ctx, countable: boolean) {
  const cfg = serverConfig();
  const code = normalizeCode((await ctx.params).code ?? "");
  if (!isValidPublicCode(code)) return redirectTo(`${cfg.NEXT_PUBLIC_APP_URL}/status/nao-encontrado`);

  const store = adminStore();
  const userAgent = req.headers.get("user-agent");
  const ipHash = ipKey(req);

  try {
    // Leituras de robôs (pré-visualização de links) e excesso por IP são
    // redirecionadas normalmente, mas não entram nas estatísticas.
    let record = countable && !isLikelyBot(userAgent);
    if (record && cfg.SCAN_RATE_LIMIT_PER_MINUTE > 0) {
      record = await store.checkRateLimit(`scan:${ipHash}`, cfg.SCAN_RATE_LIMIT_PER_MINUTE, 60);
    }
    const result = await store.registerScan({
      publicCode: code,
      ipHash,
      userAgent: userAgent?.slice(0, 300) ?? null,
      country: req.headers.get("x-vercel-ip-country"),
      record,
    });
    return redirectTo(decideRedirect(result, cfg.NEXT_PUBLIC_APP_URL, code).location);
  } catch (e) {
    console.error("[scan]", e);
    return redirectTo(`${cfg.NEXT_PUBLIC_APP_URL}/status/indisponivel`);
  }
}

export function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx, true);
}

export function HEAD(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx, false);
}
