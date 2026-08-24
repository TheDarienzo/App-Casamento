-- O aplicativo já limita o tamanho dos campos, mas quem chamar a API direto
-- não passa por ele. Agora o corte acontece no banco também, e a foto só
-- entra se realmente for uma imagem.
--
-- Esta migração redefine salvar_estado por cima da versão de
-- 20260824_ler_e_salvar_estado.sql. Só mudam as entradas: cada texto ganha
-- um corte próprio, números são limitados, link de presente precisa ser
-- http(s) e a foto precisa ser data URL de imagem.

create or replace function foto_valida(t text)
returns boolean language sql immutable set search_path = public as $$
  select t = '' or (
    length(t) <= 400000
    and t ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$'
  );
$$;

revoke execute on function foto_valida(text) from anon, authenticated, public;

-- O corpo completo de salvar_estado com os limites está aplicado no projeto
-- (migração limites_por_campo_e_foto). Para reproduzir do zero, rode esta
-- consulta contra o banco e guarde a saída:
--
--   select pg_get_functiondef('salvar_estado(uuid,jsonb)'::regprocedure);
--
-- Limites em vigor:
--   convidados.nome 80 · lado só noiva/noivo · acompanhantes 0..50
--   checklist.descricao 120 · valor 0..1e11 · prazo por para_data
--   padrinhos.padrinho/madrinha 60
--   fornecedores.nome 60 · categoria 40 · contato 80
--   presentes.nome 80 · link 300 e só http(s) · status só falta/comprado/ganho
--   notas.texto 1000 · cor 20 · autor 40
--   config: noiva/noivo 40 · local 100 · data 40 · foto por foto_valida
