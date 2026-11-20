// Adaptador do Manhua Top (manhuatop.org — "Manhwa Manhua Top" / "Top Manhua"
// nos títulos das abas). O site é feito em Next.js: os dados vêm dentro da
// própria página, num bloco de texto com as aspas escapadas (\").
// Conferido no site real em 2026-11-20:
//   busca ......... GET {base}/search/<termo>/
//   obra .......... GET {base}/manhua/<slug>/?tab=chapters&chapter_page=N
//                   (título, capa, outros nomes e 50 capítulos por página)
//   capítulo ...... GET {base}/manhua/<slug>/chapter-N/   (lista "images")
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

// Limite de páginas de capítulos por obra (50 por página = até 2000 capítulos).
const MAXIMO_DE_PAGINAS = 40

// Tira o escape das aspas para os dados virarem JSON legível.
function desescapar(html: string): string {
  return html.replaceAll('\\"', '"')
}

// Texto que estava dentro de aspas no JSON: resolve &, \n etc.
function textoJson(bruto: string): string {
  try {
    return JSON.parse(`"${bruto}"`) as string
  } catch {
    return bruto
  }
}

export function extrairBuscaManhuatop(html: string, base: string): ResultadoBusca[] {
  const dados = desescapar(html)
  const resultados: ResultadoBusca[] = []
  const vistos = new Set<string>()

  // Cada resultado: {"id":"…","slug":"…","title":"…","excerpt":"…","path":"/manhua/…/",…,"thumbnail":"…"}
  const padrao = /"slug":"[^"]+","title":"((?:[^"\\]|\\.)*)","excerpt":"(?:[^"\\]|\\.)*","path":"([^"]+)"[^{}]*?"thumbnail":"([^"]*)"/g
  for (const m of dados.matchAll(padrao)) {
    const url = new URL(m[2], base).toString()
    if (vistos.has(url)) continue

    vistos.add(url)
    resultados.push({ titulo: textoJson(m[1]), url, capaUrl: m[3] ? new URL(m[3], base).toString() : null })
  }

  return resultados
}

export function extrairObraManhuatop(html: string, base: string): DadosObra {
  const h1 = html.match(/<h1[^>]*id="manga-title"[^>]*>([\s\S]*?)<\/h1>/)
  if (!h1) throw new Error('Manhua Top: página de obra sem título')

  const capa = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)

  // Outros nomes: <p class="alternative-title">A / B / C</p>
  const outros = html.match(/<p class="alternative-title">([\s\S]*?)<\/p>/)
  const titulosAlternativos = outros
    ? decodificarHtml(outros[1])
        .split(/\s+\/\s+/)
        .map((nome) => nome.trim())
        .filter((nome) => nome !== '')
    : []

  return {
    titulo: decodificarHtml(h1[1].replace(/<[^>]+>/g, '')),
    capaUrl: capa ? new URL(capa[1], base).toString() : null,
    titulosAlternativos,
  }
}

// Capítulos de UMA página da lista, e se existe página seguinte.
export function extrairCapitulosManhuatop(html: string, base: string): { capitulos: CapituloRemoto[]; temMais: boolean } {
  const dados = desescapar(html)
  const capitulos: CapituloRemoto[] = []

  // {"id":"…","mangaId":"…","volumeId":…,"slug":"chapter-297","title":"Chapter 297","extra":"","date":"…","path":"/manhua/…/chapter-297/"}
  const padrao = /"slug":"([^"]+)","title":"((?:[^"\\]|\\.)*)","extra":"(?:[^"\\]|\\.)*","date":"[^"]*","path":"([^"]+)"/g
  for (const m of dados.matchAll(padrao)) {
    const titulo = textoJson(m[2])
    const numero = numeroDoCapitulo(titulo) ?? numeroDoCapitulo(m[1])
    if (numero === null) continue

    capitulos.push({ numero, titulo, url: new URL(m[3], base).toString() })
  }

  // "chapters":{"items":[…],"page":1,"hasMore":true,…}
  const mais = dados.match(/"chapters":\{"items":\[[\s\S]*?\],"page":\d+,"hasMore":(true|false)/)
  return { capitulos, temMais: mais?.[1] === 'true' }
}

export function extrairPaginasManhuatop(html: string): string[] {
  const dados = desescapar(html)

  // "images":[{"index":1,"url":"https://…","width":null,"height":null},…]
  const bloco = dados.match(/"images":\[(\{"index":[\s\S]*?)\]/)
  if (!bloco) throw new Error('Manhua Top: página de capítulo sem a lista de imagens')

  const paginas: { indice: number; url: string }[] = []
  for (const m of bloco[1].matchAll(/"index":(\d+),"url":"([^"]+)"/g)) {
    paginas.push({ indice: Number(m[1]), url: m[2] })
  }

  return paginas.sort((a, b) => a.indice - b.indice).map((p) => p.url)
}

export function criarManhuatop(slug: string, base: string, http: Http): Adaptador {
  // Busca uma página e para se o site respondeu com o desafio do Cloudflare
  async function pagina(url: string): Promise<string> {
    const corpo = await http(url, { referer: `${base}/` })
    if (ehDesafioCloudflare(corpo)) throw new ErroDesafioCloudflare(url)
    return corpo
  }

  return {
    slug,

    async buscar(termo) {
      return extrairBuscaManhuatop(await pagina(`${base}/search/${encodeURIComponent(termo)}/`), base)
    },

    async lerObra(urlObra) {
      return extrairObraManhuatop(await pagina(urlObra), base)
    },

    // A lista vem de 50 em 50, do capítulo mais novo para o mais antigo
    async listarCapitulos(urlObra) {
      const raiz = urlObra.split('?')[0]
      const porNumero = new Map<number, CapituloRemoto>()

      for (let numeroDaPagina = 1; numeroDaPagina <= MAXIMO_DE_PAGINAS; numeroDaPagina++) {
        const html = await pagina(`${raiz}?tab=chapters&chapter_page=${numeroDaPagina}`)
        const { capitulos, temMais } = extrairCapitulosManhuatop(html, base)

        for (const c of capitulos) {
          if (!porNumero.has(c.numero)) porNumero.set(c.numero, c)
        }
        if (!temMais) break
      }

      return [...porNumero.values()].sort((a, b) => a.numero - b.numero)
    },

    async listarPaginas(urlCapitulo) {
      return extrairPaginasManhuatop(await pagina(urlCapitulo))
    },
  }
}
