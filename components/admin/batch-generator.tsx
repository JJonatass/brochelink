"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Download, Eye, Loader2, Play, Sparkles } from "lucide-react";
import { Alert, Button, Card, Field, LinkButton, buttonClass, inputClass } from "@/components/ui";

export type BatchLite = { id: string; requested_quantity: number; generated_quantity: number; status: string; label: string | null };
export const EXPORT_FORMATS = [
  { value: "pdf", label: "PDF — folha de impressão" },
  { value: "zip", label: "ZIP — PNG + SVG + PDF + CSV" },
  { value: "png", label: "PNG (em ZIP)" },
  { value: "svg", label: "SVG (em ZIP)" },
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number]["value"];

export function exportUrl(batchId: string, format: string, from: number, to: number, codes: boolean) {
  return `/api/admin/batches/${batchId}/export?format=${format}&from=${from}&to=${to}${codes ? "&codes=1" : ""}`;
}

export function parts(total: number, size: number) {
  const out: { from: number; to: number }[] = [];
  for (let from = 1; from <= total; from += size) out.push({ from, to: Math.min(total, from + size - 1) });
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Processa um lote em partes, chamando /process até concluir.
 * Falhas de rede são repetidas com backoff; o servidor é idempotente.
 */
export function useBatchProcessor() {
  const [batch, setBatch] = useState<BatchLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);

  const run = useCallback(async (initial: BatchLite) => {
    setBatch(initial);
    setError(null);
    setRunning(true);
    stop.current = false;
    let current = initial;
    let failures = 0;
    while (current.status !== "completed" && !stop.current) {
      try {
        const res = await fetch(`/api/admin/batches/${current.id}/process`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status >= 500 || res.status === 429) throw new Error(data.message ?? `HTTP ${res.status}`);
          setError(data.message ?? "Não foi possível processar o lote.");
          break;
        }
        current = data.batch;
        setBatch(current);
        failures = 0;
      } catch (e) {
        failures++;
        if (failures > 5) {
          setError(`Processamento interrompido: ${(e as Error).message}. Use "Retomar" para continuar de onde parou.`);
          break;
        }
        await sleep(Math.min(1000 * 2 ** failures, 15_000));
      }
    }
    setRunning(false);
    return current;
  }, []);

  return { batch, error, running, run, cancel: () => (stop.current = true) };
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="h-2.5 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="h-full rounded-full bg-enamel transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted tabular-nums">
        {value.toLocaleString("pt-BR")} de {max.toLocaleString("pt-BR")} ({pct.toFixed(0)}%)
      </p>
    </div>
  );
}

const schema = z.object({
  quantity: z.coerce.number({ message: "Informe a quantidade." }).int("Use um número inteiro.").positive("A quantidade deve ser maior que zero."),
  label: z.string().trim().max(120).optional(),
  format: z.enum(["pdf", "zip", "png", "svg"]),
  includeCodes: z.boolean(),
});
type Input = z.input<typeof schema>;
type Output = z.output<typeof schema>;

