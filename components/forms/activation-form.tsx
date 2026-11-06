"use client";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, CheckCircle2, ExternalLink, KeyRound, Link2, Loader2 } from "lucide-react";
import { Alert, Button, Card, Field, inputClass, LinkButton } from "@/components/ui";

const schema = z.object({
  activationCode: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(v.replace(/[\s-]/g, "")), "O código tem 12 caracteres (ex.: K7M2-X9P4-Q6R8)."),
  destinationUrl: z
    .string()
    .trim()
    .min(1, "Informe o endereço de destino.")
    .max(2048)
    .refine((v) => /^https:\/\/[^\s]+\.[^\s]+/i.test(v), "Use um endereço completo começando com https://"),
});
type Values = z.input<typeof schema>;

type ApiError = { error: string; message: string; field?: string };

export function ActivationForm({ publicCode }: { publicCode: string }) {
  const [step, setStep] = useState<"form" | "confirm" | "done">("form");
  const [values, setValues] = useState<z.output<typeof schema> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [broochId, setBroochId] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema) });

  async function activate() {
    if (!values) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicCode, ...values, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data);
        if (data.error === "invalid_code" || data.error === "invalid_url") setStep("form");
        return;
      }
      setBroochId(data.broochId);
      setStep("done");
    } catch {
      setError({ error: "network", message: "Falha de conexão. Verifique sua internet e tente novamente." });
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "done") {
    return (
      <Card className="p-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-ok" aria-hidden />
        <h2 className="mt-3 text-lg font-semibold">Broche ativado!</h2>
        <p className="mt-1 text-sm text-muted">A partir de agora, quem escanear este broche será levado para:</p>
        <p className="mt-2 break-all text-sm font-medium">{values?.destinationUrl}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <LinkButton href={broochId ? `/painel/broches/${broochId}` : "/painel"}>Gerenciar broche</LinkButton>
          <LinkButton href="/painel" variant="secondary">
            Meus broches
          </LinkButton>
        </div>
      </Card>
    );
  }

  if (step === "confirm" && values) {
    return (
      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">Confirme a ativação</h2>
        {error && <Alert tone="bad">{error.message}</Alert>}
        <dl className="space-y-3 rounded-xl bg-ink/[0.03] p-4 text-sm">
          <div>
            <dt className="text-muted">Broche</dt>
            <dd className="code font-medium">{publicCode}</dd>
          </div>
          <div>
            <dt className="text-muted">Destino das leituras</dt>
            <dd className="break-all font-medium">
              <a href={values.destinationUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:underline">
                {values.destinationUrl} <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              </a>
            </dd>
          </div>
        </dl>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-enamel)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>Confirmo que este broche é meu e que o destino acima está correto. Poderei alterá-lo depois pelo painel.</span>
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setStep("form")} disabled={submitting}>
            <ArrowLeft className="size-4" aria-hidden /> Voltar
          </Button>
          <Button onClick={activate} disabled={!confirmed || submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Ativar broche
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((v) => {
          setValues(v);
          setConfirmed(false);
          setError(null);
          setStep("confirm");
        })}
      >
        {error && (
          <Alert tone={error.error === "locked" ? "warn" : "bad"}>
            {error.message}
            {error.error === "not_available" && (
              <>
                {" "}
                <Link href="/painel" className="font-medium underline">
                  Ver meus broches
                </Link>
              </>
            )}
          </Alert>
        )}
        <Field label="Código de ativação" htmlFor="activationCode" hint="Está no cartão que acompanha o broche." error={errors.activationCode?.message}>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              id="activationCode"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX"
              className={`${inputClass} code pl-10 uppercase`}
              aria-invalid={!!errors.activationCode}
              {...register("activationCode")}
            />
          </div>
        </Field>
        <Field label="Endereço de destino" htmlFor="destinationUrl" hint="Seu site, portfólio, perfil… Precisa começar com https://" error={errors.destinationUrl?.message}>
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              id="destinationUrl"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://"
              className={`${inputClass} pl-10`}
              aria-invalid={!!errors.destinationUrl}
              {...register("destinationUrl")}
            />
          </div>
        </Field>
        <Button type="submit" className="w-full">
          Continuar
        </Button>
      </form>
    </Card>
  );
}
