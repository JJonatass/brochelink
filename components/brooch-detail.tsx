import { Download, ExternalLink, History, QrCode, ScanLine } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { allowedActions, type ActorKind, type BroochStatus } from "@/lib/brooches/transitions";
import { publicBroochUrl, serverConfig } from "@/lib/config";
import { ScanChart } from "./scan-chart";
import { CopyButton, DestinationEditor, ResetCodeButton, StatusButtons } from "./brooch-controls";
import { Alert, Badge, Card, StatusBadge, buttonClass, formatDateTime } from "./ui";

export type BroochFull = {
  id: string;
  public_code: string;
  status: BroochStatus;
  owner_id: string | null;
  destination_url: string | null;
  suspended_by: ActorKind | null;
  scan_count: number;
  last_scanned_at: string | null;
  activated_at: string | null;
  created_at: string;
  batch_id: string | null;
  sequence_in_batch: number | null;
};

const REASONS = { activation: "Ativação", owner_update: "Alterado pelo proprietário", admin_update: "Alterado pelo admin" } as const;

/** Detalhe de um broche — usado pelo painel do proprietário e pelo admin. */
export async function BroochDetail({ brooch, viewer }: { brooch: BroochFull; viewer: { id: string; kind: "owner" | "admin" } }) {
  const supabase = await createClient();
  const [{ data: perDay }, { data: history }] = await Promise.all([
    supabase.rpc("scans_per_day", { p_brooch_id: brooch.id, p_days: 30 }),
    supabase
      .from("destination_history")
      .select("id, reason, old_url, new_url, changed_at, actor")
      .eq("brooch_id", brooch.id)
      .order("changed_at", { ascending: false })
      .limit(20),
  ]);
  const url = publicBroochUrl(serverConfig().NEXT_PUBLIC_APP_URL, brooch.public_code);
  const actions = allowedActions(brooch, viewer);
  const qr = `/api/brooches/${brooch.id}/qr`;
  const canEditDestination = brooch.owner_id !== null && (brooch.status === "active" || brooch.status === "suspended");

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-4">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <QrCode className="size-4" aria-hidden /> QR Code
            </span>
            <StatusBadge status={brooch.status} />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${qr}?format=svg`} alt={`QR Code do broche ${brooch.public_code}`} className="aspect-square w-full rounded-xl bg-white p-2" />
          <p className="code mt-3 text-center text-lg font-semibold">{brooch.public_code}</p>
          <div className="mt-1 flex items-center justify-center gap-1">
            <span className="truncate text-xs text-muted">{url}</span>
            <CopyButton value={url} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(["png", "svg", "pdf"] as const).map((f) => (
              <a key={f} href={`${qr}?format=${f}&download=1`} className={buttonClass("secondary", "h-9 px-2 text-xs uppercase")}>
                <Download className="size-3.5" aria-hidden /> {f}
              </a>
            ))}
          </div>
          {viewer.kind === "admin" && brooch.status === "available" && (
            <a href={`${qr}?format=pdf&codes=1&download=1`} className={buttonClass("ghost", "mt-2 h-9 w-full text-xs")}>
              PDF com código de ativação
            </a>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-medium text-muted">Destino das leituras</h2>
          {brooch.status === "available" ? (
            <p className="text-sm text-muted">Aguardando ativação pelo proprietário.</p>
          ) : (
            <DestinationEditor broochId={brooch.id} current={brooch.destination_url} disabled={!canEditDestination} />
          )}
          {brooch.status === "suspended" && (
            <Alert tone="warn">
              {brooch.suspended_by === "owner"
                ? "Você suspendeu este broche. Reative para voltar a redirecionar."
                : brooch.suspended_by === "admin"
                  ? "Suspenso pela administração. Apenas um administrador pode reativá-lo."
                  : "Suspenso automaticamente pelo sistema."}
            </Alert>
          )}
          {brooch.destination_url && brooch.status === "active" && (
            <a href={brooch.destination_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-enamel hover:underline">
              Abrir destino <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-medium text-muted">Status</h2>
          <StatusButtons broochId={brooch.id} actions={actions} />
          {viewer.kind === "admin" && brooch.status === "available" && <ResetCodeButton broochId={brooch.id} />}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="inline-flex items-center gap-2 text-sm font-medium text-muted">
              <ScanLine className="size-4" aria-hidden /> Leituras — últimos 30 dias
            </h2>
            <span className="text-sm">
              Total: <strong className="tabular-nums">{Number(brooch.scan_count).toLocaleString("pt-BR")}</strong>
              <span className="text-muted"> · última: {formatDateTime(brooch.last_scanned_at)}</span>
            </span>
          </div>
          <ScanChart data={(perDay ?? []) as { day: string; scans: number }[]} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-muted">
            <History className="size-4" aria-hidden /> Histórico de destinos
          </h2>
          {history && history.length > 0 ? (
            <ol className="space-y-3">
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-line pl-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={h.reason === "activation" ? "ok" : h.reason === "admin_update" ? "warn" : "info"}>
                      {REASONS[h.reason as keyof typeof REASONS]}
                    </Badge>
                    <span className="text-xs text-muted">{formatDateTime(h.changed_at)}</span>
                  </div>
                  <p className="mt-1 break-all">{h.new_url}</p>
                  {h.old_url && <p className="break-all text-xs text-muted line-through">{h.old_url}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">Sem alterações registradas.</p>
          )}
        </Card>

        <dl className="grid grid-cols-2 gap-3 text-xs text-muted sm:grid-cols-3">
          <div>
            <dt>Criado em</dt>
            <dd className="text-ink">{formatDateTime(brooch.created_at)}</dd>
          </div>
          <div>
            <dt>Ativado em</dt>
            <dd className="text-ink">{formatDateTime(brooch.activated_at)}</dd>
          </div>
          {brooch.sequence_in_batch && (
            <div>
              <dt>Posição no lote</dt>
              <dd className="text-ink">#{brooch.sequence_in_batch}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

export const BROOCH_COLUMNS =
  "id, public_code, status, owner_id, destination_url, suspended_by, scan_count, last_scanned_at, activated_at, created_at, batch_id, sequence_in_batch";
