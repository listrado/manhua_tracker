# manhua_tracker

Leitor pessoal de mangás e manhuas: um PWA de um usuário só, feito para o iPhone.
Guarda a biblioteca, acha os links das obras nos sites, baixa a obra aberta para o
aparelho e lê offline.

Estado atual: **fase 1 (base)** — banco, RLS, login e deploy do app vazio.

## Peças

| Pasta | O que é |
| --- | --- |
| `app/` | Front em React + TypeScript + Vite, publicado no GitHub Pages |
| `supabase/migrations/` | SQL versionado (tabelas, RLS, gatilhos) |
| `supabase/functions/` | Edge Functions e adaptadores de site (a partir da fase 3) |
| `worker/` | Cloudflare Worker do proxy de imagem (fase 5) |
| `scripts/` | Importação da lista de abas e utilitários (fase 2) |
| `dados/` | `abas.txt` e relatórios. Fica fora do git: o repositório é público |

## Configuração

### 1. Supabase

O banco fica num projeto Supabase **compartilhado** com outros sistemas
(`rrtrcgfrttaydevxktpl`), isolado no schema `manhua`. Nada deste projeto toca o `public`.

1. Aplique cada migração nova direto no banco. Não use `supabase db push`: o projeto
   compartilhado não tem histórico de migrações da CLI.
   ```sh
   supabase link --project-ref rrtrcgfrttaydevxktpl
   supabase db query --linked -f supabase/migrations/<arquivo>.sql
   ```
2. No painel, em **Project Settings > Data API > Exposed schemas**, adicione `manhua`.
3. Em **Project Settings > API Keys**, crie uma chave *publishable* para este sistema.
   É ela que vai em `VITE_SUPABASE_ANON_KEY` (as chaves antigas "anon" estão desativadas).
4. Em **Authentication > Users**, crie o seu usuário (e-mail e senha, com *Auto Confirm User*)
   ou use um que já exista.
5. No **SQL Editor**, rode `supabase/definir-dono.sql` trocando o e-mail. Sem isso o
   login funciona, mas nenhuma tabela responde: `auth.users` é de todos os sistemas do
   projeto e só quem está em `manhua.dono` acessa este.

### 2. App local

```sh
cd app
cp .env.example .env   # preencha a URL e a chave anon do projeto
npm install
npm run dev
```

### 3. GitHub Pages

1. Em **Settings > Pages**, escolha *Source: GitHub Actions*.
2. Em **Settings > Secrets and variables > Actions > Variables**, crie
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Cada push na `main` que mexa em `app/` publica em
   `https://listrado.github.io/manhua_tracker/`.

### 4. Cloudflare Worker e instalação no iPhone

Entram nas fases 5 e 6.

## Para depois

Pedidos do dono que ficaram anotados, ainda sem implementação:

- **Filtro por gênero** na biblioteca. Os sites listam os gêneros de cada obra; falta
  o adaptador ler esse dado e o banco guardar.
- **Recomendações**: sugerir obras ainda não lidas, parecidas com as que já são lidas
  (os sites têm seção de recomendados e os gêneros ajudam a medir semelhança).
- **Leitura offline**: o proxy de imagem já existe (`worker/`); falta o download
  para o aparelho (IndexedDB), o leitor ler de lá e o app instalável (PWA).
- **Tela "Confirmar"**: os resultados de busca em dúvida ficam na tabela `candidatos`,
  ainda sem tela para aceitar ou recusar.
- **Adaptadores que faltam**: MANHWATOP, Vortex Scans, Asura, Kayn Scans, Roliascan,
  ManhwaGalaxy, MangaFox e MangaDex.

Sites que não dá para usar: MANHUAFAST, MANHUAUS, Manhwa Clan e ToonGod respondem com
o desafio do Cloudflare (não é burlado); Bato.to fechou; Thunderscans e Webtoonscan
saíram do ar.

## Segurança

- O site e a chave anon são públicos. Quem protege os dados é a RLS: todas as tabelas
  só respondem para o usuário cadastrado na tabela `dono`.
- `service_role`, segredo HMAC do Worker, chaves VAPID e credenciais da Z-API nunca
  entram no repositório nem no front.
