import Link from "next/link";
import { Download, QrCode, Search } from "lucide-react";
import { Card, EmptyState, PageHeader, Pagination, StatusBadge, buttonClass, cx, formatDateTime, hostOf, inputClass, pageParam } from "@/components/ui";
import { STATUS_LABELS, type BroochStatus } from "@/lib/brooches/transitions";
import { normalizeCode } from "@/lib/codes";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Broches" };
const PAGE_SIZE = 25;
const STATUSES = ["available", "active", "suspended", "revoked"] as const;

export default async function AdminBrooches({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const status = STATUSES.includes(sp.status as BroochStatus) ? (sp.status as BroochStatus) : undefined;
  const q = sp.q ? normalizeCode(sp.q).replace(/[^23456789A-Z]/g, "").slice(0, 12) : "";
  const email = sp.email?.trim().toLowerCase().slice(0, 120) ?? "";

  const supabase = await createClient();
  let ownerIds: string[] | null = null;
  if (email) {
    const { data } = await supabase.from("profiles").select("id").ilike("email", `%${email.replace(/[%_]/g, "")}%`).limit(50);
    ownerIds = (data ?? []).map((p) => p.id);
  }
  let query = supabase
    .from("brooches")
    .select("id, public_code, status, destination_url, scan_count, created_at, activated_at, owner:profiles(email)", { count: "estimated" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("public_code", `${q}%`);
  if (ownerIds) query = query.in("owner_id", ownerIds.length ? ownerIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, count } = await query;

  const qs = (p: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const merged = { status, q: q || undefined, email: email || undefined, ...p };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && u.set(k, String(v)));
    return `/admin/broches?${u}`;
  };

  return (
    <div>
      <PageHeader
        title="Broches"
        actions={
          <a href={`/api/admin/reports/brooches${status ? `?status=${status}` : ""}`} className={buttonClass("secondary")}>
            <Download className="size-4" aria-hidden /> CSV
          </a>
        }
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]" action="/admin/broches">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input name="q" defaultValue={q} placeholder="Identificador" className={cx(inputClass, "code pl-10 uppercase")} aria-label="Buscar por identificador" />
        </div>
        <input name="email" defaultValue={email} placeholder="E-mail do proprietário" className={inputClass} aria-label="Buscar por e-mail do proprietário" />
        <select name="status" defaultValue={status ?? ""} className={inputClass} aria-label="Filtrar por status">
          <option value="">Todos os status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button className={buttonClass("primary")}>Filtrar</button>
      </form>

      {!data?.length ? (
        <EmptyState icon={QrCode} title="Nenhum broche encontrado" />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="p-3 font-medium">Identificador</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Proprietário</th>
                  <th className="p-3 font-medium">Destino</th>
                  <th className="p-3 text-right font-medium">Leituras</th>
                  <th className="p-3 font-medium">Criado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((b) => (
                  <tr key={b.id} className="hover:bg-ink/[0.02]">
                    <td className="p-3">
                      <Link href={`/admin/broches/${b.id}`} className="code font-medium hover:underline">
                        {b.public_code}
                      </Link>
                    </td>
                    <td className="p-3">
                      <StatusBadge status={b.status as BroochStatus} />
                    </td>
                    <td className="max-w-[12rem] truncate p-3 text-muted">{(b.owner as unknown as { email: string } | null)?.email ?? "—"}</td>
                    <td className="max-w-[14rem] truncate p-3 text-muted">{hostOf(b.destination_url)}</td>
                    <td className="p-3 text-right tabular-nums">{Number(b.scan_count).toLocaleString("pt-BR")}</td>
                    <td className="whitespace-nowrap p-3 text-muted">{formatDateTime(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? null} href={(p) => qs({ page: p })} />
        </>
      )}
    </div>
  );
}
