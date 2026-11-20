-- Junta duas obras que são a mesma (nomes diferentes da mesma história).
-- p_fica absorve p_sai:
--   * abas importadas e candidatos passam para a que fica;
--   * capítulos: número que só a absorvida tinha é movido; número que as duas
--     tinham fica um só, lido se estava lido em qualquer uma;
--   * fontes: site que só a absorvida tinha é movido; se as duas tinham fonte
--     no mesmo site, fica a da obra que permanece;
--   * a que fica herda o nome (como alternativo), o maior capítulo atual, o
--     maior total, a capa (se não tinha) e o status "lendo" se alguma lia.
-- Só o dono do banco chama (migrações e scripts); não é exposta ao app.
create or replace function manhua.juntar_obras(p_fica bigint, p_sai bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_sai manhua.obras%rowtype;
begin
  if p_fica = p_sai then
    return;
  end if;

  select * into v_sai from manhua.obras where id = p_sai;
  if not found or not exists (select 1 from manhua.obras where id = p_fica) then
    return;
  end if;

  -- Abas importadas
  update manhua.importacao set obra_id = p_fica where obra_id = p_sai;

  -- Candidatos: move os que não repetem; o resto some com a obra
  update manhua.candidatos c set obra_id = p_fica
   where c.obra_id = p_sai
     and not exists (
       select 1 from manhua.candidatos x where x.obra_id = p_fica and x.site_id = c.site_id and x.url = c.url
     );

  -- Fontes: move as de sites que a obra que fica ainda não tem.
  -- As outras são apagadas junto com a obra absorvida (e os links de capítulo delas).
  update manhua.fontes f set obra_id = p_fica
   where f.obra_id = p_sai
     and not exists (select 1 from manhua.fontes x where x.obra_id = p_fica and x.site_id = f.site_id);

  -- Capítulos que as duas têm: o da que fica herda o "lido"
  update manhua.capitulos k
     set lido = true,
         lido_em = coalesce(k.lido_em, s.lido_em)
    from manhua.capitulos s
   where k.obra_id = p_fica and s.obra_id = p_sai and s.numero = k.numero
     and s.lido and not k.lido;

  -- ...e herda os links de capítulo das fontes que foram movidas
  insert into manhua.capitulos_fonte (capitulo_id, fonte_id, url, paginas, paginas_em)
  select k.id, cf.fonte_id, cf.url, cf.paginas, cf.paginas_em
    from manhua.capitulos s
    join manhua.capitulos k on k.obra_id = p_fica and k.numero = s.numero
    join manhua.capitulos_fonte cf on cf.capitulo_id = s.id
    join manhua.fontes f on f.id = cf.fonte_id and f.obra_id = p_fica
   where s.obra_id = p_sai
  on conflict (capitulo_id, fonte_id) do nothing;

  -- Capítulos que só a absorvida tinha: passam para a que fica
  update manhua.capitulos s set obra_id = p_fica
   where s.obra_id = p_sai
     and not exists (select 1 from manhua.capitulos k where k.obra_id = p_fica and k.numero = s.numero);

  -- A obra que fica herda os dados da absorvida
  update manhua.obras o
     set titulos_alternativos = (
           select coalesce(array_agg(distinct nome), '{}')
             from unnest(o.titulos_alternativos || v_sai.titulo || v_sai.titulos_alternativos) as nome
            where nome <> o.titulo
         ),
         capitulo_atual = nullif(greatest(coalesce(o.capitulo_atual, -1), coalesce(v_sai.capitulo_atual, -1)), -1),
         total_capitulos = nullif(greatest(coalesce(o.total_capitulos, -1), coalesce(v_sai.total_capitulos, -1)), -1),
         capa_path = coalesce(o.capa_path, v_sai.capa_path),
         status = case when 'lendo' in (o.status, v_sai.status) then 'lendo' else o.status end,
         ultima_leitura_em = greatest(o.ultima_leitura_em, v_sai.ultima_leitura_em)
   where o.id = p_fica;

  -- Apaga a absorvida: leva junto os capítulos repetidos e as fontes que sobraram
  delete from manhua.obras where id = p_sai;
end;
$$;

revoke execute on function manhua.juntar_obras(bigint, bigint) from public, anon, authenticated;
