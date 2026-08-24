-- Leitura e gravação passam a ser feitas dentro do banco, numa transação só.
-- Se qualquer parte falhar, nada é gravado pela metade.

create or replace function para_tempo(t text)
returns timestamptz language plpgsql immutable set search_path = public as $$
begin
  return nullif(t, '')::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function para_inteiro(t text, padrao bigint)
returns bigint language plpgsql immutable set search_path = public as $$
begin
  return coalesce(nullif(regexp_replace(coalesce(t, ''), '[^0-9-]', '', 'g'), '')::bigint, padrao);
exception when others then
  return padrao;
end;
$$;

create or replace function para_booleano(t text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(lower(t) in ('true', 't', '1', 'sim'), false);
$$;

-- Monta o documento que o aplicativo espera, lendo das tabelas.
create or replace function ler_estado(p_casal uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'atualizado_em', greatest(
      c.atualizado_em,
      coalesce((select max(atualizado_em) from convidados   where casal_id = c.id), c.criado_em),
      coalesce((select max(atualizado_em) from checklist    where casal_id = c.id), c.criado_em),
      coalesce((select max(atualizado_em) from padrinhos    where casal_id = c.id), c.criado_em),
      coalesce((select max(atualizado_em) from fornecedores where casal_id = c.id), c.criado_em),
      coalesce((select max(atualizado_em) from presentes    where casal_id = c.id), c.criado_em),
      coalesce((select max(atualizado_em) from notas        where casal_id = c.id), c.criado_em)
    ),
    'estado', jsonb_build_object(
      'config', jsonb_build_object(
        'noiva', c.noiva, 'noivo', c.noivo, 'data', c.data_casamento,
        'local', c.local, 'foto', c.foto
      ),
      'convidados', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'nome', nome, 'lado', lado,
          'acompanhantes', acompanhantes, 'confirmado', confirmado
        ) order by criado_em)
        from convidados where casal_id = c.id and apagado_em is null), '[]'::jsonb),
      'itens', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'descricao', descricao, 'valor', valor, 'resolvido', resolvido
        ) order by criado_em)
        from checklist where casal_id = c.id and apagado_em is null), '[]'::jsonb),
      'padrinhos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'padrinho', padrinho, 'madrinha', madrinha
        ) order by criado_em)
        from padrinhos where casal_id = c.id and apagado_em is null), '[]'::jsonb),
      'fornecedores', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'nome', nome, 'categoria', categoria, 'contato', contato
        ) order by criado_em)
        from fornecedores where casal_id = c.id and apagado_em is null), '[]'::jsonb),
      'presentes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'nome', nome, 'valor', valor, 'link', link, 'status', status
        ) order by criado_em)
        from presentes where casal_id = c.id and apagado_em is null), '[]'::jsonb),
      'notas', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'texto', texto, 'cor', cor, 'autor', autor, 'fixada', fixada,
          'criadoEm', to_char(criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'editadoEm', coalesce(to_char(editado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '')
        ) order by criado_em desc)
        from notas where casal_id = c.id and apagado_em is null), '[]'::jsonb),
      -- o aplicativo usa esta lista para remover das telas o que foi apagado
      'apagados', coalesce((
        select jsonb_agg(jsonb_build_object('id', id, 'em', em) order by em desc)
        from (
          select id, to_char(apagado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as em
            from convidados   where casal_id = c.id and apagado_em is not null
          union all select id, to_char(apagado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            from checklist    where casal_id = c.id and apagado_em is not null
          union all select id, to_char(apagado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            from padrinhos    where casal_id = c.id and apagado_em is not null
          union all select id, to_char(apagado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            from fornecedores where casal_id = c.id and apagado_em is not null
          union all select id, to_char(apagado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            from presentes    where casal_id = c.id and apagado_em is not null
          union all select id, to_char(apagado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            from notas        where casal_id = c.id and apagado_em is not null
          order by 2 desc limit 300
        ) apagados), '[]'::jsonb)
    )
  )
  from casamentos c where c.id = p_casal;
$$;

-- Grava o que veio do aparelho: cada cadastro vai para a sua linha.
-- Nada é apagado por estar ausente do que o aparelho mandou — só sai da
-- tela o que foi apagado de propósito (lista "apagados"). Foi essa regra
-- que faltou antes, quando um aparelho sobrescrevia o cadastro do outro.
create or replace function salvar_estado(p_casal uuid, p_estado jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  existe boolean;
  t text;
begin
  select true into existe from casamentos where id = p_casal;
  if not found then raise exception 'casal_invalido'; end if;

  if p_estado ? 'config' then
    update casamentos set
      noiva          = coalesce(p_estado #>> '{config,noiva}', noiva),
      noivo          = coalesce(p_estado #>> '{config,noivo}', noivo),
      data_casamento = coalesce(p_estado #>> '{config,data}', data_casamento),
      local          = coalesce(p_estado #>> '{config,local}', local),
      foto           = coalesce(p_estado #>> '{config,foto}', foto)
    where id = p_casal;
  end if;

  insert into convidados (id, casal_id, nome, lado, acompanhantes, confirmado)
  select j->>'id', p_casal,
         coalesce(j->>'nome', ''),
         case when j->>'lado' = 'noiva' then 'noiva' else 'noivo' end,
         greatest(para_inteiro(j->>'acompanhantes', 0), 0),
         para_booleano(j->>'confirmado')
    from jsonb_array_elements(coalesce(p_estado->'convidados', '[]'::jsonb)) j
   where jsonb_typeof(j) = 'object' and nullif(j->>'id', '') is not null
      on conflict (id) do update set
         nome = excluded.nome, lado = excluded.lado,
         acompanhantes = excluded.acompanhantes, confirmado = excluded.confirmado
       where convidados.casal_id = excluded.casal_id;

  insert into checklist (id, casal_id, descricao, valor, resolvido)
  select j->>'id', p_casal,
         coalesce(j->>'descricao', ''),
         greatest(para_inteiro(j->>'valor', 0), 0),
         para_booleano(j->>'resolvido')
    from jsonb_array_elements(coalesce(p_estado->'itens', '[]'::jsonb)) j
   where jsonb_typeof(j) = 'object' and nullif(j->>'id', '') is not null
      on conflict (id) do update set
         descricao = excluded.descricao, valor = excluded.valor, resolvido = excluded.resolvido
       where checklist.casal_id = excluded.casal_id;

  insert into padrinhos (id, casal_id, padrinho, madrinha)
  select j->>'id', p_casal, coalesce(j->>'padrinho', ''), coalesce(j->>'madrinha', '')
    from jsonb_array_elements(coalesce(p_estado->'padrinhos', '[]'::jsonb)) j
   where jsonb_typeof(j) = 'object' and nullif(j->>'id', '') is not null
      on conflict (id) do update set
         padrinho = excluded.padrinho, madrinha = excluded.madrinha
       where padrinhos.casal_id = excluded.casal_id;

  insert into fornecedores (id, casal_id, nome, categoria, contato)
  select j->>'id', p_casal, coalesce(j->>'nome', ''), coalesce(j->>'categoria', ''), coalesce(j->>'contato', '')
    from jsonb_array_elements(coalesce(p_estado->'fornecedores', '[]'::jsonb)) j
   where jsonb_typeof(j) = 'object' and nullif(j->>'id', '') is not null
      on conflict (id) do update set
         nome = excluded.nome, categoria = excluded.categoria, contato = excluded.contato
       where fornecedores.casal_id = excluded.casal_id;

  insert into presentes (id, casal_id, nome, valor, link, status)
  select j->>'id', p_casal,
         coalesce(j->>'nome', ''),
         greatest(para_inteiro(j->>'valor', 0), 0),
         coalesce(j->>'link', ''),
         case when j->>'status' in ('falta', 'comprado', 'ganho') then j->>'status' else 'falta' end
    from jsonb_array_elements(coalesce(p_estado->'presentes', '[]'::jsonb)) j
   where jsonb_typeof(j) = 'object' and nullif(j->>'id', '') is not null
      on conflict (id) do update set
         nome = excluded.nome, valor = excluded.valor,
         link = excluded.link, status = excluded.status
       where presentes.casal_id = excluded.casal_id;

  insert into notas (id, casal_id, texto, cor, autor, fixada, criado_em, editado_em)
  select j->>'id', p_casal,
         coalesce(j->>'texto', ''),
         coalesce(nullif(j->>'cor', ''), 'papel'),
         coalesce(j->>'autor', ''),
         para_booleano(j->>'fixada'),
         coalesce(para_tempo(j->>'criadoEm'), now()),
         para_tempo(j->>'editadoEm')
    from jsonb_array_elements(coalesce(p_estado->'notas', '[]'::jsonb)) j
   where jsonb_typeof(j) = 'object' and nullif(j->>'id', '') is not null
      on conflict (id) do update set
         texto = excluded.texto, cor = excluded.cor, autor = excluded.autor,
         fixada = excluded.fixada, editado_em = excluded.editado_em
       where notas.casal_id = excluded.casal_id;

  -- exclusões vêm depois das gravações, para que apagar sempre vença
  foreach t in array array['convidados','checklist','padrinhos','fornecedores','presentes','notas'] loop
    execute format(
      'update %I d set apagado_em = coalesce(para_tempo(a.j->>%L), now())
         from jsonb_array_elements(coalesce($1->%L, %L::jsonb)) a(j)
        where d.id = a.j->>%L and d.casal_id = $2 and d.apagado_em is null',
      t, 'em', 'apagados', '[]', 'id')
    using p_estado, p_casal;
  end loop;

  -- espelho do documento antigo, mantido só como cópia de segurança
  update casamentos
     set estado = (ler_estado(p_casal))->'estado',
         atualizado_em = now()
   where id = p_casal;

  return ler_estado(p_casal);
end;
$$;

-- Só a API (service role) pode ler e gravar. Sem isto, qualquer pessoa com
-- a chave pública do projeto poderia chamar estas funções direto pelo
-- /rest/v1/rpc/, contornando a nossa API.
revoke execute on function ler_estado(uuid) from anon, authenticated, public;
revoke execute on function salvar_estado(uuid, jsonb) from anon, authenticated, public;
revoke execute on function registrar_historico() from anon, authenticated, public;
revoke execute on function rls_auto_enable() from anon, authenticated, public;
revoke execute on function login_usuario(text, text) from anon, authenticated, public;
revoke execute on function criar_conta(text, text, uuid) from anon, authenticated, public;
revoke execute on function juntar_ao_casal(text, text, uuid) from anon, authenticated, public;
revoke execute on function membros_do_casal(uuid) from anon, authenticated, public;

grant execute on function ler_estado(uuid) to service_role;
grant execute on function salvar_estado(uuid, jsonb) to service_role;
grant execute on function login_usuario(text, text) to service_role;
grant execute on function criar_conta(text, text, uuid) to service_role;
grant execute on function juntar_ao_casal(text, text, uuid) to service_role;
grant execute on function membros_do_casal(uuid) to service_role;
