-- Destaque "hot": quando o leitor já tinha alcançado o último capítulo de uma
-- obra e sai capítulo novo, a obra fica no topo da biblioteca por uma semana.
-- quente_ate guarda até quando; passou dessa data, o destaque some sozinho.
--
-- É uma coluna separada de tem_novo porque tem_novo volta a falso assim que a
-- obra é lida, e o destaque deve durar a semana inteira.
alter table manhua.obras add column if not exists quente_ate timestamptz;

-- Registra a chegada de capítulos novos numa obra. Chamada por quem sincroniza
-- (script local hoje, verificar-novos depois) DEPOIS de inserir os capítulos,
-- informando o maior número que a fonte tem agora.
create or replace function manhua.registrar_lancamento(p_obra_id bigint, p_ultimo numeric)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_total  numeric;
  v_atual  numeric;
begin
  select total_capitulos, capitulo_atual into v_total, v_atual from manhua.obras where id = p_obra_id;

  -- Primeira carga da obra: não é lançamento, só preenche o total
  if v_total is null or v_total = 0 then
    update manhua.obras set total_capitulos = p_ultimo where id = p_obra_id;
    return;
  end if;

  -- Nada novo
  if p_ultimo is null or p_ultimo <= v_total then
    return;
  end if;

  -- Saiu capítulo novo. Se o leitor estava em dia (tinha lido até o último),
  -- a obra fica em destaque por 7 dias
  update manhua.obras
     set total_capitulos = p_ultimo,
         ultimo_lancamento_em = now(),
         tem_novo = true,
         quente_ate = case when v_atual is not null and v_atual >= v_total then now() + interval '7 days' else quente_ate end
   where id = p_obra_id;
end;
$$;

revoke execute on function manhua.registrar_lancamento(bigint, numeric) from public, anon, authenticated;
grant execute on function manhua.registrar_lancamento(bigint, numeric) to service_role;
