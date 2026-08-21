-- Usuários do app (login do casal). Senha guardada como hash bcrypt.
-- RLS ligado sem policies: acesso somente via Edge Function (service role).
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  usuario text not null unique,
  senha text not null, -- hash bcrypt (extensions.crypt / gen_salt)
  casal_id uuid not null references public.casamentos(id) on delete cascade,
  criado_em timestamptz not null default now()
);

alter table public.usuarios enable row level security;

-- Valida usuário+senha e devolve o casal_id (ou null se inválido).
create or replace function public.login_usuario(p_usuario text, p_senha text)
returns uuid
language sql
security definer
set search_path = public, extensions
as $$
  select casal_id
  from public.usuarios
  where usuario = lower(trim(p_usuario))
    and senha = extensions.crypt(p_senha, senha);
$$;

revoke execute on function public.login_usuario(text, text) from public, anon, authenticated;
grant execute on function public.login_usuario(text, text) to service_role;

-- Para criar um usuário (rode manualmente, trocando os valores):
-- with c as (insert into public.casamentos (estado) values ('{}'::jsonb) returning id)
-- insert into public.usuarios (usuario, senha, casal_id)
-- select 'lucasdarienzo', extensions.crypt('SUA_SENHA', extensions.gen_salt('bf')), id from c;
