"use client";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button, Card } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md pt-6">
      <Card className="p-8 text-center">
        <TriangleAlert className="mx-auto mb-4 size-10 text-bad" aria-hidden />
        <h1 className="text-xl font-semibold">Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted">Ocorreu um erro inesperado. Tente novamente.</p>
        {error.digest && <p className="code mt-2 text-xs text-muted">Ref.: {error.digest}</p>}
        <Button onClick={reset} variant="secondary" className="mt-6">
          <RotateCcw className="size-4" aria-hidden /> Tentar novamente
        </Button>
      </Card>
    </div>
  );
}
