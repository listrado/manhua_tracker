-- Manhua Top (manhuatop.org). Nos títulos das abas aparece como
-- "Manhwa Manhua Top", "Top Manhua" e "Manhua Top"; o slug é o mesmo que a
-- importação gravou. As imagens carregam direto no navegador.
insert into manhua.sites (slug, nome, dominios, adaptador, referer, intervalo_ms, precisa_proxy)
values ('manhwa-manhua-top', 'Manhua Top', array['manhuatop.org'], 'manhuatop', 'https://manhuatop.org/', 2500, false)
on conflict (slug) do nothing;
