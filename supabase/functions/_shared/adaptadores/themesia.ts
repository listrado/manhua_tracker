// Adaptador genérico para sites feitos com o tema "MangaReader" da Themesia
// (WordPress). Um mesmo código serve para vários sites; só o domínio muda.
// Conferido em 2026-11-20 no Kingofshojo e no Arenascans:
//   busca ......... GET {base}/?s=<termo>
//   obra .......... GET {base}/manga/<slug>/     (título, capa, outros nomes, capítulos)
//   capítulo ...... GET <link do capítulo>       (imagens dentro de ts_reader.run({...}))
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

export function extrairBuscaThemesia(html: string, base: string): ResultadoBusca[] {
  const resultados: ResultadoBusca[] = []
  const vistos = new Set<string>()

  // Cada resultado: <div class="bsx"><a href title> ... <img src>
  const padrao = /<div class="bsx">\s*<a\s+href="([^"]+)"\s+title="([^"]*)"[\s\S]*?<img[^>]*?\ssrc="([^"]+)"/g
  for (const m of html.matchAll(padrao)) {
    const url = new URL(m[1], base).toString()
    if (vistos.has(url)) continue

    vistos.add(url)
    resultados.push({ titulo: decodificarHtml(m[2]), url, capaUrl: new URL(m[3], base).toString() })
  }

  return resultados
}

export function extrairObraThemesia(html: string, base: string): DadosObra {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  if (!h1) throw new Error('Themesia: página de obra sem <h1>')

  const capa = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)

  // Outros nomes: linha "Alternative" da tabela de informações, separados por " / "
  const outros = html.match(/<td>\s*Alternative\s*<\/td>\s*<td>([\s\S]*?)<\/td>/)
  const titulosAlternativos = outros
    ? decodificarHtml(outros[1].replace(/<[^>]+>/g, ''))
        .split(/\s+\/\s+|;/)
        .map((nome) => nome.trim())
        .filter((nome) => nome !== '' && nome !== '-')
    : []

  return {
    titulo: decodificarHtml(h1[1].replace(/<[^>]+>/g, '')),
    capaUrl: capa ? new URL(capa[1], base).toString() : null,
    titulosAlternativos,
  }
}

export function extrairCapitulosThemesia(html: string, base: string): CapituloRemoto[] {
  const capitulos = new Map<number, CapituloRemoto>()

  // <li data-num="178"> ... <a href> <span class="chapternum">Chapter 178</span>
  const padrao = /<li\s+data-num="([^"]*)">[\s\S]*?<a\s+href="([^"]+)">\s*<span class="chapternum">([^<]*)<\/span>/g
  for (const m of html.matchAll(padrao)) {
    const titulo = decodificarHtml(m[3])

    // O número vem no data-num ("178", "12.5"); se vier texto, tenta pelo título
    const doAtributo = Number(m[1].trim().replace('-', '.'))
    const numero = m[1].trim() !== '' && Number.isFinite(doAtributo) ? doAtributo : numeroDoCapitulo(titulo)
    if (numero === null || capitulos.has(numero)) continue

    capitulos.set(numero, { numero, titulo, url: new URL(m[2], base).toString() })
  }

  return [...capitulos.values()].sort((a, b) => a.numero - b.numero)
}

export function extrairPaginasThemesia(html: string): string[] {
  // O leitor do tema recebe tudo num objeto: ts_reader.run({"sources":[{"images":[...]}]})
  const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/)
  if (!m) throw new Error('Themesia: página de capítulo sem ts_reader')

  const dados = JSON.parse(m[1]) as { sources?: { images?: string[] }[] }
  const imagens = dados.sources?.find((fonte) => (fonte.images?.length ?? 0) > 0)?.images
  if (!imagens) throw new Error('Themesia: capítulo sem imagens (pode ser capítulo bloqueado)')

  return imagens
}

export function criarThemesia(slug: string, base: string, http: Http): Adaptador {
  // Busca uma página e para se o site respondeu com o desafio do Cloudflare
  async function pagina(url: string): Promise<string> {
    const corpo = await http(url, { referer: `${base}/` })
    if (ehDesafioCloudflare(corpo)) throw new ErroDesafioCloudflare(url)
    return corpo
  }

  return {
    slug,

    async buscar(termo) {
      return extrairBuscaThemesia(await pagina(`${base}/?s=${encodeURIComponent(termo)}`), base)
    },

    async lerObra(urlObra) {
      return extrairObraThemesia(await pagina(urlObra), base)
    },

    async listarCapitulos(urlObra) {
      return extrairCapitulosThemesia(await pagina(urlObra), base)
    },

    async listarPaginas(urlCapitulo) {
      return extrairPaginasThemesia(await pagina(urlCapitulo))
    },
  }
}
