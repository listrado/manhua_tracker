-- =============================================================================
-- Fase 1 — base do banco: extensões, dono, tabelas, gatilhos, RLS e grants.
-- O projeto Supabase é COMPARTILHADO com outros sistemas, então:
--   * tudo mora no schema próprio "manhua" — nada é criado nem alterado no public;
--   * auth.users é de todos os sistemas: estar logado não basta, a tabela
--     manhua.dono é a allowlist e toda policy passa por manhua.eh_dono().
-- =============================================================================

create schema if not exists manhua;

-- -----------------------------------------------------------------------------
-- Extensões
-- -----------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- -----------------------------------------------------------------------------
-- Dono: a única conta que pode ler e escrever (allowlist deste sistema).
-- auth.users tem os usuários de todos os outros sites do projeto; nenhum deles
-- passa em eh_dono(), só quem estiver nesta tabela.
-- -----------------------------------------------------------------------------
create table manhua.dono (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create function manhua.eh_dono()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from manhua.dono where user_id = (select auth.uid())
  );
$$;

-- -----------------------------------------------------------------------------
-- Normalização de título: minúsculas, sem acento, aspas curvas viram retas,
-- sem pontuação, espaços colapsados. Usada na busca e para juntar duplicadas.
-- -----------------------------------------------------------------------------
create function manhua.normalizar_titulo(titulo text)
returns text
language sql
stable
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        extensions.unaccent(
          lower(translate(titulo, '‘’“”', '''''""'))
        ),
        '[^a-z0-9 ]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

-- Cadastro de cada site de origem. O domínio fica aqui, nunca fixo no código.
create table manhua.sites (
  id            bigint generated always as identity primary key,
  slug          text not null unique,
  nome          text not null,
  dominios      text[] not null default '{}',
  adaptador     text not null,
  referer       text,
  ativo         boolean not null default true,
  intervalo_ms  integer not null default 2500
);

-- Uma linha por obra, independente do site.
create table manhua.obras (
  id                    bigint generated always as identity primary key,
  titulo                text not null,
  titulo_normalizado    text not null default '',
  titulos_alternativos  text[] not null default '{}',
  capa_path             text,
  status                text not null default 'nao_iniciada'
                        check (status in ('lendo', 'nao_iniciada', 'pausada', 'concluida')),
  capitulo_atual        numeric,
  total_capitulos       numeric,
  tem_novo              boolean not null default false,
  ultimo_lancamento_em  timestamptz,
  ultima_leitura_em     timestamptz,
  limite_download_mb    integer not null default 2000,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);

create index obras_titulo_normalizado_trgm
  on manhua.obras using gin (titulo_normalizado extensions.gin_trgm_ops);
create index obras_status on manhua.obras (status);

-- Ligação obra + site, com o link da obra naquele site.
-- prioridade: menor número é a fonte preferida.
create table manhua.fontes (
  id               bigint generated always as identity primary key,
  obra_id          bigint not null references manhua.obras (id) on delete cascade,
  site_id          bigint not null references manhua.sites (id) on delete restrict,
  url_obra         text not null,
  prioridade       integer not null default 1,
  ativa            boolean not null default true,
  ultimo_capitulo  numeric,
  verificado_em    timestamptz,
  erro_ultimo      text,
  unique (obra_id, site_id)
);

-- Capítulos da obra e o estado de leitura.
-- numero é numeric porque existem capítulos como 118.5 e 1.1.
-- atualizado_em é gravado pelo app: na sincronização vence o mais recente.
create table manhua.capitulos (
  id             bigint generated always as identity primary key,
  obra_id        bigint not null references manhua.obras (id) on delete cascade,
  numero         numeric not null,
  titulo         text,
  lido           boolean not null default false,
  lido_em        timestamptz,
  atualizado_em  timestamptz not null default now(),
  unique (obra_id, numero)
);

-- Link do capítulo em cada fonte e a lista de imagens (cache).
create table manhua.capitulos_fonte (
  capitulo_id  bigint not null references manhua.capitulos (id) on delete cascade,
  fonte_id     bigint not null references manhua.fontes (id) on delete cascade,
  url          text not null,
  paginas      jsonb,
  paginas_em   timestamptz,
  primary key (capitulo_id, fonte_id)
);

-- Fila "Confirmar": resultados de busca em que o sistema não teve certeza.
create table manhua.candidatos (
  id                 bigint generated always as identity primary key,
  obra_id            bigint not null references manhua.obras (id) on delete cascade,
  site_id            bigint not null references manhua.sites (id) on delete cascade,
  titulo_encontrado  text not null,
  url                text not null,
  capa_url           text,
  score              real not null,
  estado             text not null default 'pendente'
                     check (estado in ('pendente', 'aceito', 'recusado')),
  unique (obra_id, site_id, url)
);

create index candidatos_estado on manhua.candidatos (estado);

-- Linhas brutas da lista inicial de abas, para auditoria.
-- linha_numero é a posição da linha no arquivo: permite rodar o script
-- de importação mais de uma vez sem duplicar.
create table manhua.importacao (
  id               bigint generated always as identity primary key,
  linha_numero     integer not null unique,
  linha_original   text not null,
  titulo_extraido  text,
  capitulo         numeric,
  site_slug        text,
  descartada       boolean not null default false,
  motivo           text,
  obra_id          bigint references manhua.obras (id) on delete set null
);

-- Preferências do usuário.
create table manhua.configuracoes (
  chave  text primary key,
  valor  jsonb not null
);

-- Inscrições de Web Push.
create table manhua.push_subscriptions (
  id         bigint generated always as identity primary key,
  endpoint   text not null unique,
  chaves     jsonb not null,
  criado_em  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Gatilhos
-- -----------------------------------------------------------------------------

-- Mantém titulo_normalizado e atualizado_em da obra.
create function manhua.obras_antes_de_gravar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.titulo_normalizado := manhua.normalizar_titulo(new.titulo);
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger obras_antes_de_gravar
  before insert or update on manhua.obras
  for each row execute function manhua.obras_antes_de_gravar();

-- capitulo_atual é o maior número de capítulo marcado como lido.
-- Só recalcula quando o campo lido MUDA (marcar ou desmarcar). Inserir capítulos
-- novos não mexe nele: a importação define capitulo_atual antes de os capítulos
-- existirem, e a fonte pode não ter exatamente aquele número.
create function manhua.capitulos_recalcular_atual()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update manhua.obras
     set capitulo_atual = (
           select max(numero) from manhua.capitulos
            where obra_id = new.obra_id and lido
         )
   where id = new.obra_id;
  return null;
end;
$$;

create trigger capitulos_recalcular_atual
  after update of lido on manhua.capitulos
  for each row
  when (old.lido is distinct from new.lido)
  execute function manhua.capitulos_recalcular_atual();

-- -----------------------------------------------------------------------------
-- RLS: ligada em todas as tabelas. Só o dono lê e escreve.
-- A tabela dono fica sem policy: só service_role e o SQL Editor mexem nela.
-- -----------------------------------------------------------------------------
alter table manhua.dono               enable row level security;
alter table manhua.sites              enable row level security;
alter table manhua.obras              enable row level security;
alter table manhua.fontes             enable row level security;
alter table manhua.capitulos          enable row level security;
alter table manhua.capitulos_fonte    enable row level security;
alter table manhua.candidatos         enable row level security;
alter table manhua.importacao         enable row level security;
alter table manhua.configuracoes      enable row level security;
alter table manhua.push_subscriptions enable row level security;

create policy dono_total on manhua.sites
  for all to authenticated using (manhua.eh_dono()) with check (manhua.eh_dono());
create policy dono_total on manhua.obras
  for all to authenticated using (manhua.eh_dono()) with check (manhua.eh_dono());
create policy dono_total on manhua.fontes
  for all to authenticated using (manhua.eh_dono()) with check (manhua.eh_dono());
create policy dono_total on manhua.capitulos
  for all to authenticated using (manhua.eh_dono()) with check (manhua.eh_dono());
create policy dono_total on manhua.capitulos_fonte
  for all to authenticated using (manhua.eh_dono()) with check (manhua.eh_dono());
create policy dono_total on manhua.candidatos
  for all to authenticated using (manhua.eh_dono()) with check (manhua.eh_dono());
create policy dono_total on manhua.importacao
  for all to authenticated using (manhua.eh_dono()) with check (manhua.eh_dono());
create policy dono_total on manhua.configuracoes
  for all to authenticated using (manhua.eh_dono()) with check (manhua.eh_dono());
create policy dono_total on manhua.push_subscriptions
  for all to authenticated using (manhua.eh_dono()) with check (manhua.eh_dono());

-- -----------------------------------------------------------------------------
-- Grants. No Postgres a RLS só é avaliada DEPOIS do privilégio de tabela,
-- então: anon não tem privilégio nenhum (a chave anon sem login não lê nada),
-- authenticated tem o privilégio, filtrado pela policy do dono, e service_role
-- (usada só dentro das Edge Functions) tem acesso total.
-- Num schema próprio nenhum papel tem acesso automático: tudo é dado aqui.
-- -----------------------------------------------------------------------------
revoke all on schema manhua from public, anon;
grant usage on schema manhua to authenticated, service_role;

revoke all on all tables in schema manhua from public, anon, authenticated;
grant all on all tables in schema manhua to service_role;

grant select, insert, update, delete on
  manhua.sites,
  manhua.obras,
  manhua.fontes,
  manhua.capitulos,
  manhua.capitulos_fonte,
  manhua.candidatos,
  manhua.importacao,
  manhua.configuracoes,
  manhua.push_subscriptions
to authenticated;

revoke execute on function manhua.eh_dono() from public, anon;
grant execute on function manhua.eh_dono() to authenticated, service_role;

-- Tabelas criadas em migrações futuras: service_role já nasce com acesso;
-- anon e authenticated não ganham nada sozinhos (cada migração dá o grant).
alter default privileges in schema manhua grant all on tables to service_role;

-- -----------------------------------------------------------------------------
-- Storage: bucket das capas em miniatura (alvo: até 60 KB cada).
-- Leitura pública (capa não é dado sensível e o <img> carrega direto);
-- escrita só pela service_role, dentro da Edge Function salvar-capa.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manhua-capas', 'manhua-capas', true, 204800, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
