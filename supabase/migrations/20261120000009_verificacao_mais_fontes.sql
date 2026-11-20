-- Com cinco sites, a verificação passou de ~140 para ~770 fontes por rodada.
-- Duas mudanças para dar conta:
--
-- 1. O lote passa a ser "reservado": ao entregar as fontes, a função já marca
--    verificado_em = agora. Assim duas chamadas que se sobreponham nunca pegam
--    a mesma fonte (e nunca pedem a mesma página ao site duas vezes).
--
-- 2. A janela do agendamento cresce de 1 para 3 horas: a cada 2 minutos, das
--    00h às 03h e das 12h às 15h de Brasília (03-05h e 15-17h UTC). São 90
--    chamadas de 12 fontes = 1080 por rodada. Quando acaba o trabalho, as
--    chamadas seguintes não acham nada e saem na hora.
create or replace function manhua.verificacao_lote(p_segredo text, p_lote integer default 12)
returns table (fonte_id bigint, obra_id bigint, url_obra text, site_slug text, dominios text[], adaptador text, intervalo_ms integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not manhua.segredo_interno_confere(p_segredo) then
    raise exception 'Segredo inválido.' using errcode = '28P01';
  end if;

  return query
  with escolhidas as (
    select f.id
      from manhua.fontes f
      join manhua.obras o on o.id = f.obra_id
      join manhua.sites s on s.id = f.site_id
     where f.ativa
       and s.ativo
       and o.status = 'lendo'
       and (f.verificado_em is null or f.verificado_em < now() - interval '6 hours')
     order by f.verificado_em nulls first, f.id
     limit least(greatest(p_lote, 1), 30)
       for update of f skip locked
  ),
  reservadas as (
    -- Reserva: quem vier depois já não enxerga estas fontes como pendentes
    update manhua.fontes f
       set verificado_em = now()
      from escolhidas e
     where f.id = e.id
    returning f.id, f.obra_id, f.url_obra, f.site_id
  )
  select r.id, r.obra_id, r.url_obra, s.slug, s.dominios, s.adaptador, s.intervalo_ms
    from reservadas r
    join manhua.sites s on s.id = r.site_id;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'manhua-verificar-novos';

select cron.schedule(
  'manhua-verificar-novos',
  '*/2 3-5,15-17 * * *',
  $cron$
  select net.http_post(
    url := 'https://rrtrcgfrttaydevxktpl.supabase.co/functions/v1/verificar-novos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-segredo', (select valor from manhua.config_interna where chave = 'segredo_verificacao')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $cron$
);
