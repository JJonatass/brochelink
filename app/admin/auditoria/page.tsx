import { Download } from "lucide-react";
import { Card, PageHeader, Pagination, buttonClass, formatDateTime, inputClass, pageParam } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Auditoria" };
const PAGE_SIZE = 40;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const action = sp.acao?.replace(/[^a-z_.]/g, "").slice(0, 64) ?? "";
  const supabase = await createClient();
  let q = supabase
    .from("audit_logs")
    .select("id, actor, action, entity_type, entity_id, metadata, created_at, who:profiles(email)", { count: "estimated" })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (action) q = q.like("action", `${action}%`);
  const { data, count } = await q;

  return (
    <div>
      <PageHeader
        title="Auditoria"
        description="Registro somente-inserção de ações administrativas e de proprietários."
        actions={
          <a href="/api/admin/reports/audit?days=365" className={buttonClass("secondary")}>
            <Download className="size-4" aria-hidden /> CSV (12 meses)
          </a>
        }
      />
      <form className="mb-4 flex gap-2" action="/admin/auditoria">
        <input name="acao" defaultValue={action} placeholder="Filtrar ação (ex.: brooch., batch., export)" className={inputClass} aria-label="Filtrar por ação" />
        <button className={buttonClass("primary")}>Filtrar</button>
      </form>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="p-3 font-medium">Data/hora</th>
              <th className="p-3 font-medium">Ação</th>
              <th className="p-3 font-medium">Autor</th>
              <th className="p-3 font-medium">Entidade</th>
              <th className="p-3 font-medium">Detalhes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(data ?? []).map((a) => (
              <tr key={a.id} className="align-top">
                <td className="whitespace-nowrap p-3 text-muted">{formatDateTime(a.created_at)}</td>
                <td className="p-3">
                  <code className="code text-xs">{a.action}</code>
                </td>
                <td className="max-w-[12rem] truncate p-3">{(a.who as unknown as { email: string } | null)?.email ?? a.actor}</td>
                <td className="p-3 text-xs text-muted">
                  {a.entity_type}
                  <br />
                  <span className="code">{a.entity_id?.slice(0, 13)}</span>
                </td>
                <td className="max-w-[18rem] p-3">
                  <code className="code block truncate text-xs text-muted" title={JSON.stringify(a.metadata)}>
                    {JSON.stringify(a.metadata)}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? null} href={(p) => `/admin/auditoria?page=${p}${action ? `&acao=${action}` : ""}`} />
    </div>
  );
}
