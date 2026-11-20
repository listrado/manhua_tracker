-- =============================================================================
-- Verificação automática de capítulos novos, duas vezes por dia.
--
-- Quem lê os sites é a Edge Function verificar-novos. Ela não tem chave de
-- administrador: lê e grava só por duas funções deste arquivo, que exigem um
-- segredo interno. O segredo fica em manhua.config_interna (ninguém lê pela
-- API) e, do outro lado, nos segredos da Edge Function. Ele NÃO está no
-- repositório: é gerado e gravado à parte (ver o fim deste arquivo).
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Configuração interna: só o dono do banco lê. RLS ligada e sem policy.
create table if not exists manhua.config_interna (
  chave  text primary key,
  valor  text not null
);
alter table manhua.config_interna enable row level security;
revoke all on manhua.config_interna from public, anon, authenticated;

-- Fonte que falhar 5 verificações seguidas é desligada (ativa = false).
alter table manhua.fontes add column if not exists falhas_seguidas integer not null default 0;

create or replace function manhua.segredo_interno_confere(p_segredo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from manhua.config_interna
     where chave = 'segredo_verificacao' and valor = p_segredo and length(valor) >= 32
  );
$$;

-- Próximo lote a verificar: fontes ativas de obras em leitura, começando pelas
-- que estão há mais tempo sem verificação. Quem foi verificado nas últimas
-- 6 horas fica de fora — é assim que as execuções seguidas "continuam de onde
-- a anterior parou" e param sozinhas quando todas as obras já passaram.
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
  select f.id, f.obra_id, f.url_obra, s.slug, s.dominios, s.adaptador, s.intervalo_ms
    from manhua.fontes f
    join manhua.obras o on o.id = f.obra_id
    join manhua.sites s on s.id = f.site_id
   where f.ativa
     and s.ativo
     and o.status = 'lendo'
     and (f.verificado_em is null or f.verificado_em < now() - interval '6 hours')
   order by f.verificado_em nulls first, f.id
   limit least(greatest(p_lote, 1), 30);
end;
$$;

-- Registra o resultado da verificação de uma fonte.
--   p_capitulos: [{"n": 12, "t": "Chapter 12", "u": "https://..."}, ...]
--   p_erro: preenchido quando a leitura do site falhou
create or replace function manhua.verificacao_registrar(p_segredo text, p_fonte_id bigint, p_capitulos jsonb, p_erro text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra_id bigint;
  v_ultimo  numeric;
begin
  if not manhua.segredo_interno_confere(p_segredo) then
    raise exception 'Segredo inválido.' using errcode = '28P01';
  end if;

  select obra_id into v_obra_id from manhua.fontes where id = p_fonte_id;
  if v_obra_id is null then
    return;
  end if;

  -- Falhou: conta a falha; na quinta seguida a fonte é desligada
  if p_erro is not null then
    update manhua.fontes
       set erro_ultimo = p_erro,
           verificado_em = now(),
           falhas_seguidas = falhas_seguidas + 1,
           ativa = falhas_seguidas + 1 < 5
     where id = p_fonte_id;
    return;
  end if;

  -- Capítulos que ainda não existem (os que estão até o capítulo atual da obra
  -- entram como lidos; capítulo novo de verdade entra como não lido)
  insert into manhua.capitulos (obra_id, numero, titulo, lido)
  select v_obra_id, (c->>'n')::numeric, c->>'t',
         (c->>'n')::numeric <= coalesce((select capitulo_atual from manhua.obras where id = v_obra_id), -1)
    from jsonb_array_elements(coalesce(p_capitulos, '[]'::jsonb)) c
  on conflict (obra_id, numero) do nothing;

  -- Link de cada capítulo nesta fonte
  insert into manhua.capitulos_fonte (capitulo_id, fonte_id, url)
  select cap.id, p_fonte_id, c->>'u'
    from jsonb_array_elements(coalesce(p_capitulos, '[]'::jsonb)) c
    join manhua.capitulos cap on cap.obra_id = v_obra_id and cap.numero = (c->>'n')::numeric
  on conflict (capitulo_id, fonte_id) do update set url = excluded.url;

  -- Total, selo "novo" e destaque "hot"
  select max((c->>'n')::numeric) into v_ultimo from jsonb_array_elements(coalesce(p_capitulos, '[]'::jsonb)) c;
  perform manhua.registrar_lancamento(v_obra_id, v_ultimo);

  update manhua.fontes
     set ultimo_capitulo = coalesce(v_ultimo, ultimo_capitulo),
         verificado_em = now(),
         erro_ultimo = null,
         falhas_seguidas = 0
   where id = p_fonte_id;
end;
$$;

-- A Edge Function chama pela API com a chave pública (papel anon); quem protege
-- é o segredo. segredo_interno_confere não é chamável de fora.
revoke execute on function manhua.segredo_interno_confere(text) from public, anon, authenticated;
revoke execute on function manhua.verificacao_lote(text, integer) from public;
revoke execute on function manhua.verificacao_registrar(text, bigint, jsonb, text) from public;
grant execute on function manhua.verificacao_lote(text, integer) to anon;
grant execute on function manhua.verificacao_registrar(text, bigint, jsonb, text) to anon;

-- -----------------------------------------------------------------------------
-- Agendamento: meia-noite e meio-dia no horário de Brasília (03h e 15h UTC).
-- Dentro de cada uma dessas duas horas a função é chamada a cada 2 minutos;
-- cada chamada verifica um lote de 12 obras. Com ~200 obras em leitura são
-- cerca de 17 chamadas com trabalho; as demais não acham nada e saem na hora.
-- Esse movimento diário também impede o projeto gratuito de pausar.
-- -----------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'manhua-verificar-novos';

select cron.schedule(
  'manhua-verificar-novos',
  '*/2 3,15 * * *',
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

-- -----------------------------------------------------------------------------
-- SEGREDO (não versionar). Gerar um valor aleatório de 64 caracteres e gravar
-- nos dois lados:
--   1. banco:   insert into manhua.config_interna values ('segredo_verificacao', '<valor>')
--               on conflict (chave) do update set valor = excluded.valor;
--   2. função:  supabase secrets set VERIFICAR_SEGREDO=<valor> MANHUA_CHAVE_PUBLICA=<chave publishable>
-- -----------------------------------------------------------------------------
