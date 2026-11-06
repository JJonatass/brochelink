-- =============================================================================
-- BrocheLink — Esquema principal
-- Migration 0001: tipos, tabelas, constraints, índices e triggers
-- =============================================================================
-- Não há limite global de broches: nenhuma constraint, sequência ou CHECK
-- limita a quantidade de linhas em public.brooches. Limites existem apenas
-- POR OPERAÇÃO (configuráveis na aplicação) para proteger a infraestrutura.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('owner', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.brooch_status as enum ('available', 'active', 'suspended', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.batch_status as enum ('pending', 'processing', 'completed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.actor_kind as enum ('owner', 'admin', 'system');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles — 1:1 com auth.users. O papel padrão é SEMPRE 'owner'.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text check (full_name is null or char_length(full_name) <= 120),
  role        public.user_role not null default 'owner',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles (role) where role = 'admin';
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ---------------------------------------------------------------------------
-- generation_batches — lotes de geração (idempotentes e retomáveis)
-- ---------------------------------------------------------------------------
create table if not exists public.generation_batches (
  id                  uuid primary key default gen_random_uuid(),
  created_by          uuid not null references public.profiles (id) on delete restrict,
  requested_quantity  integer not null check (requested_quantity > 0),
  generated_quantity  integer not null default 0 check (generated_quantity >= 0),
  status              public.batch_status not null default 'pending',
  idempotency_key     text not null unique check (char_length(idempotency_key) between 8 and 100),
  label               text check (label is null or char_length(label) <= 120),
  last_error          text,
  attempts            integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,
  constraint generation_batches_generated_lte_requested
    check (generated_quantity <= requested_quantity),
  constraint generation_batches_completed_consistency
    check ((status = 'completed') = (completed_at is not null))
);
create index if not exists generation_batches_created_at_idx on public.generation_batches (created_at desc);
create index if not exists generation_batches_open_idx on public.generation_batches (status)
  where status in ('pending', 'processing', 'failed');

-- ---------------------------------------------------------------------------
-- brooches — o broche físico. public_code é a parte da URL permanente.
-- ---------------------------------------------------------------------------
create table if not exists public.brooches (
  id                 uuid primary key default gen_random_uuid(),
  public_code        text not null,
  status             public.brooch_status not null default 'available',
  batch_id           uuid references public.generation_batches (id) on delete restrict,
  sequence_in_batch  integer check (sequence_in_batch is null or sequence_in_batch > 0),
  owner_id           uuid references public.profiles (id) on delete set null,
  destination_url    text,
  label              text check (label is null or char_length(label) <= 80),
  suspended_by       public.actor_kind,
  scan_count         bigint not null default 0,
  last_scanned_at    timestamptz,
  activated_at       timestamptz,
  suspended_at       timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Unicidade do identificador público (requisito explícito)
  constraint brooches_public_code_key unique (public_code),
  -- Alfabeto sem caracteres ambíguos (sem 0, 1, I, O), 12 caracteres
  constraint brooches_public_code_format check (public_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$'),
  -- Idempotência da geração: cada posição de um lote só existe uma vez
  constraint brooches_batch_sequence_key unique (batch_id, sequence_in_batch),
  constraint brooches_destination_https check (
    destination_url is null
    or (destination_url ~ '^https://' and char_length(destination_url) <= 2048)
  ),
  -- Um broche ativo precisa de proprietário e destino
  constraint brooches_active_requires_owner check (
    status <> 'active' or (owner_id is not null and destination_url is not null)
  ),
  constraint brooches_suspended_consistency check (
    (status = 'suspended') = (suspended_by is not null)
  ),
  constraint brooches_revoked_consistency check (
    (status = 'revoked') = (revoked_at is not null)
  )
);
create index if not exists brooches_owner_idx on public.brooches (owner_id, created_at desc) where owner_id is not null;
create index if not exists brooches_status_idx on public.brooches (status, created_at desc);
create index if not exists brooches_batch_idx on public.brooches (batch_id, sequence_in_batch);
create index if not exists brooches_created_at_idx on public.brooches (created_at desc, id);
create index if not exists brooches_activated_at_idx on public.brooches (activated_at desc) where activated_at is not null;

-- ---------------------------------------------------------------------------
-- activation_credentials — apenas o HASH do código secreto
-- ---------------------------------------------------------------------------
create table if not exists public.activation_credentials (
  brooch_id        uuid primary key references public.brooches (id) on delete cascade,
  code_hash        text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  code_version     integer not null default 1 check (code_version > 0),
  failed_attempts  integer not null default 0 check (failed_attempts >= 0),
  locked_until     timestamptz,
  used_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- scan_events — leituras. IP armazenado apenas como hash (LGPD).
-- ---------------------------------------------------------------------------
create table if not exists public.scan_events (
  id          bigint generated always as identity primary key,
  brooch_id   uuid not null references public.brooches (id) on delete cascade,
  outcome     text not null check (outcome in ('redirected', 'activation', 'suspended', 'revoked')),
  ip_hash     text check (ip_hash is null or char_length(ip_hash) <= 64),
  user_agent  text check (user_agent is null or char_length(user_agent) <= 300),
  country     text check (country is null or char_length(country) <= 2),
  scanned_at  timestamptz not null default now()
);
create index if not exists scan_events_brooch_time_idx on public.scan_events (brooch_id, scanned_at desc);
create index if not exists scan_events_time_idx on public.scan_events (scanned_at desc);

-- ---------------------------------------------------------------------------
-- destination_history — trilha de mudanças de destino
-- ---------------------------------------------------------------------------
create table if not exists public.destination_history (
  id          bigint generated always as identity primary key,
  brooch_id   uuid not null references public.brooches (id) on delete cascade,
  changed_by  uuid references public.profiles (id) on delete set null,
  actor       public.actor_kind not null,
  reason      text not null check (reason in ('activation', 'owner_update', 'admin_update')),
  old_url     text,
  new_url     text not null,
  changed_at  timestamptz not null default now()
);
create index if not exists destination_history_brooch_idx on public.destination_history (brooch_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- audit_logs — auditoria (somente inserção)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  actor        public.actor_kind not null,
  action       text not null check (char_length(action) <= 64),
  entity_type  text not null check (char_length(entity_type) <= 32),
  entity_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists audit_logs_time_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- blocked_domains — lista de destinos maliciosos conhecidos (gerida pelo admin)
-- ---------------------------------------------------------------------------
create table if not exists public.blocked_domains (
  domain      text primary key check (domain ~ '^[a-z0-9.-]+$'),
  reason      text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- rate_limits — janela fixa, funciona em ambiente serverless sem Redis
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','generation_batches','brooches','activation_credentials'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Criação automática do perfil. O papel NUNCA vem do cadastro.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 120),
    'owner'                                   -- ignora qualquer "role" enviado no signup
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Impede alteração de papel fora do procedimento administrativo seguro.
-- Somente sessões com a flag local brochelink.allow_role_change = 'on'
-- (definida apenas dentro de promote_to_admin/demote_admin) podem mudar role.
-- ---------------------------------------------------------------------------
create or replace function public.tg_protect_profile_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('brochelink.allow_role_change', true), 'off') <> 'on' then
    raise exception 'role change not allowed' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'id change not allowed' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute function public.tg_protect_profile_role();

-- Auditoria somente-inserção: bloqueia UPDATE/DELETE para todos os papéis da API
create or replace function public.tg_audit_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- única exceção: anonimização do autor quando a conta é excluída (FK on delete set null)
  if tg_op = 'UPDATE' and new.actor_id is null
     and (new.id, new.actor, new.action, new.entity_type, new.entity_id, new.metadata, new.created_at)
         is not distinct from
         (old.id, old.actor, old.action, old.entity_type, old.entity_id, old.metadata, old.created_at) then
    return new;
  end if;
  raise exception 'audit_logs is append-only' using errcode = '42501';
end $$;

drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.tg_audit_immutable();
