-- Prazo de cada tarefa: até quando ela precisa estar resolvida.
-- Fica vazio quando a tarefa não tem data marcada.
--
-- As funções ler_estado e salvar_estado (em 20260824_ler_e_salvar_estado.sql)
-- já contemplam a coluna nova.
alter table checklist add column if not exists prazo date;

create index if not exists idx_checklist_prazo
  on checklist (casal_id, prazo)
  where apagado_em is null and not resolvido;

comment on column checklist.prazo is 'Data limite para resolver a tarefa; nulo quando não há prazo.';

-- data inválida ou vazia vira nulo, em vez de derrubar a gravação
create or replace function para_data(t text)
returns date language plpgsql immutable set search_path = public as $$
begin
  return nullif(t, '')::date;
exception when others then
  return null;
end;
$$;

revoke execute on function para_data(text) from anon, authenticated, public;
