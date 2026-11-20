-- Mais três sites, com dois adaptadores novos:
--   manganato   -> motor próprio (o Manganelo foi absorvido por ele)
--   kingofshojo -> tema Themesia
--   arenascans  -> tema Themesia
--
-- precisa_proxy: as imagens do site só carregam com o Referer dele. O leitor do
-- app (que carrega a imagem direto no navegador) não consegue mandar esse
-- cabeçalho; só o proxy de imagem consegue. Enquanto o proxy não existir, uma
-- fonte assim serve para saber os capítulos e o que saiu de novo, mas o leitor
-- prefere outra fonte para mostrar as imagens.
alter table manhua.sites add column if not exists precisa_proxy boolean not null default false;

insert into manhua.sites (slug, nome, dominios, adaptador, referer, intervalo_ms, precisa_proxy) values
  ('manganato',   'Manganato',   array['www.manganato.gg'], 'manganato', 'https://www.manganato.gg/', 2500, true),
  ('kingofshojo', 'Kingofshojo', array['kingofshojo.com'],  'themesia',  'https://kingofshojo.com/',  2500, false),
  ('arenascans',  'Arenascans',  array['arenascan.com'],    'themesia',  'https://arenascan.com/',    2500, false)
on conflict (slug) do nothing;

-- O lote da verificação passa a informar o slug do site junto do motor
-- (já informava; nada muda na assinatura). Nenhuma função precisa mudar aqui.
