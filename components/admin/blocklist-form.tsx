"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Alert, Button, inputClass } from "@/components/ui";

export function BlocklistForm() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/blocked-domains", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, reason: reason || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.message ?? "Não foi possível bloquear.");
    setDomain("");
    setReason("");
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input value={domain} onChange={(e) => setDomain(e.target.value)} required placeholder="dominio-malicioso.com" className={inputClass} aria-label="Domínio" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" className={inputClass} aria-label="Motivo" />
        <Button disabled={busy || domain.length < 3}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />} Bloquear
        </Button>
      </div>
    </form>
  );
}

export function UnblockButton({ domain }: { domain: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      className="h-8 px-2"
      aria-label={`Desbloquear ${domain}`}
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Remover ${domain} da lista de bloqueio?`)) return;
        setBusy(true);
        await fetch("/api/admin/blocked-domains", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain }) });
        setBusy(false);
        router.refresh();
      }}
    >
      <Trash2 className="size-4" aria-hidden />
    </Button>
  );
}
