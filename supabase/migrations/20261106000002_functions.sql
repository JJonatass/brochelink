-- =============================================================================
-- BrocheLink — Funções de domínio (RPC)
-- Migration 0002
-- =============================================================================
-- Regra geral de segurança:
--   * Funções que ALTERAM dados são SECURITY DEFINER e executáveis apenas pelo
--     papel service_role (usado exclusivamente no servidor Next.js, depois de
--     autenticar o usuário, verificar autorização e validar a entrada).
--   * anon/authenticated não podem chamá-las diretamente pela API do Supabase.
--   * Funções de LEITURA usadas pelo navegador são SECURITY INVOKER e respeitam RLS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.write_audit(
  p_actor_id uuid, p_actor public.actor_kind, p_action text,
  p_entity_type text, p_entity_id text, p_metadata jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_logs (actor_id, actor, action, entity_type, entity_id, metadata)
  values (p_actor_id, p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting (janela fixa). Retorna TRUE se a requisição é permitida.
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    return true;
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as rl (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = rl.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

-- ---------------------------------------------------------------------------
-- Leitura de um broche (redirecionamento). Uma única ida ao banco:
-- localiza, registra o evento e incrementa o contador.
-- ---------------------------------------------------------------------------
create or replace function public.register_scan(
  p_public_code text,
  p_ip_hash     text default null,
  p_user_agent  text default null,
  p_country     text default null,
  p_record      boolean default true
)
returns table (brooch_id uuid, status public.brooch_status, destination_url text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.brooches%rowtype;
  v_outcome text;
begin
  select * into v_b from public.brooches b where b.public_code = p_public_code;
  if not found then
    return;
  end if;

  if p_record then
    v_outcome := case v_b.status
      when 'active'    then 'redirected'
      when 'available' then 'activation'
      when 'suspended' then 'suspended'
      else 'revoked' end;

    insert into public.scan_events (brooch_id, outcome, ip_hash, user_agent, country)
    values (v_b.id, v_outcome, left(p_ip_hash, 64), left(p_user_agent, 300), left(upper(p_country), 2));

    update public.brooches
       set scan_count = scan_count + 1, last_scanned_at = now()
     where id = v_b.id;
  end if;

  brooch_id := v_b.id;
  status := v_b.status;
  destination_url := case when v_b.status = 'active' then v_b.destination_url else null end;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- Geração em lotes
-- ---------------------------------------------------------------------------

-- Cria (ou devolve, se já existir) um lote com a mesma chave de idempotência.
create or replace function public.create_generation_batch(
  p_created_by uuid, p_quantity integer, p_idempotency_key text, p_label text default null
)
returns public.generation_batches
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch public.generation_batches%rowtype;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be a positive integer' using errcode = '22023';
  end if;

  insert into public.generation_batches (created_by, requested_quantity, idempotency_key, label)
  values (p_created_by, p_quantity, p_idempotency_key, nullif(trim(p_label), ''))
  on conflict (idempotency_key) do nothing
  returning * into v_batch;

  if not found then
    select * into v_batch from public.generation_batches where idempotency_key = p_idempotency_key;
    if v_batch.created_by <> p_created_by or v_batch.requested_quantity <> p_quantity then
      raise exception 'idempotency key reused with different parameters' using errcode = '23505';
    end if;
    return v_batch;
  end if;

  perform public.write_audit(p_created_by, 'admin', 'batch.create', 'generation_batch', v_batch.id::text,
    jsonb_build_object('requested_quantity', p_quantity, 'label', p_label));
  return v_batch;
end $$;

-- Recalcula o progresso a partir dos dados reais (fonte da verdade = linhas
-- existentes). Um broche só conta como gerado quando tem credencial.
create or replace function public.sync_batch_progress(p_batch_id uuid, p_error text default null)
returns public.generation_batches
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch public.generation_batches%rowtype;
  v_count integer;
begin
  select * into v_batch from public.generation_batches where id = p_batch_id for update;
  if not found then
    raise exception 'batch not found' using errcode = 'P0002';
  end if;

  select count(*) into v_count
    from public.brooches b
    join public.activation_credentials c on c.brooch_id = b.id
   where b.batch_id = p_batch_id;

  update public.generation_batches
     set generated_quantity = v_count,
         status = case
                    when v_count >= requested_quantity then 'completed'::public.batch_status
                    when p_error is not null then 'failed'::public.batch_status
                    else 'processing'::public.batch_status
                  end,
         completed_at = case when v_count >= requested_quantity then coalesce(completed_at, now()) else null end,
         last_error = case when v_count >= requested_quantity then null else coalesce(p_error, last_error) end,
         attempts = attempts + 1
   where id = p_batch_id
  returning * into v_batch;

  if v_batch.status = 'completed' and v_batch.attempts > 0 then
    -- registra a conclusão apenas uma vez
    if not exists (select 1 from public.audit_logs
                    where entity_type = 'generation_batch' and entity_id = p_batch_id::text
                      and action = 'batch.complete') then
      perform public.write_audit(v_batch.created_by, 'admin', 'batch.complete', 'generation_batch',
        p_batch_id::text, jsonb_build_object('generated_quantity', v_count));
    end if;
  end if;
  return v_batch;
end $$;

-- Broches de um lote que ainda não têm credencial (recuperação de falha parcial)
create or replace function public.brooches_missing_credentials(p_batch_id uuid, p_limit integer)
returns table (id uuid)
language sql stable security definer set search_path = ''
as $$
  select b.id
    from public.brooches b
   where b.batch_id = p_batch_id
     and not exists (select 1 from public.activation_credentials c where c.brooch_id = b.id)
   order by b.sequence_in_batch
   limit greatest(p_limit, 0);
$$;

-- ---------------------------------------------------------------------------
-- Ativação
-- ---------------------------------------------------------------------------
create or replace function public.register_failed_activation(
  p_brooch_id uuid, p_max_attempts integer default 5, p_lock_seconds integer default 900
)
returns table (failed_attempts integer, locked_until timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_failed integer;
  v_lock timestamptz;
  v_level integer;
begin
  update public.activation_credentials c
     set failed_attempts = c.failed_attempts + 1
   where c.brooch_id = p_brooch_id
  returning c.failed_attempts into v_failed;

  if v_failed is null then
    return;
  end if;

  if v_failed % p_max_attempts = 0 then
    -- bloqueio exponencial: 15min, 30min, 1h, ... limitado a 24h
    v_level := least(v_failed / p_max_attempts - 1, 10);
    v_lock := now() + make_interval(secs => least(p_lock_seconds * power(2, v_level), 86400));
    update public.activation_credentials c set locked_until = v_lock where c.brooch_id = p_brooch_id;
  else
    select c.locked_until into v_lock from public.activation_credentials c where c.brooch_id = p_brooch_id;
  end if;

  failed_attempts := v_failed;
  locked_until := v_lock;
  return next;
end $$;

-- Ativa atomicamente. Retorna FALSE se o broche já não estiver disponível
-- (corrida entre duas ativações simultâneas: só uma vence).
create or replace function public.activate_brooch(
  p_brooch_id uuid, p_user_id uuid, p_destination text, p_code_version integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.activation_credentials c
     set used_at = now(), failed_attempts = 0, locked_until = null
   where c.brooch_id = p_brooch_id
     and c.used_at is null
     and c.code_version = p_code_version
     and (c.locked_until is null or c.locked_until <= now());
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  update public.brooches b
     set status = 'active', owner_id = p_user_id, destination_url = p_destination,
         activated_at = now()
   where b.id = p_brooch_id and b.status = 'available';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'brooch not available' using errcode = 'P0001';  -- desfaz a transação
  end if;

  insert into public.destination_history (brooch_id, changed_by, actor, reason, old_url, new_url)
  values (p_brooch_id, p_user_id, 'owner', 'activation', null, p_destination);

  perform public.write_audit(p_user_id, 'owner', 'brooch.activate', 'brooch', p_brooch_id::text,
    jsonb_build_object('destination_url', p_destination));
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Alteração de destino
-- ---------------------------------------------------------------------------
create or replace function public.update_destination(
  p_brooch_id uuid, p_actor_id uuid, p_actor public.actor_kind, p_new_url text
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.brooches%rowtype;
begin
  select * into v_b from public.brooches where id = p_brooch_id for update;
  if not found then
    raise exception 'brooch not found' using errcode = 'P0002';
  end if;
  if p_actor = 'owner' and v_b.owner_id is distinct from p_actor_id then
    raise exception 'not the owner' using errcode = '42501';
  end if;
  if v_b.status not in ('active', 'suspended') or v_b.owner_id is null then
    raise exception 'brooch has no configurable destination' using errcode = 'P0001';
  end if;
  if v_b.destination_url = p_new_url then
    return v_b.destination_url;
  end if;

  update public.brooches set destination_url = p_new_url where id = p_brooch_id;

  insert into public.destination_history (brooch_id, changed_by, actor, reason, old_url, new_url)
  values (p_brooch_id, p_actor_id, p_actor,
          case when p_actor = 'admin' then 'admin_update' else 'owner_update' end,
          v_b.destination_url, p_new_url);

  perform public.write_audit(p_actor_id, p_actor, 'brooch.destination_update', 'brooch', p_brooch_id::text,
    jsonb_build_object('old_url', v_b.destination_url, 'new_url', p_new_url));
  return v_b.destination_url;
end $$;

-- ---------------------------------------------------------------------------
-- Transições de status (espelhadas em lib/brooches/transitions.ts)
--   proprietário: suspend (active→suspended), reactivate (suspended por ele→active)
--   admin:        suspend (available|active→suspended),
--                 reactivate (suspended→active, ou →available se nunca ativado),
--                 revoke (qualquer não revogado→revoked, terminal)
-- ---------------------------------------------------------------------------
create or replace function public.set_brooch_status(
  p_brooch_id uuid, p_actor_id uuid, p_actor public.actor_kind, p_action text
)
returns public.brooch_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.brooches%rowtype;
  v_new public.brooch_status;
begin
  select * into v_b from public.brooches where id = p_brooch_id for update;
  if not found then
    raise exception 'brooch not found' using errcode = 'P0002';
  end if;

  if p_actor = 'owner' then
    if v_b.owner_id is distinct from p_actor_id then
      raise exception 'not the owner' using errcode = '42501';
    end if;
    if p_action = 'suspend' and v_b.status = 'active' then
      v_new := 'suspended';
    elsif p_action = 'reactivate' and v_b.status = 'suspended' and v_b.suspended_by = 'owner' then
      v_new := 'active';
    else
      raise exception 'transition not allowed' using errcode = 'P0001';
    end if;
  elsif p_actor = 'admin' then
    if p_action = 'suspend' and v_b.status in ('available', 'active') then
      v_new := 'suspended';
    elsif p_action = 'reactivate' and v_b.status = 'suspended' then
      v_new := case when v_b.owner_id is not null and v_b.destination_url is not null
                    then 'active'::public.brooch_status else 'available'::public.brooch_status end;
    elsif p_action = 'revoke' and v_b.status <> 'revoked' then
      v_new := 'revoked';
    else
      raise exception 'transition not allowed' using errcode = 'P0001';
    end if;
  else
    raise exception 'invalid actor' using errcode = '22023';
  end if;

  update public.brooches
     set status = v_new,
         suspended_by = case when v_new = 'suspended' then p_actor else null end,
         suspended_at = case when v_new = 'suspended' then now() else suspended_at end,
         revoked_at   = case when v_new = 'revoked' then now() else revoked_at end
   where id = p_brooch_id;

  perform public.write_audit(p_actor_id, p_actor, 'brooch.' || p_action, 'brooch', p_brooch_id::text,
    jsonb_build_object('from', v_b.status, 'to', v_new));
  return v_new;
end $$;

-- Novo código de ativação (ex.: código impresso perdido). Só para broches disponíveis.
create or replace function public.reset_activation_code(
  p_brooch_id uuid, p_actor_id uuid, p_new_hash text, p_new_version integer
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.brooches where id = p_brooch_id and status = 'available') then
    raise exception 'only available brooches can have their code reset' using errcode = 'P0001';
  end if;
  update public.activation_credentials
     set code_hash = p_new_hash, code_version = p_new_version,
         failed_attempts = 0, locked_until = null, used_at = null
   where brooch_id = p_brooch_id and code_version < p_new_version;
  if not found then
    raise exception 'credential version conflict' using errcode = 'P0001';
  end if;
  perform public.write_audit(p_actor_id, 'admin', 'brooch.reset_code', 'brooch', p_brooch_id::text,
    jsonb_build_object('code_version', p_new_version));
end $$;

-- ---------------------------------------------------------------------------
-- Estatísticas
-- ---------------------------------------------------------------------------

-- Visão geral do admin (security definer + verificação explícita)
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total',      count(*),
    'available',  count(*) filter (where status = 'available'),
    'active',     count(*) filter (where status = 'active'),
    'suspended',  count(*) filter (where status = 'suspended'),
    'revoked',    count(*) filter (where status = 'revoked'),
    'activated',  count(*) filter (where activated_at is not null),
    'scans',      coalesce(sum(scan_count), 0)
  ) into v from public.brooches;
  return v;
end $$;

-- Leituras por dia. SECURITY INVOKER: o RLS decide quais broches a pessoa vê.
create or replace function public.scans_per_day(p_brooch_id uuid default null, p_days integer default 30)
returns table (day date, scans bigint)
language sql stable security invoker set search_path = ''
as $$
  with days as (
    select generate_series(
      (now() at time zone 'America/Sao_Paulo')::date - (least(greatest(p_days, 1), 365) - 1),
      (now() at time zone 'America/Sao_Paulo')::date,
      interval '1 day')::date as day
  )
  select d.day, count(e.id)::bigint as scans
    from days d
    left join public.scan_events e
      on (e.scanned_at at time zone 'America/Sao_Paulo')::date = d.day
     and (p_brooch_id is null or e.brooch_id = p_brooch_id)
     and e.scanned_at >= now() - make_interval(days => least(greatest(p_days, 1), 365) + 1)
   group by d.day
   order by d.day;
$$;

-- ---------------------------------------------------------------------------
-- Manutenção (respeitar os 500 MB do Supabase Free)
-- ---------------------------------------------------------------------------
create or replace function public.purge_maintenance(p_scan_retention_days integer default 365)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_scans integer;
  v_rl integer;
begin
  delete from public.scan_events where scanned_at < now() - make_interval(days => p_scan_retention_days);
  get diagnostics v_scans = row_count;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rl = row_count;
  return jsonb_build_object('scan_events_deleted', v_scans, 'rate_limits_deleted', v_rl);
end $$;

-- ---------------------------------------------------------------------------
-- Exclusão de conta: broches ativos do usuário ficam suspensos pelo sistema
-- (o QR continua existindo, mas não redireciona para lugar nenhum).
-- ---------------------------------------------------------------------------
create or replace function public.tg_profile_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.brooches
     set status = 'suspended', suspended_by = 'system', suspended_at = now()
   where owner_id = old.id and status = 'active';
  return old;
end $$;

drop trigger if exists profile_before_delete on public.profiles;
create trigger profile_before_delete
  before delete on public.profiles
  for each row execute function public.tg_profile_before_delete();

-- ---------------------------------------------------------------------------
-- Procedimento SEGURO de atribuição de administrador.
-- Executar somente no SQL Editor do Supabase (papel postgres):
--   select public.promote_to_admin('voce@exemplo.com');
-- Nenhum papel da API (anon, authenticated, service_role) pode executá-la.
-- ---------------------------------------------------------------------------
create or replace function public.promote_to_admin(p_email text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform set_config('brochelink.allow_role_change', 'on', true);
  update public.profiles set role = 'admin'
   where lower(email) = lower(trim(p_email))
  returning id into v_id;
  perform set_config('brochelink.allow_role_change', 'off', true);
  if v_id is null then
    raise exception 'no profile with email %', p_email using errcode = 'P0002';
  end if;
  perform public.write_audit(null, 'system', 'profile.promote_admin', 'profile', v_id::text,
    jsonb_build_object('email', lower(trim(p_email))));
  return v_id;
end $$;

create or replace function public.demote_admin(p_email text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform set_config('brochelink.allow_role_change', 'on', true);
  update public.profiles set role = 'owner'
   where lower(email) = lower(trim(p_email))
  returning id into v_id;
  perform set_config('brochelink.allow_role_change', 'off', true);
  if v_id is null then
    raise exception 'no profile with email %', p_email using errcode = 'P0002';
  end if;
  perform public.write_audit(null, 'system', 'profile.demote_admin', 'profile', v_id::text,
    jsonb_build_object('email', lower(trim(p_email))));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões de execução
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

-- service_role (somente servidor)
grant execute on function
  public.check_rate_limit(text, integer, integer),
  public.register_scan(text, text, text, text, boolean),
  public.create_generation_batch(uuid, integer, text, text),
  public.sync_batch_progress(uuid, text),
  public.brooches_missing_credentials(uuid, integer),
  public.register_failed_activation(uuid, integer, integer),
  public.activate_brooch(uuid, uuid, text, integer),
  public.update_destination(uuid, uuid, public.actor_kind, text),
  public.set_brooch_status(uuid, uuid, public.actor_kind, text),
  public.reset_activation_code(uuid, uuid, text, integer),
  public.write_audit(uuid, public.actor_kind, text, text, text, jsonb),
  public.admin_overview(),
  public.scans_per_day(uuid, integer),
  public.purge_maintenance(integer),
  public.is_admin()
to service_role;

-- authenticated: apenas leituras protegidas por RLS / verificação interna
grant execute on function public.is_admin(), public.scans_per_day(uuid, integer), public.admin_overview()
  to authenticated;

-- promote_to_admin / demote_admin: nenhum papel da API
revoke execute on function public.promote_to_admin(text), public.demote_admin(text)
  from public, anon, authenticated, service_role;

-- Funções criadas no futuro não ficam executáveis por padrão
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
