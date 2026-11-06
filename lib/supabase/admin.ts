import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverConfig } from "@/lib/config";
import { SupabaseStore } from "@/lib/store/supabase-store";

let admin: SupabaseClient | null = null;

/**
 * Cliente com a service_role: IGNORA o RLS. Usar apenas no servidor, depois
 * de autenticar e autorizar. A chave nunca é exposta ao navegador
 * (não tem prefixo NEXT_PUBLIC_ e este módulo importa "server-only").
 */
export function createAdminClient(): SupabaseClient {
  if (admin) return admin;
  const cfg = serverConfig();
  admin = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "brochelink-server" } },
  });
  return admin;
}

export function adminStore(): SupabaseStore {
  return new SupabaseStore(createAdminClient());
}
