import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = { id: string; email: string; full_name: string | null; role: "owner" | "admin" };

/**
 * Usuário autenticado + perfil. Usa getUser() (valida o JWT no Supabase Auth),
 * nunca getSession() sozinho, que confia no cookie.
 */
export async function getCurrentUser(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("id, email, full_name, role").eq("id", user.id).maybeSingle();
  return (data as Profile | null) ?? { id: user.id, email: user.email ?? "", full_name: null, role: "owner" };
}

/** Para páginas: redireciona ao login se não autenticado. */
export async function requireUserPage(next: string): Promise<Profile> {
  const profile = await getCurrentUser();
  if (!profile) redirect(`/login?next=${encodeURIComponent(next)}`);
  return profile;
}

/** Para páginas administrativas: quem não é admin volta para o próprio painel. */
export async function requireAdminPage(next: string): Promise<Profile> {
  const profile = await requireUserPage(next);
  if (profile.role !== "admin") redirect("/painel");
  return profile;
}
