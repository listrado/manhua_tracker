-- Uma obra pode estar em vários sites, e eles não andam juntos: é comum um
-- estar dezenas de capítulos atrás do outro. Regra (pedido do dono):
-- a fonte preferida é sempre a MAIS ATUALIZADA.
--
-- prioridade 1 = fonte preferida. Sempre que o último capítulo de uma fonte
-- muda, as fontes daquela obra são reordenadas: primeiro quem tem o capítulo
-- mais alto. Fonte desligada (ativa = false) vai para o fim.
--
-- Os capítulos continuam sendo a união de todas as fontes: se a preferida não
-- tiver um capítulo antigo, o leitor busca na próxima.
create or replace function manhua.fontes_reordenar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update manhua.fontes f
     set prioridade = r.posicao
    from (
      select id, row_number() over (order by ativa desc, ultimo_capitulo desc nulls last, id) as posicao
        from manhua.fontes
       where obra_id = new.obra_id
    ) r
   where f.id = r.id
     and f.prioridade is distinct from r.posicao;

  return null;
end;
$$;

drop trigger if exists fontes_reordenar on manhua.fontes;

-- Só dispara quando muda o que decide a ordem; a própria reordenação mexe
-- apenas em prioridade, então não dispara de novo.
create trigger fontes_reordenar
  after insert or update of ultimo_capitulo, ativa on manhua.fontes
  for each row execute function manhua.fontes_reordenar();
