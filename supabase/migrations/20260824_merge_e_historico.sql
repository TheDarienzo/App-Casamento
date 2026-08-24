-- Duas proteções contra perda de dados na sincronização:
--
-- 1) A Edge Function passou a MESCLAR o estado enviado pelo aparelho com o
--    que já está na nuvem (união por id de cada lista, com concorrência
--    otimista), em vez de substituir. Exclusões viajam na lista "apagados"
--    para não voltarem depois.
--
-- 2) Histórico automático das versões anteriores (abaixo), para recuperar
--    dados caso algo suma sem querer.

create table if not exists public.historico (
  id bigserial primary key,
  casal_id uuid not null references public.casamentos(id) on delete cascade,
  estado jsonb not null,
  criado_em timestamptz not null default now()
);

create index if not exists historico_casal_idx on public.historico (casal_id, criado_em desc);
alter table public.historico enable row level security;

create or replace function public.registrar_historico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.historico
    where casal_id = new.id and criado_em > now() - interval '5 minutes'
  ) then
    insert into public.historico (casal_id, estado) values (new.id, old.estado);
    delete from public.historico h
    where h.casal_id = new.id
      and h.id not in (
        select id from public.historico where casal_id = new.id order by criado_em desc limit 60
      );
  end if;
  return new;
end;
$$;

drop trigger if exists tg_registrar_historico on public.casamentos;
create trigger tg_registrar_historico
  before update on public.casamentos
  for each row when (old.estado is distinct from new.estado)
  execute function public.registrar_historico();
