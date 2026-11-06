/**
 * Visualizador/download do QR Code de um broche (PNG, SVG ou PDF).
 * Proprietário ou admin. O admin pode incluir o código de ativação (?codes=1).
 */
import type { NextRequest } from "next/server";
import { resolveActor } from "@/lib/actor";
import { deriveActivationCode } from "@/lib/codes";
import { publicBroochUrl, serverConfig } from "@/lib/config";
import { buildPdf, qrPng, qrSvg } from "@/lib/export/qr";
import { errorJson, guard, uuidSchema } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req);
  if (!g.ok) return g.response;
  const id = uuidSchema.safeParse((await ctx.params).id);
  if (!id.success) return errorJson(404, "not_found", "Broche não encontrado.");
  const resolved = await resolveActor(g.profile, id.data);
  if (!resolved) return errorJson(404, "not_found", "Broche não encontrado.");

  const cfg = serverConfig();
  const { brooch } = resolved;
  const url = publicBroochUrl(cfg.NEXT_PUBLIC_APP_URL, brooch.public_code);
  const params = req.nextUrl.searchParams;
  const format = params.get("format") ?? "svg";
  const download = params.get("download") === "1";
  const name = `brochelink-${brooch.public_code}`;
  const disposition = (ext: string) =>
    download ? { "Content-Disposition": `attachment; filename="${name}.${ext}"` } : ({} as Record<string, string>);
  const base = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

  if (format === "png") {
    const size = Math.min(Math.max(Number(params.get("size")) || 1024, 128), 4096);
    return new Response(new Uint8Array(await qrPng(url, size)), { headers: { ...base, "Content-Type": "image/png", ...disposition("png") } });
  }
  if (format === "svg") {
    return new Response(await qrSvg(url), {
      headers: { ...base, "Content-Type": "image/svg+xml; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", ...disposition("svg") },
    });
  }
  if (format === "pdf") {
    let activationCode: string | undefined;
    const includeCodes = params.get("codes") === "1" && resolved.actor === "admin" && brooch.status === "available";
    if (includeCodes) {
      const { data } = await createAdminClient()
        .from("activation_credentials")
        .select("code_version")
        .eq("brooch_id", brooch.id)
        .maybeSingle();
      if (data) activationCode = deriveActivationCode(cfg.ACTIVATION_CODE_SECRET, brooch.id, data.code_version as number);
      await createAdminClient().rpc("write_audit", {
        p_actor_id: g.profile.id, p_actor: "admin", p_action: "export.single_with_codes",
        p_entity_type: "brooch", p_entity_id: brooch.id, p_metadata: {},
      });
    }
    const pdf = await buildPdf(
      [{ sequence: brooch.sequence_in_batch, publicCode: brooch.public_code, url, activationCode }],
      { includeCodes: !!activationCode, title: `BrocheLink ${brooch.public_code}` },
    );
    return new Response(new Uint8Array(pdf), { headers: { ...base, "Content-Type": "application/pdf", ...disposition("pdf") } });
  }
  return errorJson(400, "invalid_format", "Formato inválido. Use png, svg ou pdf.");
}
