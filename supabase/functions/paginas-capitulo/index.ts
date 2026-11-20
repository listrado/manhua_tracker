// Edge Function: devolve a lista de URLs das imagens de um capítulo.
//
//   GET /functions/v1/paginas-capitulo?capitulo_id=123
//   -> { "capitulo_id": 123, "paginas": ["https://...", ...] }
//
// Devolve só texto (JSON): a imagem em si nunca passa por aqui.
//
// Não é um proxy aberto: o chamador informa apenas o id de um capítulo; o
// endereço a buscar sai do banco (capitulos_fonte), nunca do pedido.
//
// Versão sem login: a função lê o banco com a mesma chave pública que o app
// mandou (a leitura do schema manhua é aberta) e não grava nada. O cache em
// capitulos_fonte.paginas, que exige escrita, entra junto com o login.
import { criarAdaptador } from '../_shared/adaptadores/indice.ts'
import { ErroDesafioCloudflare, type Adaptador, type Http } from '../_shared/adaptadores/tipos.ts'

// Só o app publicado e o ambiente local podem chamar pelo navegador.
const ORIGENS_PERMITIDAS = ['https://listrado.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

type Site = { slug: string; dominios: string[]; adaptador: string; precisa_proxy: boolean }
type LinhaFonte = { url: string; fontes: { prioridade: number; ativa: boolean; sites: Site } }

function cabecalhosCors(origem: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origem && ORIGENS_PERMITIDAS.includes(origem) ? origem : ORIGENS_PERMITIDAS[0],
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  }
}

// Acesso aos sites de origem: User-Agent de navegador e Referer do próprio site.
const http: Http = async (url, pedido = {}) => {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' }
  if (pedido.referer) headers.Referer = pedido.referer
  if (pedido.ajax) headers['X-Requested-With'] = 'XMLHttpRequest'

  const resposta = await fetch(url, { method: pedido.metodo ?? 'GET', headers, signal: AbortSignal.timeout(20_000) })
  const corpo = await resposta.text()
  if (!resposta.ok && resposta.status !== 403) throw new Error(`HTTP ${resposta.status} em ${url}`)
  return corpo
}

// Monta o endereço de cada imagem passando pelo proxy (Cloudflare Worker), já
// assinado. O Worker só atende endereço com assinatura válida, então é aqui —
// e só aqui — que se decide o que pode passar por ele.
async function assinarParaProxy(slug: string, paginas: string[]): Promise<string[] | null> {
  const segredo = Deno.env.get('PROXY_SEGREDO')
  const proxy = Deno.env.get('PROXY_URL')
  if (!segredo || !proxy) return null

  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

  return Promise.all(
    paginas.map(async (url) => {
      // HMAC-SHA256 de "<slug>\n<url>", em hexadecimal
      const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${slug}\n${url}`)))
      const assinatura = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
      return `${proxy}/img?u=${encodeURIComponent(url)}&s=${encodeURIComponent(slug)}&t=${assinatura}`
    }),
  )
}

function montarAdaptador(site: Site): Adaptador {
  return criarAdaptador(site, http)
}

Deno.serve(async (pedido) => {
  const cors = cabecalhosCors(pedido.headers.get('origin'))
  const responder = (corpo: unknown, status: number, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { ...cors, ...extra, 'Content-Type': 'application/json; charset=utf-8' },
    })

  // Preflight do navegador
  if (pedido.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (pedido.method !== 'GET') return responder({ erro: 'Só GET' }, 405)

  // Valida a entrada: só o id do capítulo, e a chave pública do app
  const capituloId = new URL(pedido.url).searchParams.get('capitulo_id') ?? ''
  const chave = pedido.headers.get('apikey')
  if (!/^\d+$/.test(capituloId)) return responder({ erro: 'Informe capitulo_id' }, 400)
  if (!chave) return responder({ erro: 'Chave da API ausente' }, 401)

  // Busca no banco em quais fontes esse capítulo existe
  const consulta = `capitulo_id=eq.${capituloId}&select=url,fontes!inner(prioridade,ativa,sites!inner(slug,dominios,adaptador,precisa_proxy))`
  const doBanco = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/capitulos_fonte?${consulta}`, {
    headers: { apikey: chave, 'Accept-Profile': 'manhua' },
  })
  if (!doBanco.ok) return responder({ erro: 'Não foi possível ler o capítulo no banco' }, 502)

  // Fontes ativas que têm este capítulo. Primeiro as que o navegador consegue
  // mostrar direto; as que exigem o proxy de imagem ficam por último, porque
  // sem o proxy as imagens delas não carregam. Dentro de cada grupo, da
  // preferida (menor prioridade = mais atualizada) para a reserva.
  const linhas = ((await doBanco.json()) as LinhaFonte[])
    .filter((l) => l.fontes.ativa)
    .sort(
      (a, b) =>
        Number(a.fontes.sites.precisa_proxy) - Number(b.fontes.sites.precisa_proxy) || a.fontes.prioridade - b.fontes.prioridade,
    )
  if (linhas.length === 0) return responder({ erro: 'Capítulo sem fonte ativa' }, 404)

  // Tenta cada fonte; a primeira que devolver imagens vence
  const falhas: string[] = []
  for (const linha of linhas) {
    try {
      const paginas = await montarAdaptador(linha.fontes.sites).listarPaginas(linha.url)
      if (paginas.length > 0) {
        // A lista de um capítulo publicado não muda: o navegador guarda por um dia
        // paginas: endereço direto no site de origem.
        // paginas_proxy: o mesmo, passando pelo proxy (para site que exige
        // Referer e para guardar a imagem no aparelho).
        const site = linha.fontes.sites
        return responder(
          {
            capitulo_id: Number(capituloId),
            paginas,
            paginas_proxy: await assinarParaProxy(site.slug, paginas),
            site: site.slug,
            precisa_proxy: site.precisa_proxy,
          },
          200,
          { 'Cache-Control': 'public, max-age=86400' },
        )
      }
      falhas.push(`${linha.fontes.sites.slug}: sem imagens`)
    } catch (erro) {
      // Desafio do Cloudflare não é burlado: registra e segue para a próxima fonte
      const motivo = erro instanceof ErroDesafioCloudflare ? 'bloqueado pelo Cloudflare' : erro instanceof Error ? erro.message : String(erro)
      falhas.push(`${linha.fontes.sites.slug}: ${motivo}`)
    }
  }

  return responder({ erro: 'Nenhuma fonte devolveu as imagens', falhas }, 502)
})
