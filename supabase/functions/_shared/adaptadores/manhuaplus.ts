// Adaptador do ManhuaPlus (tema "liliana"). Estrutura conferida no site real
// em 2026-11-19:
//   busca ......... GET  {base}/search?keyword=<termo>
//   obra .......... GET  {base}/manga/<slug>            (título, capa, capítulos)
//   capítulo ...... GET  {base}/manga/<slug>/chapter-N  (só traz o CHAPTER_ID)
//   imagens ....... POST {base}/ajax/image/list/chap/<CHAPTER_ID>  (JSON com HTML)
//
// O domínio vem de fora (sites.dominios): esses sites trocam de endereço.
import {
  decodificarHtml,
  ehDesafioCloudflare,
  ErroDesafioCloudflare,
  numeroDoCapitulo,
  type Adaptador,
  type CapituloRemoto,
  type DadosObra,
  type Http,
  type ResultadoBusca,
} from './tipos.ts'

// Transforma caminho relativo ("/uploads/covers/x.jpg") em URL completa.
function absoluta(url: string, base: string): string {
  return new URL(url, base).toString()
}

export function extrairBusca(html: string, base: string): ResultadoBusca[] {
  const resultados: ResultadoBusca[] = []
  const vistos = new Set<string>()

  // Cada resultado é um <a title href=".../manga/slug"> com a capa dentro
  const padrao = /<a\s+title="([^"]*)"[^>]*href="([^"]*\/manga\/[^"\/]+)"[^>]*>\s*<img[^>]*data-src="([^"]+)"/g
  for (const m of html.matchAll(padrao)) {
    const url = absoluta(m[2], base)
    if (vistos.has(url)) continue

    vistos.add(url)
    resultados.push({ titulo: decodificarHtml(m[1]), url, capaUrl: absoluta(m[3], base) })
  }

  return resultados
}

export function extrairObra(html: string, base: string): DadosObra {
  // Título: o <h1> da página
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  if (!h1) throw new Error('ManhuaPlus: página de obra sem <h1>')

  // Capa: a meta og:image
  const capa = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)

  // Outros nomes: "Other name: A; B; C"
  const outros = html.match(/Other name:\s*([^<]*)</)
  const titulosAlternativos = outros
    ? decodificarHtml(outros[1])
        .split(';')
        .map((nome) => nome.trim())
        .filter((nome) => nome !== '' && nome.toLowerCase() !== 'updating')
    : []

  return {
    titulo: decodificarHtml(h1[1]),
    capaUrl: capa ? absoluta(capa[1], base) : null,
    titulosAlternativos,
  }
}

export function extrairCapitulos(html: string, base: string): CapituloRemoto[] {
  const capitulos = new Map<number, CapituloRemoto>()

  // Cada capítulo é um <li class="chapter"><a href>Chapter N</a>
  const padrao = /<li[^>]*class="chapter"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  for (const m of html.matchAll(padrao)) {
    const titulo = decodificarHtml(m[2])
    const numero = numeroDoCapitulo(titulo) ?? numeroDoCapitulo(m[1])
    if (numero === null) continue

    // Mesmo número duas vezes: fica o primeiro (o mais recente na lista)
    if (!capitulos.has(numero)) {
      capitulos.set(numero, { numero, titulo, url: absoluta(m[1], base) })
    }
  }

  return [...capitulos.values()].sort((a, b) => a.numero - b.numero)
}

export function extrairChapterId(html: string): string {
  const m = html.match(/const\s+CHAPTER_ID\s*=\s*(\d+)/)
  if (!m) throw new Error('ManhuaPlus: página de capítulo sem CHAPTER_ID')
  return m[1]
}

export function extrairPaginas(json: string): string[] {
  const resposta = JSON.parse(json) as { status?: boolean; html?: string }
  if (!resposta.status || !resposta.html) throw new Error('ManhuaPlus: lista de imagens vazia')

  // As imagens vêm fora de ordem; a ordem certa está no data-index de cada bloco
  const paginas: { indice: number; url: string }[] = []
  const padrao = /data-index="(\d+)"[^>]*>\s*<a\s+href="([^"]+)"/g
  for (const m of resposta.html.matchAll(padrao)) {
    paginas.push({ indice: Number(m[1]), url: m[2] })
  }

  return paginas.sort((a, b) => a.indice - b.indice).map((p) => p.url)
}

export function criarManhuaplus(base: string, http: Http): Adaptador {
  // Busca uma página e para se o site respondeu com o desafio do Cloudflare
  async function pagina(url: string, pedido?: Parameters<Http>[1]): Promise<string> {
    const corpo = await http(url, pedido)
    if (ehDesafioCloudflare(corpo)) throw new ErroDesafioCloudflare(url)
    return corpo
  }

  return {
    slug: 'manhuaplus',

    async buscar(termo) {
      const url = `${base}/search?keyword=${encodeURIComponent(termo)}`
      return extrairBusca(await pagina(url, { referer: `${base}/` }), base)
    },

    async lerObra(urlObra) {
      return extrairObra(await pagina(urlObra, { referer: `${base}/` }), base)
    },

    async listarCapitulos(urlObra) {
      return extrairCapitulos(await pagina(urlObra, { referer: `${base}/` }), base)
    },

    // O endereço da obra é o nome em minúsculas, com tudo que não é letra ou
    // número virando hífen: "I'm Going to..." -> /manga/i-m-going-to-...
    urlsProvaveis(titulo) {
      const slug = titulo
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      return [`${base}/manga/${slug}`]
    },

    async listarPaginas(urlCapitulo) {
      // 1. A página do capítulo só serve para descobrir o id interno
      const id = extrairChapterId(await pagina(urlCapitulo, { referer: `${base}/` }))

      // 2. As imagens vêm de um endpoint separado
      const json = await pagina(`${base}/ajax/image/list/chap/${id}`, {
        metodo: 'POST',
        referer: urlCapitulo,
        ajax: true,
      })
      return extrairPaginas(json)
    },
  }
}
