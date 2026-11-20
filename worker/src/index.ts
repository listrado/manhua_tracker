// Cloudflare Worker: proxy de imagem.
//
//   GET /img?u=<URL da imagem>&s=<slug do site>&t=<assinatura>
//
// Busca a imagem no site de origem (mandando o Referer que o site exige) e
// devolve o mesmo corpo com cabeçalhos CORS. Serve para duas coisas que o
// navegador sozinho não consegue: mostrar imagens de site que exige Referer e
// guardar imagens no aparelho para ler offline.
//
// NÃO é um proxy aberto:
//   * só atende endereço assinado (HMAC) — quem assina é a Edge Function
//     paginas-capitulo, com um segredo que só ela e este Worker conhecem;
//   * só busca em domínios de imagem conhecidos do site informado.
//
// O corpo é repassado em stream, sem transformar: o plano gratuito dá 10 ms de
// CPU por chamada.

export interface Env {
  // Segredo do HMAC (wrangler secret put PROXY_SEGREDO)
  PROXY_SEGREDO: string
  // Origens que podem usar o proxy pelo navegador, separadas por vírgula
  ORIGENS_PERMITIDAS: string
  // JSON: slug do site -> { referer, dominios: [sufixos de domínio de imagem aceitos] }
  SITES: string
}

type ConfigSite = { referer: string; dominios: string[] }

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

function cabecalhosCors(pedido: Request, env: Env): Record<string, string> {
  const permitidas = env.ORIGENS_PERMITIDAS.split(',').map((o) => o.trim())
  const origem = pedido.headers.get('Origin') ?? ''

  return {
    'Access-Control-Allow-Origin': permitidas.includes(origem) ? origem : permitidas[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function erro(status: number, mensagem: string, cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ erro: mensagem }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

// Confere a assinatura. A verificação é feita pela própria Web Crypto, em tempo constante.
async function assinaturaValida(segredo: string, slug: string, url: string, assinatura: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(assinatura)) return false

  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const bytes = new Uint8Array(assinatura.match(/../g)!.map((par) => parseInt(par, 16)))
  return crypto.subtle.verify('HMAC', chave, bytes, new TextEncoder().encode(`${slug}\n${url}`))
}

export default {
  async fetch(pedido: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = cabecalhosCors(pedido, env)

    // Só GET (e OPTIONS para o preflight)
    if (pedido.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (pedido.method !== 'GET') return erro(405, 'Só GET', cors)

    const endereco = new URL(pedido.url)
    if (endereco.pathname !== '/img') return erro(404, 'Não encontrado', cors)

    // Parâmetros
    const url = endereco.searchParams.get('u') ?? ''
    const slug = endereco.searchParams.get('s') ?? ''
    const assinatura = endereco.searchParams.get('t') ?? ''

    // 1. Assinatura
    if (!(await assinaturaValida(env.PROXY_SEGREDO, slug, url, assinatura))) {
      return erro(403, 'Assinatura inválida', cors)
    }

    // 2. Site conhecido e domínio de imagem aceito para ele
    const site = (JSON.parse(env.SITES) as Record<string, ConfigSite>)[slug]
    let alvo: URL
    try {
      alvo = new URL(url)
    } catch {
      return erro(400, 'Endereço inválido', cors)
    }
    const dominioAceito = site?.dominios.some((d) => alvo.hostname === d || alvo.hostname.endsWith(`.${d}`))
    if (!site || alvo.protocol !== 'https:' || !dominioAceito) {
      return erro(403, 'Domínio não permitido para este site', cors)
    }

    // 3. Cache da borda: a mesma imagem não é buscada duas vezes na origem
    const chaveCache = new Request(`https://cache.interno/img?u=${encodeURIComponent(url)}`)
    const cache = caches.default
    const guardada = await cache.match(chaveCache)
    if (guardada) {
      const resposta = new Response(guardada.body, guardada)
      for (const [nome, valor] of Object.entries(cors)) resposta.headers.set(nome, valor)
      return resposta
    }

    // 4. Busca na origem, com o Referer do site e User-Agent de navegador
    let origem: Response
    try {
      origem = await fetch(alvo.toString(), {
        headers: { Referer: site.referer, 'User-Agent': USER_AGENT, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      })
    } catch {
      return erro(504, 'A origem não respondeu', cors)
    }

    // Erro na origem: devolve o mesmo status; o app usa isso para tentar outra fonte
    if (!origem.ok) return erro(origem.status, `A origem respondeu ${origem.status}`, cors)

    // 5. Repassa o corpo sem transformar
    const cabecalhos = new Headers(cors)
    cabecalhos.set('Content-Type', origem.headers.get('Content-Type') ?? 'application/octet-stream')
    cabecalhos.set('Cache-Control', 'public, max-age=31536000, immutable')
    const tamanho = origem.headers.get('Content-Length')
    if (tamanho) cabecalhos.set('Content-Length', tamanho)

    const resposta = new Response(origem.body, { status: 200, headers: cabecalhos })
    ctx.waitUntil(cache.put(chaveCache, resposta.clone()))
    return resposta
  },
}
