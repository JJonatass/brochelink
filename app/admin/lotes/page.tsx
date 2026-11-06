import Link from "next/link";
import { Boxes } from "lucide-react";
import { BatchGenerator, ResumeBatch, type BatchLite } from "@/components/admin/batch-generator";
import { Badge, Card, EmptyState, PageHeader, Pagination, formatDateTime, pageParam } from "@/components/ui";
import { serverConfig } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Lotes" };
const PAGE_SIZE = 15;
const TONE = { completed: "ok", processing: "info", pending: "neutral", failed: "bad" } as const;
const LABEL = { completed: "Concluído", processing: "Em andamento", pending: "Pendente", failed: "Interrompido" } as const;

export default async function BatchesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const page = pageParam((await searchParams).page);
  const cfg = serverConfig();
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("generation_batches")
    .select("id, label, requested_quantity, generated_quantity, status, created_at, completed_at, last_error", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  return (
    <div className="space-y-6">
      <PageHeader title="Lotes" description="Gere broches em qualquer quantidade e baixe os QR Codes para impressão." />
      <BatchGenerator maxPerBatch={cfg.MAX_QUANTITY_PER_BATCH} exportMax={cfg.EXPORT_MAX_ITEMS} />
      <section>
        <h2 className="mb-3 font-semibold">Histórico de lotes</h2>
        {!data?.length ? (
          <EmptyState icon={Boxes} title="Nenhum lote gerado ainda">
            Comece com 10 broches para testar a jornada completa.
          </EmptyState>
        ) : (
          <>
            <Card className="divide-y divide-line">
              {data.map((b) => (
                <div key={b.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/lotes/${b.id}`} className="font-medium hover:underline">
                        {b.label || `Lote ${b.id.slice(0, 8)}`}
                      </Link>
                      <Badge tone={TONE[b.status as keyof typeof TONE]}>{LABEL[b.status as keyof typeof LABEL]}</Badge>
                    </div>
                    <p className="text-xs text-muted">
                      {b.generated_quantity.toLocaleString("pt-BR")} / {b.requested_quantity.toLocaleString("pt-BR")} broches · criado em{" "}
                      {formatDateTime(b.created_at)}
                    </p>
                    {b.last_error && b.status !== "completed" && <p className="mt-1 text-xs text-bad">Último erro: {b.last_error}</p>}
                  </div>
                  <div className="shrink-0 sm:w-48">
                    {b.status === "completed" ? (
                      <Link href={`/admin/lotes/${b.id}`} className="text-sm text-enamel hover:underline">
                        Visualizar e baixar →
                      </Link>
                    ) : (
                      <ResumeBatch batch={b as BatchLite} />
                    )}
                  </div>
                </div>
              ))}
            </Card>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? null} href={(p) => `/admin/lotes?page=${p}`} />
          </>
        )}
      </section>
    </div>
  );
}
