-- Fase 3 — cadastro do primeiro site. O domínio fica aqui, nunca fixo no código:
-- se o site trocar de endereço, basta atualizar esta linha.
insert into manhua.sites (slug, nome, dominios, adaptador, referer, intervalo_ms)
values ('manhuaplus', 'ManhuaPlus', array['manhuaplus.org'], 'manhuaplus', 'https://manhuaplus.org/', 2500)
on conflict (slug) do nothing;

-- Uma obra pode ter passado pela busca automática sem achar nada em site nenhum.
-- Fica marcada para o usuário procurar à mão (seção 8 da especificação).
alter table manhua.obras add column if not exists sem_fonte boolean not null default false;
