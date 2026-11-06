import { ArrowRight, KeyRound, Link2, QrCode, RefreshCw, ScanLine, ShieldCheck } from "lucide-react";
import { Card, LinkButton } from "@/components/ui";
import { LogoMark } from "@/components/logo";

const steps = [
  { icon: ScanLine, title: "Escaneie", text: "Aponte a câmera para o QR Code do seu broche novo." },
  { icon: KeyRound, title: "Comprove a posse", text: "Entre na sua conta e digite o código secreto que veio com o broche." },
  { icon: Link2, title: "Escolha o destino", text: "Informe o endereço https:// para onde as leituras devem ir." },
  { icon: RefreshCw, title: "Mude quando quiser", text: "Troque o destino pelo painel. O broche físico continua o mesmo." },
];

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-[2rem] border border-line bg-surface px-6 py-12 sm:px-12 sm:py-16">
        <div className="enamel-dots pointer-events-none absolute -right-20 -top-20 size-80 rounded-full opacity-70" aria-hidden />
        <div className="relative max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-enamel-soft px-3 py-1 text-xs font-medium text-enamel">
            <QrCode className="size-3.5" aria-hidden /> QR Code dinâmico
          </span>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Um broche. <br className="hidden sm:block" />
            Infinitos destinos.
          </h1>
          <p className="mt-4 text-lg text-muted">
            Ative seu broche BrocheLink, conecte-o ao seu portfólio, perfil ou página — e altere o destino quando quiser,
            sem reimprimir nada.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/cadastro">
              Criar conta <ArrowRight className="size-4" aria-hidden />
            </LinkButton>
            <LinkButton href="/painel" variant="secondary">
              Meus broches
            </LinkButton>
          </div>
        </div>
        <LogoMark className="absolute bottom-8 right-8 hidden size-40 opacity-95 drop-shadow-xl md:block" />
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">Como funciona</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Card className="h-full p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-full bg-enamel-soft text-enamel">
                    <s.icon className="size-4" aria-hidden />
                  </span>
                  <span className="text-xs font-medium text-muted">Passo {i + 1}</span>
                </div>
                <p className="mt-3 font-medium">{s.title}</p>
                <p className="mt-1 text-sm text-muted">{s.text}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <ShieldCheck className="size-8 shrink-0 text-ok" aria-hidden />
          <div>
            <p className="font-medium">Seguro por padrão</p>
            <p className="text-sm text-muted">
              Só quem tem o código secreto do broche consegue ativá-lo. Destinos precisam usar HTTPS e passam por verificação
              de segurança. Quem escaneia não precisa de conta.
            </p>
          </div>
        </Card>
      </section>
    </div>
  );
}
