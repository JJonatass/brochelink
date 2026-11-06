/** Evita open redirect no parâmetro ?next= : só caminhos internos. */
export function safeNext(next: string | null | undefined, fallback = "/painel"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return fallback;
  return next;
}
