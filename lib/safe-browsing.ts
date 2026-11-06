/**
 * Verificação opcional no Google Safe Browsing (Lookup API v4).
 * Ativada quando GOOGLE_SAFE_BROWSING_API_KEY está definida.
 *
 * A requisição vai para um endpoint FIXO do Google — a URL do usuário é
 * enviada como dado, nunca acessada pelo servidor (sem SSRF).
 * Em caso de indisponibilidade do serviço, falha aberta (permite) e registra
 * no log; as demais validações continuam valendo.
 */
export async function isUrlFlaggedBySafeBrowsing(url: string, apiKey: string | undefined): Promise<boolean> {
  if (!apiKey) return false;
  try {
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "brochelink", clientVersion: "1.0.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[safe-browsing] HTTP ${res.status}`);
      return false;
    }
    const data = (await res.json()) as { matches?: unknown[] };
    return Array.isArray(data.matches) && data.matches.length > 0;
  } catch (e) {
    console.warn("[safe-browsing] indisponível:", (e as Error).message);
    return false;
  }
}
