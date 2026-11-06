import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy-session";

/**
 * Renova a sessão do Supabase e protege as áreas logadas.
 * A verificação de papel (admin) é feita no servidor em cada página/rota.
 */
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const path = request.nextUrl.pathname;
  if (!user && (path.startsWith("/painel") || path.startsWith("/admin"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Não roda em /b/* (redirecionamento deve ser o mais rápido possível),
  // nem em arquivos estáticos.
  matcher: ["/((?!b/|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
