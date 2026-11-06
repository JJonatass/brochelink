import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BROOCH_COLUMNS, BroochDetail, type BroochFull } from "@/components/brooch-detail";
import { PageHeader } from "@/components/ui";
import { requireUserPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Broche" };

export default async function OwnerBroochPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireUserPage(`/painel/broches/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  // RLS garante que só o proprietário (ou admin) enxerga o registro
  const { data } = await supabase.from("brooches").select(BROOCH_COLUMNS).eq("id", id).eq("owner_id", profile.id).maybeSingle();
  if (!data) notFound();
  const brooch = data as unknown as BroochFull;
  return (
    <div>
      <PageHeader
        title={`Broche ${brooch.public_code}`}
        back={
          <Link href="/painel" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Meus broches
          </Link>
        }
      />
      <BroochDetail brooch={brooch} viewer={{ id: profile.id, kind: "owner" }} />
    </div>
  );
}
