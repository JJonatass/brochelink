import { redirect } from "next/navigation";
import { AuthForm } from "@/components/forms/auth-form";
import { Alert } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/navigation";

export const metadata = { title: "Criar conta" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getCurrentUser()) redirect(next);
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Criar conta</h1>
        <p className="mt-1 text-sm text-muted">Crie sua conta para ativar e gerenciar seus broches.</p>
      </div>
      {next.startsWith("/ativar/") && (
        <Alert tone="info" title="Ativação de broche">
          Entre ou crie sua conta para continuar a ativação do seu broche.
        </Alert>
      )}
      {sp.erro === "confirmacao" && <Alert tone="bad">O link de confirmação é inválido ou expirou.</Alert>}
      <AuthForm mode="signup" next={next} />
    </div>
  );
}
