import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ExportPanel, ProgressBar, ResumeBatch, type BatchLite } from "@/components/admin/batch-generator";
import { Card, PageHeader, Pagination, StatusBadge, formatDateTime, hostOf, pageParam } from "@/components/ui";
import type { BroochStatus } from "@/lib/brooches/transitions";
import { serverConfig } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Lote" };
const PAGE_SIZE = 50;

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const page = pageParam((await searchParams).page);
  const cfg = serverConfig();
  const supabase = await createClient();
  const { data: batch } = await supabase.from("generation_batches").select("*, creator:profiles(email)").eq("id", id).maybeSingle();
  if (!batch) notFound();
  const { data: brooches } = await supabase
    .from("brooches")
    .select("id, public_code, sequence_in_batch, status, destination_url, scan_count")
    .eq("batch_id", id)
    .order("sequence_in_batch")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title={batch.label || `Lote ${id.slice(0, 8)}`}
        description={`Criado por ${(batch.creator as { email?: string } | null)?.email ?? "—"} em ${formatDateTime(batch.created_at)}`}
        back={
          <Link href="/admin/lotes" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Lotes
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-medium text-muted">Progresso</h2>
          <ProgressBar value={batch.generated_quantity} max={batch.requested_quantity} />
          {batch.status !== "completed" && <ResumeBatch batch={batch as BatchLite} />}
          {batch.completed_at && <p className="text-xs text-muted">Concluído em {formatDateTime(batch.completed_at)}</p>}
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-medium text-muted">Exportar QR Codes</h2>
          {batch.generated_quantity > 0 ? (
            <ExportPanel batchId={id} total={batch.generated_quantity} exportMax={cfg.EXPORT_MAX_ITEMS} />
          ) : (
            <p className="text-sm text-muted">Nenhum broche gerado ainda.</p>
          )}
        </Card>
      </div>

      <section>
        <h2 className="mb-3 font-semibold">Broches do lote</h2>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="p-3 font-medium">#</th>
                <th className="p-3 font-medium">Identificador</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Destino</th>
                <th className="p-3 text-right font-medium">Leituras</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(brooches ?? []).map((b) => (
                <tr key={b.id} className="hover:bg-ink/[0.02]">
                  <td className="p-3 text-muted tabular-nums">{b.sequence_in_batch}</td>
                  <td className="p-3">
                    <Link href={`/admin/broches/${b.id}`} className="code font-medium hover:underline">
                      {b.public_code}
                    </Link>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={b.status as BroochStatus} />
                  </td>
                  <td className="max-w-[16rem] truncate p-3 text-muted">{hostOf(b.destination_url)}</td>
                  <td className="p-3 text-right tabular-nums">{Number(b.scan_count).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Pagination page={page} pageSize={PAGE_SIZE} total={batch.generated_quantity} href={(p) => `/admin/lotes/${id}?page=${p}`} />
      </section>
    </div>
  );
}
