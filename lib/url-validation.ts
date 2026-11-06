/**
 * Validação rigorosa de URLs de destino.
 *
 * O BrocheLink NUNCA faz requisições para a URL de destino (apenas devolve um
 * 302 ao navegador do visitante), portanto não existe superfície de SSRF no
 * redirecionamento. Mesmo assim bloqueamos IPs, hosts internos e portas não
 * padrão, para que um broche não seja usado para apontar para redes privadas
 * do visitante nem para esconder destinos suspeitos.
 */

export type UrlValidationError =
  | "empty"
  | "too_long"
  | "invalid"
  | "not_https"
  | "credentials"
  | "port"
  | "ip_address"
  | "internal_host"
  | "invalid_host"
  | "self_redirect"
  | "blocked";

export type UrlValidationResult = { ok: true; url: string; hostname: string } | { ok: false; error: UrlValidationError };

export const URL_ERROR_MESSAGES: Record<UrlValidationError, string> = {
  empty: "Informe o endereço de destino.",
  too_long: "O endereço é longo demais (máximo de 2048 caracteres).",
  invalid: "Endereço inválido.",
  not_https: "Use um endereço seguro que comece com https://",
  credentials: "Endereços com usuário ou senha embutidos não são permitidos.",
  port: "Portas personalizadas não são permitidas.",
  ip_address: "Use um nome de domínio, não um endereço IP.",
  internal_host: "Endereços internos ou locais não são permitidos.",
  invalid_host: "O domínio informado não é válido.",
  self_redirect: "O destino não pode apontar para o próprio BrocheLink.",
  blocked: "Este destino está bloqueado por motivos de segurança.",
};

export const MAX_URL_LENGTH = 2048;

/** Sufixos reservados/internos (RFC 2606, RFC 6761, RFC 6762, redes corporativas). */
const INTERNAL_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "private",
  "test",
  "invalid",
  "example",
  "onion",
  "home.arpa",
  "arpa",
];

/** Domínios sempre bloqueados (independentes da tabela blocked_domains). */
export const BUILTIN_BLOCKED_DOMAINS = [
  // Metadados de nuvem e equivalentes resolvíveis por DNS
  "metadata.google.internal",
  "instance-data.ec2.internal",
  // Serviços que resolvem qualquer IP por nome (usados para burlar bloqueio de IP)
  "nip.io",
  "sslip.io",
  "xip.io",
  "localtest.me",
  "lvh.me",
];

const IPV4_REGEX = /^(\d{1,3})(\.\d{1,3}){3}$/;
// Também pega formas numéricas alternativas (0x7f.1, 2130706433), que o URL()
// do Node já normaliza para dotted-quad, mas mantemos por segurança.
const NUMERIC_HOST_REGEX = /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*$/i;
const LABEL_REGEX = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD_REGEX = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function hostMatchesDomain(hostname: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return hostname === d || hostname.endsWith(`.${d}`);
}

export type UrlValidationOptions = {
  /** Hosts do próprio app (ex.: brochelink.vercel.app, localhost:3000) */
  appHosts?: string[];
  /** Domínios da tabela blocked_domains */
  blockedDomains?: string[];
};

export function validateDestinationUrl(raw: string, options: UrlValidationOptions = {}): UrlValidationResult {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, error: "empty" };
  if (input.length > MAX_URL_LENGTH) return { ok: false, error: "too_long" };
  // Sem espaços, caracteres de controle ou barras invertidas (truques de parser)
  if (/[\s\u0000-\u001f\u007f\\]/.test(input)) return { ok: false, error: "invalid" };
  if (!/^https:\/\//i.test(input)) {
    return { ok: false, error: /^[a-z][a-z0-9+.-]*:/i.test(input) ? "not_https" : "invalid" };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "invalid" };
  }

  if (url.protocol !== "https:") return { ok: false, error: "not_https" };
  if (url.username || url.password) return { ok: false, error: "credentials" };
  if (url.port && url.port !== "443") return { ok: false, error: "port" };

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) return { ok: false, error: "invalid_host" };
  if (hostname.startsWith("[") || hostname.includes(":")) return { ok: false, error: "ip_address" };
  if (IPV4_REGEX.test(hostname) || NUMERIC_HOST_REGEX.test(hostname)) return { ok: false, error: "ip_address" };

  const labels = hostname.split(".");
  if (labels.length < 2) return { ok: false, error: "internal_host" };
  if (INTERNAL_SUFFIXES.some((s) => hostMatchesDomain(hostname, s))) return { ok: false, error: "internal_host" };
  if (!labels.every((l) => LABEL_REGEX.test(l))) return { ok: false, error: "invalid_host" };
  if (!TLD_REGEX.test(labels[labels.length - 1])) return { ok: false, error: "invalid_host" };

  for (const appHost of options.appHosts ?? []) {
    const h = appHost.toLowerCase().split(":")[0];
    if (h && hostname === h) return { ok: false, error: "self_redirect" };
  }

  const blocked = [...BUILTIN_BLOCKED_DOMAINS, ...(options.blockedDomains ?? [])];
  if (blocked.some((d) => d && hostMatchesDomain(hostname, d))) return { ok: false, error: "blocked" };

  return { ok: true, url: url.href, hostname };
}

/** Normaliza um domínio digitado pelo admin para a lista de bloqueio. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  try {
    if (/^[a-z]+:\/\//.test(s)) s = new URL(s).hostname;
    else s = new URL(`https://${s}`).hostname;
  } catch {
    return null;
  }
  s = s.replace(/^\*\./, "").replace(/\.$/, "");
  return /^[a-z0-9.-]+$/.test(s) && s.includes(".") ? s : null;
}
