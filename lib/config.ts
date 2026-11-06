/**
 * Configuração do servidor. Os limites são POR OPERAÇÃO e ajustáveis por
 * variável de ambiente — não existe limite global de broches.
 */
import { z } from "zod";

const intFrom = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  ACTIVATION_CODE_SECRET: z.string().min(32, "ACTIVATION_CODE_SECRET precisa de 32+ caracteres"),
  ACTIVATION_HASH_PEPPER: z.string().min(32, "ACTIVATION_HASH_PEPPER precisa de 32+ caracteres"),
  IP_HASH_SALT: z.string().min(16, "IP_HASH_SALT precisa de 16+ caracteres"),
  GOOGLE_SAFE_BROWSING_API_KEY: z.string().optional().transform((v) => v || undefined),

  // Limites por operação (proteção da infraestrutura)
  GENERATION_CHUNK_SIZE: intFrom(500, 1, 5000),
  MAX_QUANTITY_PER_BATCH: intFrom(100_000, 1, 10_000_000),
  EXPORT_MAX_ITEMS: intFrom(500, 1, 5000),
  PAGE_SIZE: intFrom(25, 5, 200),
  ACTIVATION_MAX_ATTEMPTS: intFrom(5, 1, 50),
  ACTIVATION_LOCK_SECONDS: intFrom(900, 60, 86_400),
  SCAN_RATE_LIMIT_PER_MINUTE: intFrom(60, 0, 100_000),
  SCAN_RETENTION_DAYS: intFrom(365, 7, 3650),
});

export type ServerConfig = z.infer<typeof schema> & { appHost: string };

let cached: ServerConfig | null = null;

export function serverConfig(): ServerConfig {
  if (cached) return cached;
  const parsed = schema.safeParse({
    ...process.env,
    // aceita os nomes novos de chave do Supabase como alternativa
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? vercelUrl(),
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Configuração inválida. Verifique o .env.local:\n  ${issues}`);
  }
  const appUrl = parsed.data.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  cached = { ...parsed.data, NEXT_PUBLIC_APP_URL: appUrl, appHost: new URL(appUrl).host };
  return cached;
}

function vercelUrl(): string | undefined {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

/** URL pública permanente impressa no QR Code. */
export function publicBroochUrl(appUrl: string, publicCode: string): string {
  return `${appUrl.replace(/\/+$/, "")}/b/${publicCode}`;
}
