"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, FileClock, LayoutGrid, QrCode, Shield } from "lucide-react";
import { cx } from "@/components/ui";

const items = [
  { href: "/admin", label: "Visão geral", icon: LayoutGrid, exact: true },
  { href: "/admin/lotes", label: "Lotes", icon: Boxes },
  { href: "/admin/broches", label: "Broches", icon: QrCode },
  { href: "/admin/estatisticas", label: "Estatísticas", icon: BarChart3 },
  { href: "/admin/auditoria", label: "Auditoria", icon: FileClock },
  { href: "/admin/seguranca", label: "Segurança", icon: Shield },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="-mx-4 mb-6 overflow-x-auto px-4" aria-label="Administração">
      <ul className="flex w-max gap-1 rounded-xl border border-line bg-surface p-1">
        {items.map((i) => {
          const active = i.exact ? path === i.href : path.startsWith(i.href);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm whitespace-nowrap transition-colors",
                  active ? "bg-ink text-paper" : "text-muted hover:text-ink",
                )}
              >
                <i.icon className="size-4" aria-hidden />
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
