import { notFound } from "next/navigation";
import { CheckCircle2, LogIn, UserPlus } from "lucide-react";
import { ActivationForm } from "@/components/forms/activation-form";
import { LogoMark } from "@/components/logo";
import { Alert, Card, LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { isValidPublicCode, normalizeCode } from "@/lib/codes";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Ativar broche", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ActivatePage({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  if (!isValidPublicCode(code)) notFound();

  // Leitura mínima e pública: apenas status/dono (nunca credenciais).
  const { data: brooch } = await createAdminClient()
    .from("brooches")
    .select("id, status, owner_id")
    .eq("public_code", code)
    .maybeSingle();
  if (!brooch) notFound();

  const user = await getCurrentUser();
  const next = `/ativar/${code}`;

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="flex items-center gap-3">
        <LogoMark className="size-12" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ativar broche</h1>
          <p className="code text-sm text-muted">{code}</p>
        </div>
      </div>

      {brooch.status !== "available" ? (
        brooch.owner_id && user?.id === brooch.owner_id ? (
          <Card className="p-6 text-center">
            <CheckCircle2 className="mx-auto size-10 text-ok" aria-hidden />
            <p className="mt-3 font-medium">Este broche já está ativado na sua conta.</p>
            <LinkButton href={`/painel/broches/${brooch.id}`} className="mt-4">
              Gerenciar broche
            </LinkButton>
          </Card>
        ) : (
          <Alert tone="warn" title="Broche indisponível para ativação">
            Este broche já foi ativado ou está bloqueado. Se você acredita que isso é um erro, entre em contato com quem
            forneceu o broche.
          </Alert>
        )
      ) : !user ? (
        <Card className="space-y-4 p-6">
          <p className="text-sm text-muted">
            Este broche ainda não foi ativado. Para ativá-lo, entre na sua conta (ou crie uma) e tenha em mãos o{" "}
            <strong className="text-ink">código de ativação</strong> que veio junto com ele.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <LinkButton href={`/cadastro?next=${encodeURIComponent(next)}`} className="flex-1">
              <UserPlus className="size-4" aria-hidden /> Criar conta
            </LinkButton>
            <LinkButton href={`/login?next=${encodeURIComponent(next)}`} variant="secondary" className="flex-1">
              <LogIn className="size-4" aria-hidden /> Entrar
            </LinkButton>
          </div>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted">
            Conectado como <strong className="text-ink">{user.email}</strong>.
          </p>
          <ActivationForm publicCode={code} />
        </>
      )}
    </div>
  );
}
