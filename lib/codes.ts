/**
 * Identificadores públicos e códigos secretos de ativação.
 *
 * Alfabeto de 32 símbolos sem caracteres ambíguos (sem 0, 1, I, O), o que
 * facilita a digitação a partir de um cartão impresso. Como 256 é múltiplo
 * de 32, `byte & 31` produz uma distribuição perfeitamente uniforme.
 *
 * - public_code: 12 símbolos aleatórios (60 bits) → parte da URL permanente.
 * - código de ativação: 12 símbolos (60 bits), DERIVADO por HMAC de um segredo
 *   do servidor + id do broche + versão. O banco guarda apenas um HASH
 *   (HMAC com outro segredo, o "pepper"). Assim:
 *     * um vazamento do banco não revela nenhum código;
 *     * o administrador pode reimprimir os cartões a qualquer momento;
 *     * um código perdido pode ser trocado incrementando a versão.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PUBLIC_CODE_LENGTH = 12;
export const ACTIVATION_CODE_LENGTH = 12;
export const PUBLIC_CODE_REGEX = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;

function bytesToCode(bytes: Uint8Array, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] & 31];
  return out;
}

/** Identificador público aleatório (criptograficamente seguro). */
export function generatePublicCode(): string {
  return bytesToCode(randomBytes(PUBLIC_CODE_LENGTH), PUBLIC_CODE_LENGTH);
}

/** Normaliza o que a pessoa digitou: maiúsculas, sem espaços/hífens. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s\-_.]/g, "");
}

export function isValidPublicCode(code: string): boolean {
  return PUBLIC_CODE_REGEX.test(code);
}

export function isWellFormedActivationCode(code: string): boolean {
  return PUBLIC_CODE_REGEX.test(code); // mesmo alfabeto e tamanho
}

/** "K7M2X9P4Q6R8" → "K7M2-X9P4-Q6R8" (para impressão). */
export function formatActivationCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/** Código de ativação determinístico (só o servidor conhece o segredo). */
export function deriveActivationCode(secret: string, broochId: string, version: number): string {
  if (!secret || secret.length < 32) throw new Error("ACTIVATION_CODE_SECRET ausente ou curto demais");
  const mac = createHmac("sha256", secret).update(`brochelink:activation:v${version}:${broochId}`).digest();
  return bytesToCode(mac, ACTIVATION_CODE_LENGTH);
}

/** Hash armazenado no banco (HMAC-SHA256 com pepper → 64 hex). */
export function hashActivationCode(pepper: string, broochId: string, version: number, code: string): string {
  if (!pepper || pepper.length < 32) throw new Error("ACTIVATION_HASH_PEPPER ausente ou curto demais");
  return createHmac("sha256", pepper).update(`${broochId}:${version}:${normalizeCode(code)}`).digest("hex");
}

/** Comparação em tempo constante. */
export function verifyActivationCode(
  pepper: string,
  broochId: string,
  version: number,
  candidate: string,
  storedHash: string,
): boolean {
  const normalized = normalizeCode(candidate);
  if (!isWellFormedActivationCode(normalized) || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashActivationCode(pepper, broochId, version, normalized), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Hash de IP para estatísticas/rate limit sem guardar o IP (LGPD). */
export function hashIp(salt: string, ip: string): string {
  return createHmac("sha256", salt || "brochelink").update(ip).digest("hex").slice(0, 32);
}
