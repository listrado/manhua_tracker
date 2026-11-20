-- =============================================================================
-- Leitura sem login (decisão do dono em 2026-11-19: "por enquanto sem login").
-- A página abre direto, então o papel anon passa a poder LER o schema manhua.
--
-- O que continua fechado para anon:
--   * qualquer escrita (insert/update/delete) — só o dono logado ou a service_role;
--   * as tabelas dono e push_subscriptions inteiras.
--
-- Para voltar a exigir login, rodar o bloco "DESFAZER" do fim deste arquivo.
-- =============================================================================

grant usage on schema manhua to anon;

grant select on
  manhua.sites,
  manhua.obras,
  manhua.fontes,
  manhua.capitulos,
  manhua.capitulos_fonte,
  manhua.candidatos,
  manhua.importacao,
  manhua.configuracoes
to anon;

create policy leitura_aberta on manhua.sites           for select to anon using (true);
create policy leitura_aberta on manhua.obras           for select to anon using (true);
create policy leitura_aberta on manhua.fontes          for select to anon using (true);
create policy leitura_aberta on manhua.capitulos       for select to anon using (true);
create policy leitura_aberta on manhua.capitulos_fonte for select to anon using (true);
create policy leitura_aberta on manhua.candidatos      for select to anon using (true);
create policy leitura_aberta on manhua.importacao      for select to anon using (true);
create policy leitura_aberta on manhua.configuracoes   for select to anon using (true);

-- -----------------------------------------------------------------------------
-- DESFAZER (não roda sozinho; copiar para o SQL Editor quando o login voltar):
--
--   drop policy leitura_aberta on manhua.sites;
--   drop policy leitura_aberta on manhua.obras;
--   drop policy leitura_aberta on manhua.fontes;
--   drop policy leitura_aberta on manhua.capitulos;
--   drop policy leitura_aberta on manhua.capitulos_fonte;
--   drop policy leitura_aberta on manhua.candidatos;
--   drop policy leitura_aberta on manhua.importacao;
--   drop policy leitura_aberta on manhua.configuracoes;
--   revoke all on all tables in schema manhua from anon;
--   revoke usage on schema manhua from anon;
-- -----------------------------------------------------------------------------
