import "server-only";
import QRCode from "qrcode";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatActivationCode } from "@/lib/codes";
import { csvRow, CSV_BOM } from "./csv";

export type ExportItem = {
  sequence: number | null;
  publicCode: string;
  url: string;
  /** presente apenas quando o admin pede os códigos de ativação */
  activationCode?: string;
};

const QR_OPTIONS = { errorCorrectionLevel: "Q" as const, margin: 2 };

export async function qrPng(url: string, width = 1024): Promise<Buffer> {
  return QRCode.toBuffer(url, { ...QR_OPTIONS, type: "png", width });
}

export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...QR_OPTIONS, type: "svg" });
}

function fileBase(item: ExportItem) {
  const seq = item.sequence ? String(item.sequence).padStart(6, "0") + "-" : "";
  return `${seq}${item.publicCode}`;
}

export function manifestCsv(items: ExportItem[], includeCodes: boolean): string {
  let out = CSV_BOM + csvRow(["sequencia", "identificador", "url", ...(includeCodes ? ["codigo_ativacao"] : [])]);
  for (const i of items) {
    out += csvRow([i.sequence ?? "", i.publicCode, i.url, ...(includeCodes ? [formatActivationCode(i.activationCode ?? "")] : [])]);
  }
  return out;
}

export async function buildZip(
  items: ExportItem[],
  opts: { png: boolean; svg: boolean; includeCodes: boolean; pdf?: Uint8Array },
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const item of items) {
    if (opts.png) zip.file(`png/${fileBase(item)}.png`, await qrPng(item.url));
    if (opts.svg) zip.file(`svg/${fileBase(item)}.svg`, await qrSvg(item.url));
  }
  zip.file("manifesto.csv", manifestCsv(items, opts.includeCodes));
  if (opts.pdf) zip.file("folha-de-impressao.pdf", opts.pdf);
  zip.file(
    "LEIA-ME.txt",
    [
      "BrocheLink — pacote de QR Codes",
      "",
      "Cada QR Code aponta para a URL pública permanente do broche (/b/IDENTIFICADOR).",
      "O destino final é configurado pelo proprietário na ativação e pode mudar sem reimprimir.",
      opts.includeCodes
        ? "ATENÇÃO: o manifesto contém códigos secretos de ativação. Trate este arquivo como confidencial e entregue cada código somente junto ao broche correspondente."
        : "Este pacote não contém códigos de ativação.",
      "",
    ].join("\r\n"),
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/**
 * Folha A4 para impressão: 3 × 4 cartões por página, com linhas de corte.
 * Cada cartão traz o QR, o identificador e (opcionalmente) o código de ativação.
 */
export async function buildPdf(items: ExportItem[], opts: { includeCodes: boolean; title?: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title ?? "BrocheLink — QR Codes");
  pdf.setCreator("BrocheLink");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.CourierBold);

  const W = 595.28, H = 841.89, M = 28, COLS = 3, ROWS = 4;
  const cw = (W - 2 * M) / COLS;
  const ch = (H - 2 * M - 16) / ROWS;
  const perPage = COLS * ROWS;

  for (let p = 0; p * perPage < items.length; p++) {
    const page = pdf.addPage([W, H]);
    page.drawText(`${opts.title ?? "BrocheLink"} — página ${p + 1} de ${Math.ceil(items.length / perPage)}`, {
      x: M, y: H - M + 4, size: 8, font, color: rgb(0.45, 0.45, 0.5),
    });
    const slice = items.slice(p * perPage, (p + 1) * perPage);
    for (let i = 0; i < slice.length; i++) {
      const item = slice[i];
      const col = i % COLS, row = Math.floor(i / COLS);
      const x = M + col * cw;
      const y = H - M - 16 - (row + 1) * ch;
      page.drawRectangle({
        x: x + 4, y: y + 4, width: cw - 8, height: ch - 8,
        borderColor: rgb(0.75, 0.75, 0.8), borderWidth: 0.5, borderDashArray: [3, 3],
      });
      const png = await pdf.embedPng(await qrPng(item.url, 600));
      const qrSize = Math.min(cw - 40, ch - (opts.includeCodes ? 78 : 56));
      page.drawImage(png, { x: x + (cw - qrSize) / 2, y: y + ch - qrSize - 14, width: qrSize, height: qrSize });
      const center = (text: string, size: number, f = font, dy = 0, color = rgb(0.1, 0.1, 0.15)) =>
        page.drawText(text, { x: x + (cw - f.widthOfTextAtSize(text, size)) / 2, y: y + dy, size, font: f, color });
      center(item.publicCode, 10, mono, opts.includeCodes ? 46 : 26);
      if (item.sequence) center(`#${item.sequence}`, 7, font, opts.includeCodes ? 36 : 16, rgb(0.45, 0.45, 0.5));
      if (opts.includeCodes && item.activationCode) {
        center("Código de ativação", 7, bold, 24, rgb(0.35, 0.2, 0.6));
        center(formatActivationCode(item.activationCode), 11, mono, 12);
      }
    }
  }
  return pdf.save();
}
