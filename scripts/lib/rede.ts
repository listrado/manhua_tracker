// Acesso à rede dos scripts locais: um pedido por vez, com intervalo entre eles,
// User-Agent de navegador comum e Referer do próprio site. Sem rajadas.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Http } from '../../supabase/functions/_shared/adaptadores/tipos.ts'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))

export type Rede = {
  // Páginas e JSON, como texto (é o que os adaptadores usam)
  http: Http
  // Arquivos binários (capas)
  baixar(url: string, referer?: string): Promise<Buffer>
}

// pastaCache (opcional): guarda em disco a resposta de cada GET de página, para
// rodar o script de novo sem repetir os pedidos já feitos ao site.
export function criarRede(intervaloMs: number, pastaCache?: string): Rede {
  let ultimoPedido = 0
  if (pastaCache) mkdirSync(pastaCache, { recursive: true })

  // Respeita o intervalo desde o pedido anterior ao mesmo site
  async function aguardarVez() {
    const falta = ultimoPedido + intervaloMs - Date.now()
    if (falta > 0) await esperar(falta)
    ultimoPedido = Date.now()
  }

  function cabecalhos(referer?: string, ajax?: boolean): Record<string, string> {
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' }
    if (referer) headers.Referer = referer
    if (ajax) headers['X-Requested-With'] = 'XMLHttpRequest'
    return headers
  }

  const http: Http = async (url, pedido = {}) => {
    const metodo = pedido.metodo ?? 'GET'

    // Já buscado antes? Devolve do disco, sem ir ao site
    const arquivo =
      pastaCache && metodo === 'GET'
        ? join(pastaCache, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.txt`)
        : null
    if (arquivo && existsSync(arquivo)) return readFileSync(arquivo, 'utf8')

    // Vai ao site
    await aguardarVez()
    const resposta = await fetch(url, {
      method: metodo,
      headers: cabecalhos(pedido.referer, pedido.ajax),
      signal: AbortSignal.timeout(30_000),
    })
    const corpo = await resposta.text()

    // 403 pode ser o desafio do Cloudflare: devolve o corpo para o adaptador
    // reconhecer. Qualquer outro erro de status vira exceção.
    if (!resposta.ok && resposta.status !== 403) {
      throw new Error(`HTTP ${resposta.status} em ${url}`)
    }

    if (arquivo && resposta.ok) writeFileSync(arquivo, corpo, 'utf8')
    return corpo
  }

  async function baixar(url: string, referer?: string): Promise<Buffer> {
    await aguardarVez()
    const resposta = await fetch(url, { headers: cabecalhos(referer), signal: AbortSignal.timeout(30_000) })
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status} em ${url}`)
    return Buffer.from(await resposta.arrayBuffer())
  }

  return { http, baixar }
}
