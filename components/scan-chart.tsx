/** Gráfico de barras de leituras por dia (server component, sem JS). */
export function ScanChart({ data }: { data: { day: string; scans: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.scans));
  const total = data.reduce((s, d) => s + d.scans, 0);
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return (
    <figure>
      <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={`${total} leituras em ${data.length} dias`}>
        {data.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end">
            <div
              className="w-full rounded-t-[3px] bg-enamel/80 transition-colors group-hover:bg-enamel"
              style={{ height: `${d.scans === 0 ? 2 : Math.max(6, (d.scans / max) * 100)}%`, opacity: d.scans === 0 ? 0.25 : 1 }}
            />
            <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] text-paper group-hover:block">
              {fmt(d.day)}: {d.scans}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between text-xs text-muted">
        <span>{data[0] ? fmt(data[0].day) : ""}</span>
        <span>{total.toLocaleString("pt-BR")} leituras no período</span>
        <span>{data.at(-1) ? fmt(data.at(-1)!.day) : ""}</span>
      </figcaption>
    </figure>
  );
}
