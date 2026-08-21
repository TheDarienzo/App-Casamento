-- Estado completo do planejamento de cada casal, indexado por um código
-- secreto (uuid) que funciona como chave de acesso compartilhada entre os
-- celulares do casal. Acesso somente via Edge Function (service role):
-- RLS ligado sem policies bloqueia anon/authenticated.
create table public.casamentos (
  id uuid primary key default gen_random_uuid(),
  estado jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.casamentos enable row level security;

comment on table public.casamentos is 'Estado do app Nosso Casamento por casal; id é o código secreto de sincronização.';
