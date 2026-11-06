"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Ban, Check, Copy, KeyRound, Loader2, Pause, Pencil, Play } from "lucide-react";
import { ACTION_LABELS, type StatusAction } from "@/lib/brooches/transitions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? "Não foi possível concluir a ação.");
  return data;
}

/** Diálogo de confirmação acessível (elemento <dialog> nativo). */
function useConfirm() {
  const ref = useRef<HTMLDialogElement>(null);
  const resolver = useRef<(v: boolean) => void>(() => {});
  const [content, setContent] = useState<{ title: string; body: React.ReactNode; confirm: string; danger?: boolean } | null>(null);
  const ask = (c: NonNullable<typeof content>) =>
    new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setContent(c);
      requestAnimationFrame(() => ref.current?.showModal());
    });
  const close = (v: boolean) => {
    ref.current?.close();
    resolver.current(v);
  };
  const dialog = (
    <dialog
      ref={ref}
      onCancel={() => resolver.current(false)}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink"
    >
      {content && (
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{content.title}</h2>
          <div className="text-sm text-muted">{content.body}</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button variant={content.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
              {content.confirm}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
  return { ask, dialog };
}

const urlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Informe o novo endereço.")
    .max(2048)
    .refine((v) => /^https:\/\/[^\s]+\.[^\s]+/i.test(v), "Use um endereço completo começando com https://"),
});

export function DestinationEditor({ broochId, current, disabled }: { broochId: string; current: string | null; disabled?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { ask, dialog } = useConfirm();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<{ url: string }>({ resolver: zodResolver(urlSchema), defaultValues: { url: current ?? "" } });

  async function onSubmit({ url }: { url: string }) {
    setError(null);
    if (url === current) return setEditing(false);
    const ok = await ask({
      title: "Alterar destino?",
      confirm: "Alterar destino",
      body: (
        <div className="space-y-2">
          <p>As próximas leituras do QR Code serão redirecionadas para:</p>
          <p className="break-all font-medium text-ink">{url}</p>
          <p>O broche físico continua o mesmo.</p>
        </div>
      ),
    });
    if (!ok) return;
    try {
      const data = await call(`/api/brooches/${broochId}/destination`, "PATCH", { url, confirm: true });
      reset({ url: data.url });
      setEditing(false);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!editing) {
    return (
      <div className="space-y-2">
        {saved && <Alert tone="ok">Destino atualizado. As próximas leituras já usam o novo endereço.</Alert>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 break-all text-sm font-medium">{current ?? "—"}</p>
          {!disabled && (
            <Button variant="secondary" className="h-9 shrink-0" onClick={() => { setEditing(true); setSaved(false); }}>
              <Pencil className="size-4" aria-hidden /> Alterar
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
      {error && <Alert tone="bad">{error}</Alert>}
      <Field label="Novo endereço de destino" htmlFor="url" error={errors.url?.message} hint="Precisa começar com https://">
        <input id="url" type="url" inputMode="url" className={inputClass} aria-invalid={!!errors.url} {...register("url")} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          Salvar
        </Button>
        <Button type="button" variant="ghost" onClick={() => { reset({ url: current ?? "" }); setEditing(false); setError(null); }}>
          Cancelar
        </Button>
      </div>
      {dialog}
    </form>
  );
}

const actionMeta: Record<StatusAction, { icon: typeof Pause; text: string; danger?: boolean; variant: "secondary" | "danger" }> = {
  suspend: { icon: Pause, variant: "secondary", text: "Enquanto suspenso, quem escanear verá uma página de broche pausado." },
  reactivate: { icon: Play, variant: "secondary", text: "O broche volta a funcionar normalmente." },
  revoke: {
    icon: Ban,
    variant: "danger",
    danger: true,
    text: "A revogação é DEFINITIVA: o QR Code deixará de redirecionar e não poderá ser reativado.",
  },
};

export function StatusButtons({ broochId, actions }: { broochId: string; actions: StatusAction[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<StatusAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  async function run(action: StatusAction) {
    const meta = actionMeta[action];
    const ok = await ask({ title: `${ACTION_LABELS[action]} broche?`, body: meta.text, confirm: ACTION_LABELS[action], danger: meta.danger });
    if (!ok) return;
    setPending(action);
    setError(null);
    try {
      await call(`/api/brooches/${broochId}/status`, "POST", { action });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  if (actions.length === 0) return <p className="text-sm text-muted">Nenhuma ação disponível no status atual.</p>;
  return (
    <div className="space-y-2">
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => {
          const Icon = actionMeta[a].icon;
          return (
            <Button key={a} variant={actionMeta[a].variant} className="h-9" disabled={pending !== null} onClick={() => run(a)}>
              {pending === a ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
              {ACTION_LABELS[a]}
            </Button>
          );
        })}
      </div>
      {dialog}
    </div>
  );
}

export function ResetCodeButton({ broochId }: { broochId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();
  async function run() {
    const ok = await ask({
      title: "Gerar novo código de ativação?",
      body: "O código impresso atualmente deixará de funcionar. Use quando o cartão original foi perdido ou exposto.",
      confirm: "Gerar novo código",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const data = await call(`/api/admin/brooches/${broochId}/reset-code`, "POST", {});
      setCode(data.activationCode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      {error && <Alert tone="bad">{error}</Alert>}
      {code ? (
        <Alert tone="ok" title="Novo código de ativação">
          <span className="code text-base font-semibold text-ink">{code}</span>
        </Alert>
      ) : (
        <Button variant="secondary" className="h-9" onClick={run} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
          Novo código de ativação
        </Button>
      )}
      {dialog}
    </div>
  );
}

export function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      className="h-8 px-2 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Copiado" : label}
    </Button>
  );
}
