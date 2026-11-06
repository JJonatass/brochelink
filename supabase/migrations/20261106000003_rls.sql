-- =============================================================================
-- BrocheLink — Row Level Security
-- Migration 0003
-- =============================================================================
-- Princípio: o navegador (chave anon + sessão do usuário) só LÊ o que lhe
-- pertence. Toda escrita passa pelo servidor Next.js, que autentica, autoriza,
-- valida e então usa as funções da migration 0002 com a service_role.
-- =============================================================================

alter table public.profiles               enable row level security;
alter table public.brooches               enable row level security;
alter table public.activation_credentials enable row level security;
alter table public.scan_events            enable row level security;
alter table public.destination_history    enable row level security;
alter table public.audit_logs             enable row level security;
alter table public.generation_batches     enable row level security;
alter table public.blocked_domains        enable row level security;
alter table public.rate_limits            enable row level security;

-- Defesa em profundidade: remove privilégios de escrita dos papéis da API
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on public.activation_credentials, public.rate_limits from anon, authenticated;
revoke select on all tables in schema public from anon;

-- O usuário pode editar apenas o próprio nome
grant update (full_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- brooches
-- ---------------------------------------------------------------------------
drop policy if exists brooches_select on public.brooches;
create policy brooches_select on public.brooches
  for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- activation_credentials — nenhuma política: inacessível pela API pública.
-- rate_limits — idem.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- scan_events / destination_history — do proprietário do broche ou admin
-- ---------------------------------------------------------------------------
drop policy if exists scan_events_select on public.scan_events;
create policy scan_events_select on public.scan_events
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.brooches b
                where b.id = scan_events.brooch_id and b.owner_id = (select auth.uid()))
  );

drop policy if exists destination_history_select on public.destination_history;
create policy destination_history_select on public.destination_history
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.brooches b
                where b.id = destination_history.brooch_id and b.owner_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Somente administradores
-- ---------------------------------------------------------------------------
drop policy if exists audit_logs_admin on public.audit_logs;
create policy audit_logs_admin on public.audit_logs
  for select to authenticated using ((select public.is_admin()));

drop policy if exists generation_batches_admin on public.generation_batches;
create policy generation_batches_admin on public.generation_batches
  for select to authenticated using ((select public.is_admin()));

drop policy if exists blocked_domains_admin on public.blocked_domains;
create policy blocked_domains_admin on public.blocked_domains
  for select to authenticated using ((select public.is_admin()));