export function BatchGenerator({ maxPerBatch, exportMax }: { maxPerBatch: number; exportMax: number }) {
  const router = useRouter();
  const processor = useBatchProcessor();
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Output | null>(null);
  // Mesma chave enquanto a MESMA solicitação é reenviada (falha de rede / clique duplo)
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Input, unknown, Output>({
    resolver: zodResolver(schema.refine((v) => v.quantity <= maxPerBatch, { path: ["quantity"], message: `Máximo de ${maxPerBatch.toLocaleString("pt-BR")} por lote (crie vários lotes para mais).` })),
    defaultValues: { quantity: 10, label: "", format: "pdf", includeCodes: true },
  });

  async function onSubmit(values: Output) {
    setCreateError(null);
    const key = pendingKey ?? crypto.randomUUID();
    setPendingKey(key);
    let res: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        res = await fetch("/api/admin/batches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quantity: values.quantity, label: values.label || null, idempotencyKey: key }),
        });
        break;
      } catch {
        await sleep(800 * (attempt + 1));
      }
    }
    if (!res) return setCreateError("Falha de conexão. Tente novamente — nenhum broche será duplicado.");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setCreateError(data.message ?? "Não foi possível criar o lote.");
    setPendingKey(null);
    setSubmitted(values);
    await processor.run(data.batch);
    router.refresh();
  }

  const quantity = Number(useWatch({ control, name: "quantity" })) || 0;
  const busy = isSubmitting || processor.running;
  const done = processor.batch?.status === "completed";

  return (
    <Card className="p-5">
      <h2 className="mb-4 inline-flex items-center gap-2 font-semibold">
        <Sparkles className="size-4 text-enamel" aria-hidden /> Gerar novo lote
      </h2>
      {!processor.batch ? (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {createError && <Alert tone="bad">{createError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantidade de broches" htmlFor="quantity" error={errors.quantity?.message} hint="Qualquer inteiro positivo. Lotes grandes são processados em partes.">
              <input id="quantity" type="number" min={1} step={1} inputMode="numeric" className={inputClass} aria-invalid={!!errors.quantity} {...register("quantity")} />
            </Field>
            <Field label="Rótulo (opcional)" htmlFor="label" error={errors.label?.message} hint="Ex.: Feira de Tecnologia 2026">
              <input id="label" className={inputClass} {...register("label")} />
            </Field>
            <Field label="Formato de exportação" htmlFor="format">
              <select id="format" className={inputClass} {...register("format")}>
                {EXPORT_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-start gap-3 self-end rounded-xl border border-line p-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-enamel)]" {...register("includeCodes")} />
              <span>
                Incluir códigos de ativação
                <span className="block text-xs text-muted">Necessário para entregar os broches. Trate o arquivo como confidencial.</span>
              </span>
            </label>
          </div>
          {quantity > exportMax && (
            <Alert tone="info">
              Os arquivos serão divididos em {Math.ceil(quantity / exportMax)} partes de até {exportMax.toLocaleString("pt-BR")} broches.
            </Alert>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
            Gerar {quantity > 0 ? quantity.toLocaleString("pt-BR") : ""} broche{quantity === 1 ? "" : "s"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <ProgressBar value={processor.batch.generated_quantity} max={processor.batch.requested_quantity} />
          {processor.error && <Alert tone="bad">{processor.error}</Alert>}
          {processor.running && (
            <p className="inline-flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Gerando em partes… mantenha esta página aberta.
            </p>
          )}
          {!processor.running && !done && (
            <Button variant="secondary" onClick={() => processor.batch && processor.run(processor.batch)}>
              <Play className="size-4" aria-hidden /> Retomar
            </Button>
          )}
          {done && submitted && (
            <>
              <Alert tone="ok" title="Lote concluído">
                {processor.batch.generated_quantity.toLocaleString("pt-BR")} broches gerados.
              </Alert>
              <div className="flex flex-wrap gap-2">
                {parts(processor.batch.generated_quantity, exportMax).map((p, i, all) => (
                  <a key={p.from} href={exportUrl(processor.batch!.id, submitted.format, p.from, p.to, submitted.includeCodes)} className={buttonClass("primary", "h-10")}>
                    <Download className="size-4" aria-hidden />
                    Baixar {submitted.format.toUpperCase()}
                    {all.length > 1 && ` (${p.from}–${p.to})`}
                  </a>
                ))}
                <LinkButton href={`/admin/lotes/${processor.batch.id}`} variant="secondary" className="h-10">
                  <Eye className="size-4" aria-hidden /> Visualizar lote
                </LinkButton>
              </div>
              <button type="button" className="inline-flex items-center gap-1 text-sm text-enamel hover:underline" onClick={() => window.location.reload()}>
                <CheckCircle2 className="size-4" aria-hidden /> Gerar outro lote
              </button>
            </>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-muted">
        A geração é idempotente: repetir o envio por falha de rede ou clique duplo não cria broches duplicados.{" "}
        <Link href="/admin/broches" className="underline">
          Ver todos os broches
        </Link>
      </p>
    </Card>
  );
}

/** Botão "Retomar" para lotes interrompidos (lista de lotes). */
export function ResumeBatch({ batch }: { batch: BatchLite }) {
  const router = useRouter();
  const p = useBatchProcessor();
  const current = p.batch ?? batch;
  if (current.status === "completed") return <span className="text-xs text-ok">Concluído</span>;
  return (
    <div className="space-y-2">
      {p.batch && <ProgressBar value={current.generated_quantity} max={current.requested_quantity} />}
      {p.error && <p className="text-xs text-bad">{p.error}</p>}
      <Button
        variant="secondary"
        className="h-8 px-3 text-xs"
        disabled={p.running}
        onClick={async () => {
          await p.run(current);
          router.refresh();
        }}
      >
        {p.running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
        {p.running ? "Processando…" : "Retomar"}
      </Button>
    </div>
  );
}

/** Painel de exportação de um lote existente. */
export function ExportPanel({ batchId, total, exportMax }: { batchId: string; total: number; exportMax: number }) {
  const [format, setFormat] = useState<ExportFormat | "csv">("pdf");
  const [codes, setCodes] = useState(false);
  const all = parts(total, exportMax);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Formato" htmlFor="exp-format">
          <select id="exp-format" className={inputClass} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat | "csv")}>
            {[...EXPORT_FORMATS, { value: "csv", label: "CSV — manifesto" } as const].map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-start gap-3 self-end rounded-xl border border-line p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-enamel)]" checked={codes} onChange={(e) => setCodes(e.target.checked)} />
          <span>
            Incluir códigos de ativação
            <span className="block text-xs text-muted">Somente broches ainda não ativados. A exportação fica registrada na auditoria.</span>
          </span>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {all.map((p) => (
          <a key={p.from} href={exportUrl(batchId, format, p.from, p.to, codes)} className={buttonClass("secondary", "h-10")}>
            <Download className="size-4" aria-hidden />
            {all.length > 1 ? `${p.from}–${p.to}` : `Baixar ${format.toUpperCase()}`}
          </a>
        ))}
      </div>
    </div>
  );
}
