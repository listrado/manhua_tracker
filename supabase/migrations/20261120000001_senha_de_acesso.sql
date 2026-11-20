-- =============================================================================
-- Senha de acesso (decisão do dono em 2026-11-20): em vez de login com conta,
-- o app pede uma senha curta. Quem confere a senha é o BANCO, não a página:
--   * a senha fica guardada só como hash, numa tabela que anon não lê;
--   * toda gravação passa por uma função que recebe a senha e a confere;
--   * a leitura continua aberta (migração 20261119000002).
--
-- A senha NÃO está neste arquivo nem no repositório (ele é público). Ela é
-- definida uma vez com o comando do fim deste arquivo, direto no SQL Editor.
-- =============================================================================

-- Uma linha só, com o hash da senha.
create table manhua.acesso (
  id          integer primary key default 1 check (id = 1),
  senha_hash  text not null
);

-- Tentativas erradas, para travar adivinhação.
create table manhua.acesso_tentativas (
  id  bigint generated always as identity primary key,
  em  timestamptz not null default now()
);

-- RLS ligada e sem policy: nem anon nem authenticated leem ou escrevem aqui.
alter table manhua.acesso            enable row level security;
alter table manhua.acesso_tentativas enable row level security;
revoke all on manhua.acesso, manhua.acesso_tentativas from public, anon, authenticated;

-- Confere a senha. Uma senha curta tem poucas combinações, então depois de 10
-- erros em 15 minutos a função recusa TUDO (até a senha certa) até a janela passar.
create function manhua.senha_confere(p_senha text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash    text;
  v_erros   integer;
begin
  -- Trava por excesso de erros recentes
  select count(*) into v_erros
    from manhua.acesso_tentativas
   where em > now() - interval '15 minutes';

  if v_erros >= 10 then
    raise exception 'Muitas tentativas erradas. Tente de novo em 15 minutos.' using errcode = 'P0001';
  end if;

  -- Compara com o hash guardado
  select senha_hash into v_hash from manhua.acesso where id = 1;

  if v_hash is not null and p_senha is not null and extensions.crypt(p_senha, v_hash) = v_hash then
    return true;
  end if;

  -- Errou: registra a tentativa
  insert into manhua.acesso_tentativas default values;
  return false;
end;
$$;

-- Marca (ou desmarca) um capítulo como lido. O gatilho de capitulos recalcula
-- o capitulo_atual da obra. p_em é o momento em que o usuário marcou no
-- aparelho: na sincronização vence o mais recente.
create function manhua.marcar_lido(p_senha text, p_capitulo_id bigint, p_lido boolean, p_em timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra_id bigint;
begin
  if not manhua.senha_confere(p_senha) then
    raise exception 'Senha incorreta.' using errcode = '28P01';
  end if;

  -- Só grava se esta marcação for mais recente que a que já está no banco
  update manhua.capitulos
     set lido = p_lido,
         lido_em = case when p_lido then p_em else null end,
         atualizado_em = p_em
   where id = p_capitulo_id
     and atualizado_em <= p_em
  returning obra_id into v_obra_id;

  -- Abrir e ler a obra tira o selo "novo"
  if v_obra_id is not null then
    update manhua.obras set ultima_leitura_em = p_em, tem_novo = false where id = v_obra_id;
  end if;
end;
$$;

-- O app (papel anon) pode chamar as duas funções; quem protege é a senha.
revoke execute on function manhua.senha_confere(text) from public;
revoke execute on function manhua.marcar_lido(text, bigint, boolean, timestamptz) from public;
grant execute on function manhua.senha_confere(text) to anon, authenticated;
grant execute on function manhua.marcar_lido(text, bigint, boolean, timestamptz) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- DEFINIR OU TROCAR A SENHA (rodar à mão, trocando NOVA_SENHA; não versionar):
--
--   insert into manhua.acesso (id, senha_hash)
--   values (1, extensions.crypt('NOVA_SENHA', extensions.gen_salt('bf')))
--   on conflict (id) do update set senha_hash = excluded.senha_hash;
--
--   delete from manhua.acesso_tentativas;   -- destrava, se estiver travado
-- -----------------------------------------------------------------------------
