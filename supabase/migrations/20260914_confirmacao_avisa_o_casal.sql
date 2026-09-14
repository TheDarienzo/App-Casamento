-- A confirmação de presença feita pelo convidado não mexia em
-- casamentos.atualizado_em, então o app dos noivos (que compara esse
-- carimbo para saber se há novidade) só via a resposta depois de alguma
-- outra gravação. Agora a confirmação avança o carimbo e devolve o id do
-- casal — que a Edge Function usa só para avisar os aparelhos dos noivos
-- em tempo real, sem repassar ao convidado.

create or replace function convite_confirmar(p_codigo text, p_vai boolean, p_pessoas integer, p_recado text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare g record;
begin
  select c.* into g from convidados c join convite v on v.casal_id = c.casal_id
   where c.codigo = lower(trim(p_codigo)) and c.apagado_em is null and v.publicado;
  if not found then
    return jsonb_build_object('erro', 'nao_encontrado');
  end if;

  update convidados set
    confirmado = coalesce(p_vai, false),
    -- não deixa confirmar mais gente do que foi convidado
    pessoas_confirmadas = case when p_vai
      then least(greatest(coalesce(p_pessoas, 1), 1), 1 + g.acompanhantes) else 0 end,
    recado = left(coalesce(p_recado, ''), 500),
    confirmado_em = now()
  where id = g.id;

  -- o app dos noivos descobre a novidade por este carimbo
  update casamentos set atualizado_em = now() where id = g.casal_id;

  return jsonb_build_object('ok', true, 'nome', g.nome, 'casal_id', g.casal_id);
end;
$$;

revoke execute on function convite_confirmar(text, boolean, integer, text) from anon, authenticated, public;
grant execute on function convite_confirmar(text, boolean, integer, text) to service_role;
