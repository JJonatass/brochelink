import { describe, expect, it } from "vitest";
import { normalizeDomain, validateDestinationUrl } from "@/lib/url-validation";

const opts = { appHosts: ["brochelink.vercel.app"], blockedDomains: ["phishing.example.org"] };
const v = (u: string) => validateDestinationUrl(u, opts);

describe("URLs de destino aceitas", () => {
  it.each([
    "https://example.com",
    "https://www.linkedin.com/in/fulano",
    "https://github.com/user/repo?tab=readme#top",
    "https://sub.domínio.com.br/página",
    "https://EXAMPLE.com:443/x",
    "https://instagram.com/perfil/",
  ])("%s", (u) => {
    const r = v(u);
    expect(r.ok).toBe(true);
  });

  it("normaliza (punycode, porta padrão, caixa)", () => {
    const r = v("https://EXAMPLE.com:443/Path");
    expect(r).toEqual({ ok: true, url: "https://example.com/Path", hostname: "example.com" });
    const idn = v("https://domínio.com.br");
    expect(idn.ok && idn.hostname).toMatch(/^xn--domnio-[a-z0-9]+\.com\.br$/);
  });
});

describe("URLs de destino rejeitadas", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["http://example.com", "not_https"],
    ["javascript:alert(1)", "not_https"],
    ["data:text/html,<script>alert(1)</script>", "not_https"],
    ["ftp://example.com", "not_https"],
    ["example.com", "invalid"],
    ["//example.com", "invalid"],
    ["https://user:pass@example.com", "credentials"],
    ["https://example.com:8443", "port"],
    ["https://127.0.0.1", "ip_address"],
    ["https://10.0.0.5/admin", "ip_address"],
    ["https://169.254.169.254/latest/meta-data", "ip_address"],
    ["https://[::1]/", "ip_address"],
    ["https://0x7f.1/", "ip_address"],
    ["https://2130706433/", "ip_address"],
    ["https://localhost/", "internal_host"],
    ["https://intranet/", "internal_host"],
    ["https://printer.local/", "internal_host"],
    ["https://db.internal/", "internal_host"],
    ["https://x.home.arpa/", "internal_host"],
    ["https://brochelink.vercel.app/b/K7M2X9P4Q6R8", "self_redirect"],
    ["https://phishing.example.org", "blocked"],
    ["https://login.phishing.example.org/x", "blocked"],
    ["https://127.0.0.1.nip.io/", "blocked"],
    ["https://exa mple.com", "invalid"],
    ["https://example.com/\\evil", "invalid"],
    ["https://example.com/\nset-cookie", "invalid"],
    ["https://-bad-.com", "invalid_host"],
    ["https://example.c0m", "invalid_host"],
    [`https://example.com/${"a".repeat(2100)}`, "too_long"],
  ])("%s → %s", (u, error) => {
    expect(v(u)).toEqual({ ok: false, error });
  });

  it("não confunde subdomínio legítimo com domínio bloqueado", () => {
    expect(v("https://notphishing.example.org").ok).toBe(true);
  });
});

describe("normalizeDomain", () => {
  it.each([
    ["Evil.COM", "evil.com"],
    ["https://evil.com/path", "evil.com"],
    ["*.evil.com", "evil.com"],
    ["evil", null],
    ["", null],
  ])("%s → %s", (i, o) => expect(normalizeDomain(i)).toBe(o));
});
