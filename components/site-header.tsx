import Link from "next/link";
import { LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "./logo";
import { buttonClass } from "./ui";

export async function SiteHeader() {
  const profile = await getCurrentUser().catch(() => null);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" aria-label="BrocheLink — início">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1">
          {profile ? (
            <>
              {profile.role === "admin" && (
                <Link href="/admin" className={buttonClass("ghost", "h-9 px-3")}>
                  <ShieldCheck className="size-4" aria-hidden />
                  <span className="hidden sm:inline">Admin</span>
                </Link>
              )}
              <Link href="/painel" className={buttonClass("ghost", "h-9 px-3")}>
                <LayoutDashboard className="size-4" aria-hidden />
                <span className="hidden sm:inline">Meus broches</span>
              </Link>
              <form action="/auth/signout" method="post">
                <button className={buttonClass("ghost", "h-9 px-3")} aria-label="Sair">
                  <LogOut className="size-4" aria-hidden />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className={buttonClass("ghost", "h-9 px-3")}>
                Entrar
              </Link>
              <Link href="/cadastro" className={buttonClass("primary", "h-9 px-3")}>
                Criar conta
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
