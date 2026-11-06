import Link from "next/link";
import { Ban, CircleDashed, ExternalLink, PauseCircle } from "lucide-react";
import { ScanChart } from "@/components/scan-chart";
import { Card, PageHeader, StatCard, StatusBadge, buttonClass, cx, isoDaysAgo } from "@/components/ui";
import type { BroochStatus } from "@/lib/brooches/transitions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Estatísticas" };
const RANGES = [7, 30, 90, 365];

export default async function StatsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const days = RANGES.includes(Number((await searchParams).dias)) ? Number((await searchParams).dias) : 30;
  const since = isoDaysAgo(days);
  const supabase = await createClient();
  const countOutcome = (outcome: string) =>
    supabase.from("scan_events").select("id", { count: "exact", head: true }).eq("outcome", outcome).gte("scanned_at", since);

  const [{ data: perDay }, { data: top }, redirected, activation, suspended, revoked] = await Promise.all([
    supabase.rpc("scans_per_day", { p_brooch_id: null, p_days: days }),
    supabase
      .from("brooches")
      .select("id, public_code, status, scan_count, owner:profiles(email)")
      .gt("scan_count", 0)
      .order("scan_count", { ascending: false })
      .limit(10),
    countOutcome("redirected"),
    countOutcome("activation"),
    countOutcome("suspended"),
    countOutcome("revoked"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estatísticas de leitura"
        actions={RANGES.map((r) => (
          <Link key={r} href={`/admin/estatisticas?dias=${r}`} className={cx(buttonClass(r === days ? "primary" : "secondary"), "h-9")}>
            {r} dias
          </Link>
        ))}
      />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Redirecionadas" value={redirected.count ?? 0} icon={ExternalLink} tone="text-ok" />
        <StatCard label="Para ativação" value={activation.count ?? 0} icon={CircleDashed} tone="text-info" />
        <StatCard label="Em suspensos" value={suspended.count ?? 0} icon={PauseCircle} tone="text-warn" />
        <StatCard label="Em revogados" value={revoked.count ?? 0} icon={Ban} tone="text-bad" />
      </section>
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-medium text-muted">Leituras por dia (horário de Brasília)</h2>
        <ScanChart data={(perDay ?? []) as { day: string; scans: number }[]} />
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-medium text-muted">Broches mais lidos (total)</h2>
        <ol className="divide-y divide-line">
          {(top ?? []).map((b, i) => (
            <li key={b.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-6 text-muted tabular-nums">{i + 1}</span>
              <Link href={`/admin/broches/${b.id}`} className="code font-medium hover:underline">
                {b.public_code}
              </Link>
              <StatusBadge status={b.status as BroochStatus} />
              <span className="hidden truncate text-muted sm:inline">{(b.owner as unknown as { email: string } | null)?.email}</span>
              <span className="ml-auto font-medium tabular-nums">{Number(b.scan_count).toLocaleString("pt-BR")}</span>
            </li>
          ))}
          {!top?.length && <li className="py-2 text-sm text-muted">Ainda não há leituras.</li>}
        </ol>
      </Card>
    </div>
  );
}
