/**
 * Exporta uma faixa de um lote: pdf (folha de impressão), zip (PNG+SVG+CSV),
 * png/svg (zip só com esse formato) ou csv (manifesto).
 * A faixa é limitada a EXPORT_MAX_ITEMS para não estourar memória/tempo.
 */
import type { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { buildPdf, buildZip, manifestCsv } from "@/lib/export/qr";
import { loadBatchItems } from "@/lib/export/load";
import { errorJson, guard, limit, uuidSchema } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { admin: true });
  if (!g.ok) return g.response;
  const id = uuidSchema.safeParse((await ctx.params).id);
  if (!id.success) return errorJson(404, "not_found", "Lote não encontrado.");
  const limited = await limit(`export:${g.profile.id}`, 60, 3600);
  if (limited) return limited;

  const cfg = serverConfig();
  const p = req.nextUrl.searchParams;
  const format = p.get("format") ?? "pdf";
  if (!["pdf", "zip", "png", "svg", "csv"].includes(format)) return errorJson(400, "invalid_format", "Formato inválido.");
  const includeCodes = p.get("codes") === "1";

  const db = createAdminClient();
  const { data: batch } = await db.from("generation_batches").select("id, label, generated_quantity").eq("id", id.data).maybeSingle();
  if (!batch) return errorJson(404, "not_found", "Lote não encontrado.");

  const from = Math.max(1, Number(p.get("from")) || 1);
  const to = Math.min(Number(p.get("to")) || from + cfg.EXPORT_MAX_ITEMS - 1, from + cfg.EXPORT_MAX_ITEMS - 1);
  if (to < from) return errorJson(400, "invalid_range", "Faixa inválida.");

  const items = await loadBatchItems(id.data, from, to, includeCodes);
  if (items.length === 0) return errorJson(404, "empty", "Nenhum broche nesta faixa.");

  await db.rpc("write_audit", {
    p_actor_id: g.profile.id,
    p_actor: "admin",
    p_action: includeCodes ? "export.with_codes" : "export",
    p_entity_type: "generation_batch",
    p_entity_id: id.data,
    p_metadata: { format, from, to, count: items.length },
  });

  const title = `BrocheLink — ${batch.label ?? "lote"} (${from}–${to})`;
  const name = `brochelink-lote-${id.data.slice(0, 8)}-${from}-${to}`;
  const headers = (type: string, ext: string) => ({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${name}.${ext}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });

  if (format === "csv") return new Response(manifestCsv(items, includeCodes), { headers: headers("text/csv; charset=utf-8", "csv") });
  if (format === "pdf") {
    const pdf = await buildPdf(items, { includeCodes, title });
    return new Response(new Uint8Array(pdf), { headers: headers("application/pdf", "pdf") });
  }
  const zip = await buildZip(items, {
    png: format !== "svg",
    svg: format !== "png",
    includeCodes,
    pdf: format === "zip" ? await buildPdf(items, { includeCodes, title }) : undefined,
  });
  return new Response(new Uint8Array(zip), { headers: headers("application/zip", "zip") });
}
