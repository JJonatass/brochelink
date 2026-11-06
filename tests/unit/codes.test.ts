import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  deriveActivationCode,
  formatActivationCode,
  generatePublicCode,
  hashActivationCode,
  isValidPublicCode,
  normalizeCode,
  verifyActivationCode,
} from "@/lib/codes";

const SECRET = "s".repeat(40);
const PEPPER = "p".repeat(40);
const ID = "4b0b6e6e-6b8f-4f39-9a55-3f3e4e0f8a11";

describe("identificadores públicos", () => {
  it("têm 12 caracteres do alfabeto sem ambíguos", () => {
    for (let i = 0; i < 1000; i++) {
      const c = generatePublicCode();
      expect(isValidPublicCode(c)).toBe(true);
      expect(c).not.toMatch(/[01IO]/);
    }
    expect(CODE_ALPHABET).toHaveLength(32);
  });

  it("não colidem em 100 mil gerações (60 bits de entropia)", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100_000; i++) set.add(generatePublicCode());
    expect(set.size).toBe(100_000);
  });

  it("distribuição aproximadamente uniforme", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 20_000; i++) for (const ch of generatePublicCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const expected = (20_000 * 12) / 32;
    for (const n of counts.values()) expect(Math.abs(n - expected) / expected).toBeLessThan(0.08);
  });
});

describe("códigos de ativação", () => {
  it("são determinísticos por broche e versão, e independentes do identificador", () => {
    const a = deriveActivationCode(SECRET, ID, 1);
    expect(deriveActivationCode(SECRET, ID, 1)).toBe(a);
    expect(deriveActivationCode(SECRET, ID, 2)).not.toBe(a);
    expect(deriveActivationCode("x".repeat(40), ID, 1)).not.toBe(a);
    expect(isValidPublicCode(a)).toBe(true);
  });

  it("verificação aceita formatação humana e rejeita código errado", () => {
    const code = deriveActivationCode(SECRET, ID, 1);
    const hash = hashActivationCode(PEPPER, ID, 1, code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(code);
    expect(verifyActivationCode(PEPPER, ID, 1, formatActivationCode(code).toLowerCase(), hash)).toBe(true);
    expect(verifyActivationCode(PEPPER, ID, 1, ` ${code} `, hash)).toBe(true);
    expect(verifyActivationCode(PEPPER, ID, 2, code, hash)).toBe(false);
    expect(verifyActivationCode(PEPPER, "outro-id", 1, code, hash)).toBe(false);
    expect(verifyActivationCode(PEPPER, ID, 1, "AAAAAAAAAAAA", hash)).toBe(false);
    expect(verifyActivationCode(PEPPER, ID, 1, "curto", hash)).toBe(false);
    expect(verifyActivationCode(PEPPER, ID, 1, code, "nao-e-hash")).toBe(false);
  });

  it("exige segredos fortes", () => {
    expect(() => deriveActivationCode("curto", ID, 1)).toThrow();
    expect(() => hashActivationCode("curto", ID, 1, "X")).toThrow();
  });

  it("normaliza entradas", () => {
    expect(normalizeCode("k7m2-x9p4 q6r8")).toBe("K7M2X9P4Q6R8");
    expect(formatActivationCode("K7M2X9P4Q6R8")).toBe("K7M2-X9P4-Q6R8");
  });
});
