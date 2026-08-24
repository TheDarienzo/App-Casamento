-- Passa o conteúdo do documento JSON para as tabelas novas.
-- A coluna casamentos.estado continua intacta como cópia de segurança.

update casamentos set
  noiva          = coalesce(estado #>> '{config,noiva}', ''),
  noivo          = coalesce(estado #>> '{config,noivo}', ''),
  data_casamento = coalesce(estado #>> '{config,data}', ''),
  local          = coalesce(estado #>> '{config,local}', ''),
  foto           = coalesce(estado #>> '{config,foto}', '');

insert into convidados (id, casal_id, nome, lado, acompanhantes, confirmado)
select j->>'id', c.id,
       coalesce(j->>'nome', ''),
       case when j->>'lado' = 'noiva' then 'noiva' else 'noivo' end,
       greatest(coalesce((j->>'acompanhantes')::int, 0), 0),
       coalesce((j->>'confirmado')::boolean, false)
from casamentos c, lateral jsonb_array_elements(coalesce(c.estado->'convidados', '[]'::jsonb)) j
where j->>'id' is not null
on conflict (id) do nothing;

insert into checklist (id, casal_id, descricao, valor, resolvido)
select j->>'id', c.id,
       coalesce(j->>'descricao', ''),
       coalesce((j->>'valor')::bigint, 0),
       coalesce((j->>'resolvido')::boolean, false)
from casamentos c, lateral jsonb_array_elements(coalesce(c.estado->'itens', '[]'::jsonb)) j
where j->>'id' is not null
on conflict (id) do nothing;

insert into padrinhos (id, casal_id, padrinho, madrinha)
select j->>'id', c.id, coalesce(j->>'padrinho', ''), coalesce(j->>'madrinha', '')
from casamentos c, lateral jsonb_array_elements(coalesce(c.estado->'padrinhos', '[]'::jsonb)) j
where j->>'id' is not null
on conflict (id) do nothing;

insert into fornecedores (id, casal_id, nome, categoria, contato)
select j->>'id', c.id, coalesce(j->>'nome', ''), coalesce(j->>'categoria', ''), coalesce(j->>'contato', '')
from casamentos c, lateral jsonb_array_elements(coalesce(c.estado->'fornecedores', '[]'::jsonb)) j
where j->>'id' is not null
on conflict (id) do nothing;

insert into presentes (id, casal_id, nome, valor, link, status)
select j->>'id', c.id,
       coalesce(j->>'nome', ''),
       coalesce((j->>'valor')::bigint, 0),
       coalesce(j->>'link', ''),
       case when j->>'status' in ('falta', 'comprado', 'ganho') then j->>'status' else 'falta' end
from casamentos c, lateral jsonb_array_elements(coalesce(c.estado->'presentes', '[]'::jsonb)) j
where j->>'id' is not null
on conflict (id) do nothing;

insert into notas (id, casal_id, texto, cor, autor, fixada, criado_em, editado_em)
select j->>'id', c.id,
       coalesce(j->>'texto', ''),
       coalesce(nullif(j->>'cor', ''), 'papel'),
       coalesce(j->>'autor', ''),
       coalesce((j->>'fixada')::boolean, false),
       coalesce((j->>'criadoEm')::timestamptz, now()),
       nullif(j->>'editadoEm', '')::timestamptz
from casamentos c, lateral jsonb_array_elements(coalesce(c.estado->'notas', '[]'::jsonb)) j
where j->>'id' is not null
on conflict (id) do nothing;

-- exclusões que estavam na lista "apagados" viram soft delete nas tabelas
do $$
declare t text;
begin
  foreach t in array array['convidados','checklist','padrinhos','fornecedores','presentes','notas'] loop
    execute format(
      'update %I d set apagado_em = coalesce(nullif(a.j->>%L, %L)::timestamptz, now())
         from casamentos c, lateral jsonb_array_elements(coalesce(c.estado->%L, %L::jsonb)) a(j)
        where d.id = a.j->>%L and d.casal_id = c.id and d.apagado_em is null',
      t, 'em', '', 'apagados', '[]', 'id');
  end loop;
end;
$$;
