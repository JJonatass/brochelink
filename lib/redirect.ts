/**
 * Decide para onde uma leitura de QR Code vai. Sempre HTTP 302 com
 * Cache-Control: no-store — nunca um 301/308, que navegadores e CDNs
 * guardariam em cache e impediriam a troca do destino.
 */
import type { ScanResult } from "@/lib/store/types";

export const REDIRECT_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, private",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

export type RedirectDecision = { status: 302; location: string; kind: "destination" | "activation" | "suspended" | "revoked" | "not_found" | "rate_limited" };

export function decideRedirect(result: ScanResult | null, appUrl: string, publicCode: string): RedirectDecision {
  const base = appUrl.replace(/\/+$/, "");
  if (!result) return { status: 302, location: `${base}/status/nao-encontrado`, kind: "not_found" };
  switch (result.status) {
    case "active":
      return result.destination_url
        ? { status: 302, location: result.destination_url, kind: "destination" }
        : { status: 302, location: `${base}/status/suspenso`, kind: "suspended" };
    case "available":
      return { status: 302, location: `${base}/ativar/${publicCode}`, kind: "activation" };
    case "suspended":
      return { status: 302, location: `${base}/status/suspenso`, kind: "suspended" };
    default:
      return { status: 302, location: `${base}/status/revogado`, kind: "revoked" };
  }
}

/** Leitores automáticos (pré-visualização de links) não contam como leitura. */
export function isLikelyBot(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|linkedin|embedly|curl\/|wget/i.test(
    userAgent,
  );
}
