import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import { STATUS_LABELS, type BroochStatus } from "@/lib/brooches/transitions";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 h-11 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
const variants = {
  primary: "bg-enamel text-white hover:bg-enamel-strong",
  secondary: "bg-surface text-ink border border-line hover:border-ink/30",
  ghost: "text-ink hover:bg-ink/5",
  danger: "bg-bad text-white hover:opacity-90",
};
export type ButtonVariant = keyof typeof variants;

export function buttonClass(variant: ButtonVariant = "primary", extra?: string) {
  return cx(buttonBase, variants[variant], extra);
}

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-[var(--radius-card)] border border-line bg-surface", className)} {...props} />;
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const statusStyles: Record<BroochStatus, string> = {
  available: "bg-info-soft text-info",
  active: "bg-ok-soft text-ok",
  suspended: "bg-warn-soft text-warn",
  revoked: "bg-bad-soft text-bad",
};

export function StatusBadge({ status }: { status: BroochStatus }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", statusStyles[status])}>
      <span className="size-1.5 rounded-full bg-current" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "bad" | "info" }) {
  const tones = {
    neutral: "bg-ink/5 text-muted",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    info: "bg-info-soft text-info",
  };
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon: LucideIcon; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-muted">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        <Icon className={cx("size-4", tone)} aria-hidden />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</div>
    </Card>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "ok" | "warn" | "bad"; title?: string; children?: ReactNode }) {
  const map = {
    info: { cls: "bg-info-soft text-info", Icon: Info },
    ok: { cls: "bg-ok-soft text-ok", Icon: CheckCircle2 },
    warn: { cls: "bg-warn-soft text-warn", Icon: AlertTriangle },
    bad: { cls: "bg-bad-soft text-bad", Icon: XCircle },
  }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("flex gap-3 rounded-xl p-3 text-sm", map.cls)}>
      <map.Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx(title && "mt-0.5", "text-ink/80")}>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-enamel-soft text-enamel">
        <Icon className="size-6" aria-hidden />
      </div>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </Card>
  );
}

export const inputClass =
  "block w-full rounded-xl border border-line bg-surface px-3.5 h-11 text-base sm:text-sm text-ink placeholder:text-muted/70 focus:border-enamel focus:outline-none focus:ring-2 focus:ring-enamel/20 aria-[invalid=true]:border-bad";

export function Field({ label, hint, error, htmlFor, children }: { label: string; hint?: ReactNode; error?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-bad">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

/** Paginação por links (funciona sem JavaScript). */
export function Pagination({ page, pageSize, total, href }: { page: number; pageSize: number; total: number | null; href: (page: number) => string }) {
  const pages = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const hasNext = pages === null ? true : page < pages;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
      <span className="text-muted">
        Página {page}
        {pages !== null && ` de ${pages}`}
        {total !== null && ` · ${total.toLocaleString("pt-BR")} itens`}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <LinkButton variant="secondary" className="h-9" href={href(page - 1)}>
            Anterior
          </LinkButton>
        ) : (
          <span className={buttonClass("secondary", "h-9 opacity-40")}>Anterior</span>
        )}
        {hasNext ? (
          <LinkButton variant="secondary" className="h-9" href={href(page + 1)}>
            Próxima
          </LinkButton>
        ) : (
          <span className={buttonClass("secondary", "h-9 opacity-40")}>Próxima</span>
        )}
      </div>
    </nav>
  );
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

export function hostOf(url: string | null) {
  if (!url) return "—";
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

export function pageParam(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100_000) : 1;
}

/** Instante ISO de N dias atrás (para filtros de período). */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
