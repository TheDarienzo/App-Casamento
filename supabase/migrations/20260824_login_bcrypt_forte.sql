-- bcrypt com custo 12 (o anterior era 6, rápido demais para quem tenta
-- adivinhar senha em massa) e senha de no mínimo 8 caracteres.
-- Login, juntar contas e troca de senha passam pelo limite de tentativas
-- e devolvem um bilhete de sessão.

create or replace function criar_conta(p_usuario text, p_senha text, p_casal uuid default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_usuario text := lower(trim(p_usuario));
  v_casal uuid;
begin
  if length(v_usuario) < 3 then raise exception 'usuario_curto'; end if;
  if length(p_senha) < 8 then raise exception 'senha_curta'; end if;
  if exists (select 1 from usuarios where usuario = v_usuario) then
    raise exception 'usuario_existe';
  end if;

  if p_casal is not null then
    if not exists (select 1 from casamentos where id = p_casal) then
      raise exception 'casal_invalido';
    end if;
    v_casal := p_casal;
  else
    insert into casamentos default values returning id into v_casal;
  end if;

  insert into usuarios (usuario, senha, casal_id)
    values (v_usuario, extensions.crypt(p_senha, extensions.gen_salt('bf', 12)), v_casal);

  return v_casal;
end;
$$;

-- Devolve { casal, usuario, token } ou { erro, espera }.
create or replace function login_usuario(p_usuario text, p_senha text, p_origem text default '')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_usuario text := lower(trim(p_usuario));
  v_espera integer;
  v_casal uuid;
  v_hash text;
begin
  v_espera := bloqueio_login(v_usuario, p_origem);
  if v_espera > 0 then
    return jsonb_build_object('erro', 'muitas_tentativas', 'espera', v_espera);
  end if;

  select casal_id, senha into v_casal, v_hash from usuarios where usuario = v_usuario;

  if v_casal is null or v_hash <> extensions.crypt(p_senha, v_hash) then
    perform registrar_tentativa(v_usuario, p_origem, false);
    return jsonb_build_object('erro', 'login_invalido');
  end if;

  -- acertou com um hash fraco do formato antigo: reforça agora, sem pedir
  -- nada ao usuário
  if v_hash not like '$2a$1%' and v_hash not like '$2b$1%' then
    update usuarios set senha = extensions.crypt(p_senha, extensions.gen_salt('bf', 12))
     where usuario = v_usuario;
  end if;

  perform registrar_tentativa(v_usuario, p_origem, true);
  return jsonb_build_object(
    'casal', v_casal::text,
    'usuario', v_usuario,
    'token', emitir_token(v_casal, v_usuario)
  );
end;
$$;

create or replace function juntar_ao_casal(p_usuario text, p_senha text, p_casal uuid, p_origem text default '')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_usuario text := lower(trim(p_usuario));
  v_espera integer;
  v_hash text;
begin
  v_espera := bloqueio_login(v_usuario, p_origem);
  if v_espera > 0 then
    return jsonb_build_object('erro', 'muitas_tentativas', 'espera', v_espera);
  end if;

  select senha into v_hash from usuarios where usuario = v_usuario;
  if v_hash is null or v_hash <> extensions.crypt(p_senha, v_hash) then
    perform registrar_tentativa(v_usuario, p_origem, false);
    return jsonb_build_object('erro', 'login_invalido');
  end if;
  if not exists (select 1 from casamentos where id = p_casal) then
    return jsonb_build_object('erro', 'casal_invalido');
  end if;

  perform registrar_tentativa(v_usuario, p_origem, true);
  update usuarios set casal_id = p_casal where usuario = v_usuario;
  return jsonb_build_object(
    'casal', p_casal::text,
    'usuario', v_usuario,
    'token', emitir_token(p_casal, v_usuario)
  );
end;
$$;

-- Trocar a própria senha, exigindo a atual. Derruba as sessões antigas.
create or replace function trocar_senha(p_usuario text, p_atual text, p_nova text, p_origem text default '')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_usuario text := lower(trim(p_usuario));
  v_espera integer;
  v_hash text;
  v_casal uuid;
begin
  v_espera := bloqueio_login(v_usuario, p_origem);
  if v_espera > 0 then
    return jsonb_build_object('erro', 'muitas_tentativas', 'espera', v_espera);
  end if;
  if length(p_nova) < 8 then
    return jsonb_build_object('erro', 'senha_curta');
  end if;

  select senha, casal_id into v_hash, v_casal from usuarios where usuario = v_usuario;
  if v_hash is null or v_hash <> extensions.crypt(p_atual, v_hash) then
    perform registrar_tentativa(v_usuario, p_origem, false);
    return jsonb_build_object('erro', 'login_invalido');
  end if;

  update usuarios
     set senha = extensions.crypt(p_nova, extensions.gen_salt('bf', 12)),
         tokens_validos_apos = now()
   where usuario = v_usuario;

  perform registrar_tentativa(v_usuario, p_origem, true);
  return jsonb_build_object('ok', true, 'token', emitir_token(v_casal, v_usuario));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'criar_conta(text, text, uuid)', 'login_usuario(text, text, text)',
    'juntar_ao_casal(text, text, uuid, text)', 'trocar_senha(text, text, text, text)'
  ] loop
    execute format('revoke execute on function %s from anon, authenticated, public', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- as versões antigas, sem limite de tentativas, saem de circulação
drop function if exists login_usuario(text, text);
drop function if exists juntar_ao_casal(text, text, uuid);
