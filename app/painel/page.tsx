import Link from "next/link";
import { ChevronRight, QrCode, ScanLine } from "lucide-react";
import { requireUserPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, Card, PageHeader, Pagination, StatusBadge, hostOf, pageParam } from "@/components/ui";
import type { BroochStatus } from "@/lib/brooches/transitions";

export const metadata = { title: "Meus broches" };
const PAGE_SIZE = 20;

export default async function OwnerDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const profile = await requireUserPage("/painel");
  const page = pageParam((await searchParams).page);
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("brooches")
    .select("id, public_code, status, destination_url, scan_count, last_scanned_at", { count: "exact" })
    .eq("owner_id", profile.id)
    .order("activated_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const brooches = (data ?? []) as { id: string; public_code: string; status: BroochStatus; destination_url: string | null; scan_count: number }[];
  const totalScans = brooches.reduce((s, b) => s + Number(b.scan_count), 0);

  return (
    <div>
      <PageHeader
        title="Meus broches"
        description={profile.full_name ? `Olá, ${profile.full_name.split(" ")[0]}!` : profile.email}
      />
      {brooches.length === 0 && page === 1 ? (
        <EmptyState icon={QrCode} title="Você ainda não tem broches ativados">
          Escaneie o QR Code de um broche novo com a câmera do celular para começar a ativação.
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            {count ?? 0} broche(s) · {totalScans.toLocaleString("pt-BR")} leituras nesta página
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {brooches.map((b) => (
              <li key={b.id}>
                <Link href={`/painel/broches/${b.id}`} className="block">
                  <Card className="flex items-center gap-4 p-4 transition-colors hover:border-ink/25">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="code text-sm font-semibold">{b.public_code}</span>
                        <StatusBadge status={b.status} />
                      </div>
                      <p className="mt-1 truncate text-sm text-muted">{hostOf(b.destination_url)}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted">
                        <ScanLine className="size-3.5" aria-hidden /> {Number(b.scan_count).toLocaleString("pt-BR")} leituras
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? null} href={(p) => `/painel?page=${p}`} />
        </>
      )}
    </div>
  );
}
