-- Aplicado no projeto como quatro migrações:
--   seguranca_config_e_tentativas, sessoes_assinadas_com_prazo,
--   login_com_limite_e_bcrypt_forte, limites_por_campo_e_foto
-- (esta última está em 20260824_limites_por_campo.sql)

-- ---------- guarda de configuração e registro de tentativas ----------

create table if not exists configuracao (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);
alter table configuracao enable row level security;
comment on table configuracao is 'Segredos e ajustes do servidor. Nunca sai para o aplicativo.';

-- Toda tentativa de login fica registrada, para poder bloquear quem insiste.
-- O endereço de rede é guardado em resumo (hash), não em claro.
create table if not exists tentativas_login (
  id bigserial primary key,
  usuario text not null default '',
  origem text not null default '',
  sucesso boolean not null default false,
  criado_em timestamptz not null default now()
);
alter table tentativas_login enable row level security;
create index if not exists idx_tentativas_usuario on tentativas_login (usuario, criado_em desc);
create index if not exists idx_tentativas_origem on tentativas_login (origem, criado_em desc);

-- Sessões emitidas antes desta hora deixam de valer.
alter table usuarios
  add column if not exists tokens_validos_apos timestamptz not null default now();

create or replace function segredo_sessao()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v text;
begin
  select valor into v from configuracao where chave = 'segredo_sessao';
  if v is null then
    v := encode(extensions.gen_random_bytes(32), 'hex');
    insert into configuracao (chave, valor) values ('segredo_sessao', v)
      on conflict (chave) do update set valor = excluded.valor
      returning valor into v;
  end if;
  return v;
end;
$$;

-- Quantos segundos faltam para poder tentar de novo (0 = liberado).
create or replace function bloqueio_login(p_usuario text, p_origem text)
returns integer language sql stable security definer set search_path = public as $$
  with janela as (select now() - interval '15 minutes' as desde),
  por_usuario as (
    select max(criado_em) as ultima, count(*) as erros
      from tentativas_login, janela
     where usuario = lower(trim(p_usuario)) and not sucesso and criado_em > janela.desde
  ),
  por_origem as (
    select max(criado_em) as ultima, count(*) as erros
      from tentativas_login, janela
     where origem = p_origem and p_origem <> '' and not sucesso and criado_em > janela.desde
  )
  select greatest(
    coalesce((select ceil(extract(epoch from (ultima + interval '15 minutes' - now())))::int
                from por_usuario where erros >= 5), 0),
    coalesce((select ceil(extract(epoch from (ultima + interval '15 minutes' - now())))::int
                from por_origem where erros >= 20), 0),
    0);
$$;

create or replace function registrar_tentativa(p_usuario text, p_origem text, p_sucesso boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into tentativas_login (usuario, origem, sucesso)
    values (lower(trim(p_usuario)), coalesce(p_origem, ''), p_sucesso);
  if p_sucesso then
    delete from tentativas_login where usuario = lower(trim(p_usuario)) and not sucesso;
  end if;
  delete from tentativas_login where criado_em < now() - interval '2 days';
end;
$$;

-- ---------- sessões assinadas ----------
--   conteudo.assinatura   (base64url)
--   conteudo = { c: casal, u: usuario, e: expira, i: emitido }

create or replace function b64url(p bytea)
returns text language sql immutable set search_path = public as $$
  select rtrim(translate(replace(encode(p, 'base64'), E'\n', ''), '+/', '-_'), '=');
$$;

create or replace function b64url_volta(p text)
returns bytea language sql immutable set search_path = public as $$
  select decode(translate(p, '-_', '+/') || repeat('=', (4 - length(p) % 4) % 4), 'base64');
$$;

create or replace function emitir_token(p_casal uuid, p_usuario text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  conteudo text;
  assinatura text;
begin
  conteudo := b64url(convert_to(jsonb_build_object(
    'c', p_casal::text,
    'u', lower(trim(p_usuario)),
    'i', floor(extract(epoch from now()))::bigint,
    'e', floor(extract(epoch from now() + interval '30 days'))::bigint
  )::text, 'utf8'));
  assinatura := b64url(extensions.hmac(conteudo, segredo_sessao(), 'sha256'));
  return conteudo || '.' || assinatura;
end;
$$;

create or replace function validar_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  partes text[];
  dados jsonb;
  esperada text;
  agora bigint := floor(extract(epoch from now()))::bigint;
  corte timestamptz;
begin
  if p_token is null or p_token = '' then
    return jsonb_build_object('erro', 'sessao_invalida');
  end if;
  partes := string_to_array(p_token, '.');
  if array_length(partes, 1) <> 2 then
    return jsonb_build_object('erro', 'sessao_invalida');
  end if;

  begin
    esperada := b64url(extensions.hmac(partes[1], segredo_sessao(), 'sha256'));
    if esperada <> partes[2] then
      return jsonb_build_object('erro', 'sessao_invalida');
    end if;
    dados := convert_from(b64url_volta(partes[1]), 'utf8')::jsonb;
  exception when others then
    return jsonb_build_object('erro', 'sessao_invalida');
  end;

  if (dados->>'e')::bigint <= agora then
    return jsonb_build_object('erro', 'sessao_expirada');
  end if;

  select tokens_validos_apos into corte from usuarios where usuario = dados->>'u';
  if corte is not null and (dados->>'i')::bigint < floor(extract(epoch from corte))::bigint then
    return jsonb_build_object('erro', 'sessao_expirada');
  end if;

  if not exists (select 1 from casamentos where id = (dados->>'c')::uuid) then
    return jsonb_build_object('erro', 'sessao_invalida');
  end if;

  return jsonb_build_object(
    'casal', dados->>'c',
    'usuario', dados->>'u',
    'renovar', (dados->>'e')::bigint - agora < 7 * 86400
  );
end;
$$;

create or replace function revogar_sessoes(p_casal uuid)
returns void language sql security definer set search_path = public as $$
  update usuarios set tokens_validos_apos = now() where casal_id = p_casal;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'segredo_sessao()', 'bloqueio_login(text, text)',
    'registrar_tentativa(text, text, boolean)', 'b64url(bytea)', 'b64url_volta(text)',
    'emitir_token(uuid, text)', 'validar_token(text)', 'revogar_sessoes(uuid)'
  ] loop
    execute format('revoke execute on function %s from anon, authenticated, public', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
