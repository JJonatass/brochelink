/**
 * Relatórios CSV (admin). Gerados em streaming, página a página (1000 linhas),
 * para não carregar a tabela inteira em memória.
 *   /api/admin/reports/brooches | scans | batches | audit | history
 *   ?status=active  (brooches)   ?days=30 (scans/audit/history)
 */
import type { NextRequest } from "next/server";
import { CSV_BOM, csvRow } from "@/lib/export/csv";
import { publicBroochUrl, serverConfig } from "@/lib/config";
import { errorJson, guard, limit } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;
const PAGE = 1000;

type Report = {
  header: string[];
  query: (from: number, to: number) => PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
  row: (r: Record<string, unknown>) => unknown[];
};

function reports(req: NextRequest): Record<string, Report> {
  const db = createAdminClient();
  const app = serverConfig().NEXT_PUBLIC_APP_URL;
  const p = req.nextUrl.searchParams;
  const days = Math.min(Math.max(Number(p.get("days")) || 30, 1), 3650);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const status = p.get("status");

  return {
    brooches: {
      header: ["id", "identificador", "url_publica", "status", "lote", "sequencia", "proprietario_email", "destino", "leituras", "ultima_leitura", "ativado_em", "criado_em"],
      query: (f, t) => {
        let q = db
          .from("brooches")
          .select("id, public_code, status, batch_id, sequence_in_batch, destination_url, scan_count, last_scanned_at, activated_at, created_at, owner:profiles(email)")
          .order("created_at")
          .order("id")
          .range(f, t);
        if (status && ["available", "active", "suspended", "revoked"].includes(status)) q = q.eq("status", status);
        return q;
      },
      row: (r) => [
        r.id, r.public_code, publicBroochUrl(app, r.public_code as string), r.status, r.batch_id, r.sequence_in_batch,
        (r.owner as { email?: string } | null)?.email ?? "", r.destination_url, r.scan_count, r.last_scanned_at, r.activated_at, r.created_at,
      ],
    },
    scans: {
      header: ["id", "identificador", "resultado", "pais", "user_agent", "data_hora"],
      query: (f, t) =>
        db.from("scan_events").select("id, outcome, country, user_agent, scanned_at, brooch:brooches(public_code)").gte("scanned_at", since).order("id").range(f, t),
      row: (r) => [r.id, (r.brooch as { public_code?: string } | null)?.public_code, r.outcome, r.country, r.user_agent, r.scanned_at],
    },
    batches: {
      header: ["id", "rotulo", "solicitados", "gerados", "status", "criado_por", "criado_em", "concluido_em", "ultimo_erro"],
      query: (f, t) =>
        db.from("generation_batches").select("*, creator:profiles(email)").order("created_at").range(f, t),
      row: (r) => [r.id, r.label, r.requested_quantity, r.generated_quantity, r.status, (r.creator as { email?: string } | null)?.email, r.created_at, r.completed_at, r.last_error],
    },
    audit: {
      header: ["id", "data_hora", "ator", "ator_email", "acao", "entidade", "entidade_id", "metadados"],
      query: (f, t) =>
        db.from("audit_logs").select("*, who:profiles(email)").gte("created_at", since).order("id").range(f, t),
      row: (r) => [r.id, r.created_at, r.actor, (r.who as { email?: string } | null)?.email, r.action, r.entity_type, r.entity_id, r.metadata],
    },
    history: {
      header: ["id", "identificador", "motivo", "ator", "por_email", "destino_anterior", "novo_destino", "data_hora"],
      query: (f, t) =>
        db.from("destination_history").select("*, brooch:brooches(public_code), who:profiles(email)").gte("changed_at", since).order("id").range(f, t),
      row: (r) => [r.id, (r.brooch as { public_code?: string } | null)?.public_code, r.reason, r.actor, (r.who as { email?: string } | null)?.email, r.old_url, r.new_url, r.changed_at],
    },
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  const g = await guard(req, { admin: true });
  if (!g.ok) return g.response;
  const limited = await limit(`report:${g.profile.id}`, 30, 3600);
  if (limited) return limited;

  const { kind } = await ctx.params;
  const report = reports(req)[kind];
  if (!report) return errorJson(404, "not_found", "Relatório inexistente.");

  await createAdminClient().rpc("write_audit", {
    p_actor_id: g.profile.id, p_actor: "admin", p_action: "report.export", p_entity_type: "report", p_entity_id: kind,
    p_metadata: Object.fromEntries(req.nextUrl.searchParams),
  });

  const encoder = new TextEncoder();
  let offset = 0;
  let headerSent = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        controller.enqueue(encoder.encode(CSV_BOM + csvRow(report.header)));
        headerSent = true;
      }
      const { data, error } = await report.query(offset, offset + PAGE - 1);
      if (error) {
        controller.error(new Error(error.message));
        return;
      }
      const rows = data ?? [];
      if (rows.length) controller.enqueue(encoder.encode(rows.map((r) => csvRow(report.row(r))).join("")));
      offset += PAGE;
      if (rows.length < PAGE) controller.close();
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="brochelink-${kind}-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
