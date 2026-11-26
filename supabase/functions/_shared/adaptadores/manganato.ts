// Adaptador do Manganato (hoje em manganato.gg; o Manganelo foi absorvido por
// ele). Estrutura conferida no site real em 2026-11-20:
//   obra .......... GET {base}/manga/<slug>                       (título e capa)
//   capítulos ..... GET {base}/api/manga/<slug>/chapters?limit=…  (JSON)
//   capítulo ...... GET {base}/manga/<slug>/chapter-N             (imagens num <script>)
//
// A BUSCA do site fica atrás do desafio do Cloudflare, então buscar() não
// devolve nada: a obra é achada pelo endereço, que sai direto do nome
// (urlProvavel). Obra que não existe responde 404 de verdade.
//
// As imagens exigem o Referer do site; sem o proxy de imagem o leitor não
// consegue mostrá-las (sites.precisa_proxy).
import {
  decodificarHtml,
  ehDesafioCloudflare,
  ErroDesafioCloudflare,
  type Adaptador,
  type CapituloRemoto,
  type DadosObra,
  type Http,
} from './tipos.ts'

// Mais capítulos do que qualquer obra tem: traz a lista inteira num pedido só.
const LIMITE_CAPITULOS = 5000

export function extrairObraNato(html: string, base: string): DadosObra {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  if (!h1) throw new Error('Manganato: página de obra sem <h1>')

  const capa = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)

  return {
    titulo: decodificarHtml(h1[1].replace(/<[^>]+>/g, '')),
    capaUrl: capa ? new URL(capa[1], base).toString() : null,
    titulosAlternativos: [],
  }
}

type RespostaCapitulos = {
  success?: boolean
  data?: { chapters?: { chapter_name: string; chapter_slug: string; chapter_num: number }[] }
}

export function extrairCapitulosNato(json: string, urlObra: string): CapituloRemoto[] {
  const resposta = JSON.parse(json) as RespostaCapitulos
  if (!resposta.success || !resposta.data?.chapters) throw new Error('Manganato: lista de capítulos inválida')

  const raiz = urlObra.replace(/\/+$/, '')
  const capitulos = new Map<number, CapituloRemoto>()

  for (const c of resposta.data.chapters) {
    const numero = Number(c.chapter_num)
    if (!Number.isFinite(numero) || capitulos.has(numero)) continue

    capitulos.set(numero, { numero, titulo: c.chapter_name, url: `${raiz}/${c.chapter_slug}` })
  }

  return [...capitulos.values()].sort((a, b) => a.numero - b.numero)
}

export function extrairPaginasNato(html: string): string[] {
  // As imagens vêm em duas variáveis: os servidores e o caminho de cada página
  const cdns = html.match(/var\s+cdns\s*=\s*(\[[^\]]*\])/)
  const imagens = html.match(/var\s+chapterImages\s*=\s*(\[[^\]]*\])/)
  if (!cdns || !imagens) throw new Error('Manganato: página de capítulo sem a lista de imagens')

  // O servidor às vezes vem com a barra no fim ("https://img-r1.2xstorage.com/")
  // e às vezes sem ("https://imgs-2.2xstorage.com"); o site junta os dois com
  // uma barra, e aqui também: exatamente uma
  const servidor = (JSON.parse(cdns[1]) as string[])[0].trim().replace(/\/+$/, '')
  return (JSON.parse(imagens[1]) as string[]).map((caminho) => `${servidor}/${caminho.trim().replace(/^\/+/, '')}`)
}

export function criarManganato(slug: string, base: string, http: Http): Adaptador {
  // Busca uma página e para se o site respondeu com o desafio do Cloudflare
  async function pagina(url: string, referer: string): Promise<string> {
    const corpo = await http(url, { referer })
    if (ehDesafioCloudflare(corpo)) throw new ErroDesafioCloudflare(url)
    return corpo
  }

  return {
    slug,

    // A busca do site é bloqueada pelo Cloudflare; a obra é achada por urlProvavel
    buscar() {
      return Promise.resolve([])
    },

    async lerObra(urlObra) {
      return extrairObraNato(await pagina(urlObra, `${base}/`), base)
    },

    async listarCapitulos(urlObra) {
      const slugDaObra = new URL(urlObra).pathname.split('/').filter(Boolean).at(-1) ?? ''
      const api = `${base}/api/manga/${slugDaObra}/chapters?limit=${LIMITE_CAPITULOS}&offset=0`
      return extrairCapitulosNato(await pagina(api, urlObra), urlObra)
    },

    async listarPaginas(urlCapitulo) {
      return extrairPaginasNato(await pagina(urlCapitulo, `${base}/`))
    },

    // "Solo Max-Level Newbie" -> /manga/solo-max-level-newbie
    // Com apóstrofo o site pode escrever dos dois jeitos: "God's" vira "gods" ou "god-s"
    urlsProvaveis(titulo) {
      const limpo = titulo
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
      const paraSlug = (texto: string) => texto.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

      const semApostrofo = paraSlug(limpo.replace(/['’‘]/g, ''))
      const comHifen = paraSlug(limpo)
      return [...new Set([semApostrofo, comHifen])].map((slugDaObra) => `${base}/manga/${slugDaObra}`)
    },
  }
}
