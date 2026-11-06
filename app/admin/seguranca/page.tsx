import { ShieldCheck, ShieldOff } from "lucide-react";
import { BlocklistForm, UnblockButton } from "@/components/admin/blocklist-form";
import { Alert, Badge, Card, PageHeader, formatDateTime } from "@/components/ui";
import { serverConfig } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { BUILTIN_BLOCKED_DOMAINS } from "@/lib/url-validation";

export const metadata = { title: "Segurança" };

export default async function SecurityPage() {
  const cfg = serverConfig();
  const supabase = await createClient();
  const { data: blocked } = await supabase.from("blocked_domains").select("domain, reason, created_at").order("created_at", { ascending: false }).limit(500);

  return (
    <div className="space-y-6">
      <PageHeader title="Segurança" description="Destinos bloqueados e parâmetros de proteção." />
      <Card className="space-y-4 p-5">
        <h2 className="inline-flex items-center gap-2 font-semibold">
          <ShieldOff className="size-4 text-bad" aria-hidden /> Domínios bloqueados
        </h2>
        <p className="text-sm text-muted">
          Bloquear um domínio também bloqueia seus subdomínios. Vale para novas ativações e alterações de destino. Broches
          que já apontam para um domínio bloqueado devem ser suspensos manualmente.
        </p>
        <BlocklistForm />
        <ul className="divide-y divide-line">
          {(blocked ?? []).map((b) => (
            <li key={b.domain} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="code font-medium">{b.domain}</span>
                {b.reason && <span className="ml-2 text-muted">{b.reason}</span>}
                <span className="block text-xs text-muted">{formatDateTime(b.created_at)}</span>
              </div>
              <UnblockButton domain={b.domain} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">Sempre bloqueados pelo código: {BUILTIN_BLOCKED_DOMAINS.join(", ")}.</p>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="inline-flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-ok" aria-hidden /> Proteções ativas
        </h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li>
            Google Safe Browsing:{" "}
            {cfg.GOOGLE_SAFE_BROWSING_API_KEY ? <Badge tone="ok">ativo</Badge> : <Badge tone="warn">desativado (sem chave)</Badge>}
          </li>
          <li>Tentativas de ativação antes do bloqueio: <strong>{cfg.ACTIVATION_MAX_ATTEMPTS}</strong></li>
          <li>Bloqueio inicial: <strong>{Math.round(cfg.ACTIVATION_LOCK_SECONDS / 60)} min</strong> (dobra a cada reincidência)</li>
          <li>Leituras contabilizadas por IP/minuto: <strong>{cfg.SCAN_RATE_LIMIT_PER_MINUTE}</strong></li>
          <li>Broches por lote: <strong>{cfg.MAX_QUANTITY_PER_BATCH.toLocaleString("pt-BR")}</strong></li>
          <li>Itens por arquivo exportado: <strong>{cfg.EXPORT_MAX_ITEMS.toLocaleString("pt-BR")}</strong></li>
        </ul>
        <Alert tone="info" title="Atribuição de administradores">
          Não há tela para promover administradores — isso é intencional. Use o SQL Editor do Supabase:{" "}
          <code className="code">select public.promote_to_admin(&apos;email@exemplo.com&apos;);</code>
        </Alert>
      </Card>
    </div>
  );
}
