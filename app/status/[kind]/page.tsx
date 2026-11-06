import { notFound } from "next/navigation";
import { Ban, CircleSlash, PauseCircle, ServerCrash, type LucideIcon } from "lucide-react";
import { Card, LinkButton } from "@/components/ui";

const PAGES: Record<string, { icon: LucideIcon; title: string; text: string; tone: string }> = {
  suspenso: {
    icon: PauseCircle,
    title: "Broche temporariamente suspenso",
    text: "Este broche está pausado no momento. Se ele é seu, você pode reativá-lo pelo painel.",
    tone: "text-warn bg-warn-soft",
  },
  revogado: {
    icon: Ban,
    title: "Broche desativado",
    text: "Este broche foi revogado e não redireciona mais para nenhum endereço.",
    tone: "text-bad bg-bad-soft",
  },
  "nao-encontrado": {
    icon: CircleSlash,
    title: "Broche não encontrado",
    text: "Não encontramos nenhum broche com este código. Confira se o QR Code foi lido corretamente.",
    tone: "text-muted bg-ink/5",
  },
  indisponivel: {
    icon: ServerCrash,
    title: "Serviço temporariamente indisponível",
    text: "Não foi possível processar a leitura agora. Tente novamente em alguns instantes.",
    tone: "text-bad bg-bad-soft",
  },
};

export function generateStaticParams() {
  return Object.keys(PAGES).map((kind) => ({ kind }));
}

export const metadata = { robots: { index: false } };

export default async function StatusPage({ params }: { params: Promise<{ kind: string }> }) {
  const page = PAGES[(await params).kind];
  if (!page) notFound();
  return (
    <div className="mx-auto max-w-md pt-6">
      <Card className="p-8 text-center">
        <div className={`mx-auto mb-4 grid size-14 place-items-center rounded-full ${page.tone}`}>
          <page.icon className="size-7" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold">{page.title}</h1>
        <p className="mt-2 text-sm text-muted">{page.text}</p>
        <LinkButton href="/" variant="secondary" className="mt-6">
          Ir para o início
        </LinkButton>
      </Card>
    </div>
  );
}
