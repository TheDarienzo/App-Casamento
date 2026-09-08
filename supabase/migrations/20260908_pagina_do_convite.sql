-- Página pública do convite (pasta convite/).
--
-- Cada família ganha um código curto que abre a página já com o nome dela.
-- O código é público de propósito: ele não dá acesso a nada além da própria
-- confirmação. O código do casal (que é a chave do aplicativo) nunca sai
-- daqui — a página é identificada por um apelido público (slug).

alter table convidados
  add column if not exists codigo text,
  add column if not exists telefone text not null default '',
  add column if not exists confirmado_em timestamptz,
  add column if not exists pessoas_confirmadas integer,
  add column if not exists recado text not null default '';

-- Código sem letras que se confundem (0/O, 1/l/I), para poder ser ditado.
create or replace function gerar_codigo_convite()
returns text language sql volatile set search_path = public, extensions as $$
  select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '')
    from generate_series(1, 6);
$$;

create or replace function preencher_codigo_convite()
returns trigger language plpgsql set search_path = public as $$
declare tentativa integer := 0;
begin
  while new.codigo is null and tentativa < 20 loop
    new.codigo := gerar_codigo_convite();
    if exists (select 1 from convidados where codigo = new.codigo) then new.codigo := null; end if;
    tentativa := tentativa + 1;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_convidados_codigo on convidados;
create trigger trg_convidados_codigo before insert on convidados
  for each row execute function preencher_codigo_convite();

do $$
declare linha record; novo text;
begin
  for linha in select id from convidados where codigo is null loop
    loop
      novo := gerar_codigo_convite();
      exit when not exists (select 1 from convidados where codigo = novo);
    end loop;
    update convidados set codigo = novo where id = linha.id;
  end loop;
end;
$$;

create unique index if not exists idx_convidados_codigo on convidados (codigo);

create table if not exists convite (
  casal_id uuid primary key references casamentos(id) on delete cascade,
  slug text not null unique,
  publicado boolean not null default false,
  titulo text not null default '',
  mensagem text not null default '',
  local_nome text not null default '',
  endereco text not null default '',
  mapa_link text not null default '',
  presentes_link text not null default '',
  presentes_texto text not null default '',
  pix_chave text not null default '',
  pix_nome text not null default '',
  traje text not null default '',
  prazo_confirmacao date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table convite enable row level security;
drop trigger if exists trg_convite_atualizacao on convite;
create trigger trg_convite_atualizacao before update on convite
  for each row execute function marcar_atualizacao();

-- acessos públicos, para limitar quem insistir na busca por nome
create table if not exists acessos_convite (
  id bigserial primary key,
  origem text not null default '',
  criado_em timestamptz not null default now()
);
alter table acessos_convite enable row level security;
create index if not exists idx_acessos_convite on acessos_convite (origem, criado_em desc);

-- ---------- funções que respondem sem sessão ----------

create or replace function sem_acento(t text)
returns text language sql immutable set search_path = public as $$
  select lower(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'));
$$;

create or replace function apelido_publico(t text)
returns text language sql immutable set search_path = public as $$
  select nullif(trim(both '-' from regexp_replace(
    regexp_replace(sem_acento(t), '[^a-z0-9]+', '-', 'g'), '-{2,}', '-', 'g')), '');
$$;

-- 40 chamadas em 10 minutos por origem
create or replace function limite_convite(p_origem text)
returns boolean language plpgsql security definer set search_path = public as $$
declare quantas integer;
begin
  delete from acessos_convite where criado_em < now() - interval '1 day';
  select count(*) into quantas from acessos_convite
   where origem = p_origem and p_origem <> '' and criado_em > now() - interval '10 minutes';
  if quantas >= 40 then return false; end if;
  insert into acessos_convite (origem) values (coalesce(p_origem, ''));
  return true;
end;
$$;

-- O corpo de convite_info, convite_convidado, convite_buscar e
-- convite_confirmar está aplicado no projeto (migração
-- funcoes_publicas_do_convite). Para reproduzir do zero:
--   select pg_get_functiondef('convite_info(text)'::regprocedure);
-- Regras em vigor:
--   info/busca só respondem com o convite publicado
--   busca exige 3 letras e devolve no máximo 8 nomes
--   confirmar nunca aceita mais pessoas do que foram convidadas
--   nenhuma delas devolve telefone nem o código do casal

do $$
declare f text;
begin
  foreach f in array array[
    'gerar_codigo_convite()', 'preencher_codigo_convite()', 'sem_acento(text)',
    'apelido_publico(text)', 'limite_convite(text)'
  ] loop
    execute format('revoke execute on function %s from anon, authenticated, public', f);
  end loop;
end;
$$;
