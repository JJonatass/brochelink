import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { decideRedirect, isLikelyBot, REDIRECT_HEADERS } from "@/lib/redirect";
import { safeNext } from "@/lib/navigation";
import { csvCell, csvRow } from "@/lib/export/csv";
import { buildPdf, buildZip, qrPng, qrSvg } from "@/lib/export/qr";
import { exportParts } from "@/lib/services/generation";
import { allowedActions, nextStatus } from "@/lib/brooches/transitions";
import { publicBroochUrl } from "@/lib/config";

const APP = "https://brochelink.vercel.app";

describe("redirecionamento", () => {
  it("broche ativo → destino com 302", () => {
    expect(decideRedirect({ brooch_id: "1", status: "active", destination_url: "https://x.com" }, APP, "K7M2X9P4Q6R8")).toEqual({
      status: 302,
      location: "https://x.com",
      kind: "destination",
    });
  });
  it("disponível → ativação; suspenso/revogado/inexistente → páginas de status", () => {
    expect(decideRedirect({ brooch_id: "1", status: "available", destination_url: null }, APP, "K7M2X9P4Q6R8").location).toBe(
      `${APP}/ativar/K7M2X9P4Q6R8`,
    );
    expect(decideRedirect({ brooch_id: "1", status: "suspended", destination_url: null }, APP, "X").location).toBe(`${APP}/status/suspenso`);
    expect(decideRedirect({ brooch_id: "1", status: "revoked", destination_url: null }, APP, "X").location).toBe(`${APP}/status/revogado`);
    expect(decideRedirect(null, APP, "X").location).toBe(`${APP}/status/nao-encontrado`);
  });
  it("nunca é armazenado em cache", () => {
    expect(REDIRECT_HEADERS["Cache-Control"]).toContain("no-store");
    expect(REDIRECT_HEADERS["CDN-Cache-Control"]).toBe("no-store");
  });
  it("identifica robôs de pré-visualização", () => {
    expect(isLikelyBot("WhatsApp/2.23")).toBe(true);
    expect(isLikelyBot("facebookexternalhit/1.1")).toBe(true);
    expect(isLikelyBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(false);
  });
  it("URL pública permanente", () => {
    expect(publicBroochUrl(`${APP}/`, "K7M2X9P4Q6R8")).toBe("https://brochelink.vercel.app/b/K7M2X9P4Q6R8");
  });
});

describe("safeNext (open redirect)", () => {
  it.each([
    ["/painel", "/painel"],
    ["/ativar/K7M2X9P4Q6R8", "/ativar/K7M2X9P4Q6R8"],
    ["https://evil.com", "/painel"],
    ["//evil.com", "/painel"],
    ["/\\evil.com", "/painel"],
    [null, "/painel"],
  ])("%s → %s", (i, o) => expect(safeNext(i)).toBe(o));
});

describe("CSV seguro", () => {
  it("escapa aspas e bloqueia fórmulas", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+55 81")).toBe("'+55 81");
    expect(csvRow([1, null, "x"])).toBe("1,,x\r\n");
  });
});

describe("transições no front", () => {
  const owner = { kind: "owner" as const, id: "u1" };
  const admin = { kind: "admin" as const, id: "a1" };
  it("proprietário suspende/reativa; não revoga", () => {
    const b = { status: "active" as const, owner_id: "u1", destination_url: "https://x.com", suspended_by: null };
    expect(allowedActions(b, owner)).toEqual(["suspend"]);
    expect(nextStatus({ ...b, status: "suspended", suspended_by: "owner" }, owner, "reactivate")).toBe("active");
    expect(nextStatus({ ...b, status: "suspended", suspended_by: "admin" }, owner, "reactivate")).toBeNull();
    expect(nextStatus(b, { kind: "owner", id: "outro" }, "suspend")).toBeNull();
  });
  it("admin suspende, reativa (volta a disponível se nunca ativado) e revoga", () => {
    const avail = { status: "available" as const, owner_id: null, destination_url: null, suspended_by: null };
    expect(allowedActions(avail, admin)).toEqual(["suspend", "revoke"]);
    expect(nextStatus({ ...avail, status: "suspended", suspended_by: "admin" }, admin, "reactivate")).toBe("available");
    expect(allowedActions({ ...avail, status: "revoked" }, admin)).toEqual([]);
  });
});

describe("exportação de QR Codes", () => {
  const items = Array.from({ length: 14 }, (_, i) => ({
    sequence: i + 1,
    publicCode: `K7M2X9P4Q6R${"23456789ABCDEFGH"[i]}`,
    url: `${APP}/b/K7M2X9P4Q6R${"23456789ABCDEFGH"[i]}`,
    activationCode: "ABCDEFGHJKLM",
  }));

  it("PNG e SVG válidos", async () => {
    const png = await qrPng(items[0].url, 256);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(await qrSvg(items[0].url)).toMatch(/^<svg/);
  });

  it("PDF de impressão paginado (12 por página)", async () => {
    const pdf = await PDFDocument.load(await buildPdf(items, { includeCodes: true }));
    expect(pdf.getPageCount()).toBe(2);
  });

  it("ZIP com PNG, SVG, manifesto e aviso de confidencialidade", async () => {
    const zip = await JSZip.loadAsync(await buildZip(items.slice(0, 3), { png: true, svg: true, includeCodes: true }));
    const names = Object.keys(zip.files);
    expect(names.filter((n) => n.startsWith("png/") && n.endsWith(".png"))).toHaveLength(3);
    expect(names.filter((n) => n.startsWith("svg/") && n.endsWith(".svg"))).toHaveLength(3);
    const manifest = await zip.file("manifesto.csv")!.async("string");
    expect(manifest).toContain("codigo_ativacao");
    expect(manifest).toContain("ABCD-EFGH-JKLM");
    expect(await zip.file("LEIA-ME.txt")!.async("string")).toContain("confidencial");
  });

  it("sem códigos quando não solicitado", async () => {
    const zip = await JSZip.loadAsync(await buildZip(items.slice(0, 1), { png: false, svg: true, includeCodes: false }));
    const manifest = await zip.file("manifesto.csv")!.async("string");
    expect(manifest).not.toContain("codigo_ativacao");
    expect(manifest).not.toContain("ABCD");
  });

  it("divide exportações grandes em partes", () => {
    expect(exportParts(1234, 500)).toEqual([
      { part: 1, from: 1, to: 500 },
      { part: 2, from: 501, to: 1000 },
      { part: 3, from: 1001, to: 1234 },
    ]);
    expect(exportParts(10, 500)).toEqual([{ part: 1, from: 1, to: 10 }]);
  });
});
