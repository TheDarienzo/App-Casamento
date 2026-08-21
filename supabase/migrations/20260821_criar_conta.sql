-- Cria conta nova. Se p_casal vier preenchido, entra num casamento existente
-- (compartilha as listas); senão, cria um casamento novo. Devolve o casal_id.
create or replace function public.criar_conta(p_usuario text, p_senha text, p_casal uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario text := lower(trim(p_usuario));
  v_casal uuid;
begin
  if length(v_usuario) < 3 then raise exception 'usuario_curto'; end if;
  if length(p_senha) < 4 then raise exception 'senha_curta'; end if;
  if exists (select 1 from public.usuarios where usuario = v_usuario) then
    raise exception 'usuario_existe';
  end if;
  if p_casal is not null then
    if not exists (select 1 from public.casamentos where id = p_casal) then
      raise exception 'casal_invalido';
    end if;
    v_casal := p_casal;
  else
    insert into public.casamentos (estado) values ('{}'::jsonb) returning id into v_casal;
  end if;
  insert into public.usuarios (usuario, senha, casal_id)
    values (v_usuario, extensions.crypt(p_senha, extensions.gen_salt('bf')), v_casal);
  return v_casal;
end;
$$;

revoke execute on function public.criar_conta(text, text, uuid) from public, anon, authenticated;
grant execute on function public.criar_conta(text, text, uuid) to service_role;
