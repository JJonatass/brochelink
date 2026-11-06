import Link from "next/link";
import { Ban, Boxes, CheckCircle2, CircleDashed, Download, PauseCircle, QrCode, ScanLine } from "lucide-react";
import { requireAdminPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, LinkButton, PageHeader, StatCard, buttonClass, formatDateTime, hostOf } from "@/components/ui";

export const metadata = { title: "Visão geral" };

type Overview = { total: number; available: number; active: number; suspended: number; revoked: number; activated: number; scans: number };

const REPORTS = [
  { kind: "brooches", label: "Broches" },
  { kind: "scans", label: "Leituras (30 dias)" },
  { kind: "history", label: "Histórico de destinos" },
  { kind: "batches", label: "Lotes" },
  { kind: "audit", label: "Auditoria (30 dias)" },
];

export default async function AdminHome() {
  // O layout já exige admin; repetir aqui protege renderizações diretas.
  await requireAdminPage("/admin");
  const supabase = await createClient();
  const [{ data: overview }, { data: recent }] = await Promise.all([
    supabase.rpc("admin_overview"),
    supabase
      .from("brooches")
      .select("id, public_code, destination_url, activated_at, owner:profiles(email)")
      .not("activated_at", "is", null)
      .order("activated_at", { ascending: false })
      .limit(8),
  ]);
  const o = (overview ?? { total: 0, available: 0, active: 0, suspended: 0, revoked: 0, activated: 0, scans: 0 }) as Overview;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visão geral"
        actions={
          <LinkButton href="/admin/lotes">
            <Boxes className="size-4" aria-hidden /> Gerar broches
          </LinkButton>
        }
      />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Emitidos" value={o.total} icon={QrCode} />
        <StatCard label="Ativados" value={o.activated} icon={CheckCircle2} tone="text-ok" />
        <StatCard label="Disponíveis" value={o.available} icon={CircleDashed} tone="text-info" />
        <StatCard label="Suspensos" value={o.suspended} icon={PauseCircle} tone="text-warn" />
        <StatCard label="Revogados" value={o.revoked} icon={Ban} tone="text-bad" />
        <StatCard label="Leituras" value={Number(o.scans)} icon={ScanLine} tone="text-enamel" />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section>
          <h2 className="mb-3 font-semibold">Ativações recentes</h2>
          {recent && recent.length > 0 ? (
            <Card className="divide-y divide-line">
              {recent.map((b) => (
                <Link key={b.id} href={`/admin/broches/${b.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-ink/[0.02]">
                  <div className="min-w-0">
                    <p className="code text-sm font-semibold">{b.public_code}</p>
                    <p className="truncate text-xs text-muted">
                      {(b.owner as unknown as { email: string } | null)?.email ?? "—"} → {hostOf(b.destination_url)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">{formatDateTime(b.activated_at)}</span>
                </Link>
              ))}
            </Card>
          ) : (
            <EmptyState icon={CheckCircle2} title="Nenhuma ativação ainda">
              Gere um lote, imprima os QR Codes e entregue os broches com seus códigos de ativação.
            </EmptyState>
          )}
        </section>
        <section>
          <h2 className="mb-3 font-semibold">Relatórios CSV</h2>
          <Card className="space-y-1 p-2">
            {REPORTS.map((r) => (
              <a key={r.kind} href={`/api/admin/reports/${r.kind}`} className={buttonClass("ghost", "h-10 w-full justify-between")}>
                {r.label} <Download className="size-4 text-muted" aria-hidden />
              </a>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}
