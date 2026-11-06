import { CircleSlash } from "lucide-react";
import { Card, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md pt-6">
      <Card className="p-8 text-center">
        <CircleSlash className="mx-auto mb-4 size-10 text-muted" aria-hidden />
        <h1 className="text-xl font-semibold">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted">O endereço acessado não existe ou foi movido.</p>
        <LinkButton href="/" variant="secondary" className="mt-6">
          Ir para o início
        </LinkButton>
      </Card>
    </div>
  );
}
