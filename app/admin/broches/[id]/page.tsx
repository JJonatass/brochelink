import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileClock, User } from "lucide-react";
import { BROOCH_COLUMNS, BroochDetail, type BroochFull } from "@/components/brooch-detail";
import { Card, PageHeader, formatDateTime } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Broche" };

export default async function AdminBroochPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdminPage(`/admin/broches/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("brooches").select(`${BROOCH_COLUMNS}, owner:profiles(email, full_name)`).eq("id", id).maybeSingle();
  if (!data) notFound();
  const brooch = data as unknown as BroochFull & { owner: { email: string; full_name: string | null } | null };
  const { data: audit } = await supabase
    .from("audit_logs")
    .select("id, action, actor, created_at, metadata, who:profiles(email)")
    .eq("entity_type", "brooch")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Broche ${brooch.public_code}`}
        back={
          <Link href="/admin/broches" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Broches
          </Link>
        }
      />
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <span className="inline-flex items-center gap-2">
          <User className="size-4 text-muted" aria-hidden />
          {brooch.owner ? (
            <>
              {brooch.owner.full_name && <strong>{brooch.owner.full_name}</strong>} <span className="text-muted">{brooch.owner.email}</span>
            </>
          ) : (
            <span className="text-muted">Sem proprietário</span>
          )}
        </span>
        {brooch.batch_id && (
          <Link href={`/admin/lotes/${brooch.batch_id}`} className="text-enamel hover:underline">
            Ver lote (#{brooch.sequence_in_batch})
          </Link>
        )}
      </Card>
      <BroochDetail brooch={brooch} viewer={{ id: admin.id, kind: brooch.owner_id === admin.id ? "owner" : "admin" }} />
      <Card className="p-5">
        <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-muted">
          <FileClock className="size-4" aria-hidden /> Auditoria deste broche
        </h2>
        {audit?.length ? (
          <ul className="divide-y divide-line text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
                <span>
                  <code className="code text-xs">{a.action}</code>{" "}
                  <span className="text-muted">por {(a.who as unknown as { email: string } | null)?.email ?? a.actor}</span>
                </span>
                <span className="text-xs text-muted">{formatDateTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Sem registros.</p>
        )}
      </Card>
    </div>
  );
}
