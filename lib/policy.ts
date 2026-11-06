import "server-only";
import { serverConfig } from "@/lib/config";
import { isUrlFlaggedBySafeBrowsing } from "@/lib/safe-browsing";
import type { DestinationPolicy } from "@/lib/services/activation";

/** Política de destinos usada pelas rotas (hosts do app + Safe Browsing opcional). */
export function destinationPolicy(): DestinationPolicy {
  const cfg = serverConfig();
  const hosts = new Set([cfg.appHost]);
  if (process.env.VERCEL_URL) hosts.add(process.env.VERCEL_URL);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) hosts.add(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  return {
    appHosts: [...hosts],
    isFlagged: cfg.GOOGLE_SAFE_BROWSING_API_KEY
      ? (url) => isUrlFlaggedBySafeBrowsing(url, cfg.GOOGLE_SAFE_BROWSING_API_KEY)
      : undefined,
  };
}
