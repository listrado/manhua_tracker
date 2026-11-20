-- O capitulo_atual de uma obra pode ser MAIOR que qualquer capítulo cadastrado:
-- a importação tirou o número do título da aba, e a fonte vinculada pode ter
-- menos capítulos (ex.: aba no 176, site com 137). A regra antiga recalculava
-- pelo maior capítulo lido existente e jogaria esse progresso fora na primeira
-- marcação. Regra nova:
--   * marcou como lido  -> capitulo_atual só sobe (maior entre o atual e o marcado);
--   * desmarcou         -> só recalcula se o desmarcado ERA o capítulo atual.
create or replace function manhua.capitulos_recalcular_atual()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lido then
    update manhua.obras
       set capitulo_atual = greatest(coalesce(capitulo_atual, new.numero), new.numero)
     where id = new.obra_id;
  else
    update manhua.obras
       set capitulo_atual = (
             select max(numero) from manhua.capitulos
              where obra_id = new.obra_id and lido
           )
     where id = new.obra_id
       and capitulo_atual = new.numero;
  end if;

  return null;
end;
$$;
