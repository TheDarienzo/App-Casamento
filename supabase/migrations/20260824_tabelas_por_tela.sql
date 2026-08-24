-- Uma tabela para cada tela do aplicativo. Cada cadastro passa a ser uma
-- linha própria: um salvamento com problema mexe naquela linha, e não no
-- conjunto inteiro como acontecia com o documento JSON.
--
-- Os ids continuam sendo os mesmos que o aplicativo já usa (texto curto),
-- para que nada precise ser renumerado na migração.
--
-- Exclusão é marcada em apagado_em (soft delete): o registro sai das telas
-- mas continua no banco, então dá para recuperar e a exclusão se propaga
-- entre os aparelhos sem lista de "apagados".

-- dados do casal que antes ficavam em estado->config
alter table casamentos
  add column if not exists noiva text not null default '',
  add column if not exists noivo text not null default '',
  add column if not exists data_casamento text not null default '',
  add column if not exists local text not null default '',
  add column if not exists foto text not null default '';

create or replace function marcar_atualizacao()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create table if not exists convidados (
  id text primary key,
  casal_id uuid not null references casamentos(id) on delete cascade,
  nome text not null,
  lado text not null check (lado in ('noiva', 'noivo')),
  acompanhantes integer not null default 0 check (acompanhantes >= 0),
  confirmado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em timestamptz
);

create table if not exists checklist (
  id text primary key,
  casal_id uuid not null references casamentos(id) on delete cascade,
  descricao text not null,
  valor bigint not null default 0,          -- em centavos
  resolvido boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em timestamptz
);

create table if not exists padrinhos (
  id text primary key,
  casal_id uuid not null references casamentos(id) on delete cascade,
  padrinho text not null default '',
  madrinha text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em timestamptz
);

create table if not exists fornecedores (
  id text primary key,
  casal_id uuid not null references casamentos(id) on delete cascade,
  nome text not null,
  categoria text not null default '',
  contato text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em timestamptz
);

create table if not exists presentes (
  id text primary key,
  casal_id uuid not null references casamentos(id) on delete cascade,
  nome text not null,
  valor bigint not null default 0,          -- em centavos
  link text not null default '',
  status text not null default 'falta' check (status in ('falta', 'comprado', 'ganho')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em timestamptz
);

create table if not exists notas (
  id text primary key,
  casal_id uuid not null references casamentos(id) on delete cascade,
  texto text not null,
  cor text not null default 'papel',
  autor text not null default '',
  fixada boolean not null default false,
  criado_em timestamptz not null default now(),
  editado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  apagado_em timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['convidados','checklist','padrinhos','fornecedores','presentes','notas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create index if not exists %I on %I (casal_id) where apagado_em is null', 'idx_' || t || '_casal', t);
    execute format('create index if not exists %I on %I (casal_id, atualizado_em)', 'idx_' || t || '_sync', t);
    execute format('drop trigger if exists trg_%I_atualizacao on %I', t, t);
    execute format('create trigger trg_%I_atualizacao before update on %I for each row execute function marcar_atualizacao()', t, t);
  end loop;
end;
$$;

comment on table convidados is 'Lista de convidados — tela Convidados.';
comment on table checklist is 'Itens a resolver com valores — tela Checklist.';
comment on table padrinhos is 'Padrinhos e madrinhas em pares — tela Padrinhos.';
comment on table fornecedores is 'Contatos de fornecedores — tela Fornecedores.';
comment on table presentes is 'Lista de presentes — tela Presentes.';
comment on table notas is 'Bloco de anotações — tela Notas.';
