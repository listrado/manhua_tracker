// Contrato comum a todos os adaptadores de site. O resto do sistema só conhece
// esta interface: não sabe de qual site veio o dado.
//
// Este código roda em dois lugares: nas Edge Functions (Deno) e nos scripts
// locais (Node). Por isso não usa nada específico de nenhum dos dois — o acesso
// à rede chega de fora, pelo tipo Http.

export type ResultadoBusca = { titulo: string; url: string; capaUrl: string | null }
export type DadosObra = { titulo: string; capaUrl: string | null; titulosAlternativos: string[] }
export type CapituloRemoto = { numero: number; titulo: string; url: string }

export interface Adaptador {
  slug: string
  buscar(termo: string): Promise<ResultadoBusca[]> // nome -> candidatos
  lerObra(urlObra: string): Promise<DadosObra> // título, capa, títulos alternativos
  // numero, titulo, url. Com soRecentes, o adaptador pode devolver só os
  // capítulos mais novos (basta para saber se saiu algo); sem ela, todos.
  listarCapitulos(urlObra: string, opcoes?: { soRecentes?: boolean }): Promise<CapituloRemoto[]>
  listarPaginas(urlCapitulo: string): Promise<string[]> // URLs das imagens, em ordem

  // Opcional: endereços em que a obra provavelmente está, montados só pelo
  // nome (mais de um quando o site pode escrever o nome de jeitos diferentes).
  // Serve quando a busca do site não acha nada ou não existe.
  urlsProvaveis?(titulo: string): string[]
}

// Quem chama fornece o acesso à rede. É aqui que ficam o intervalo entre
// requisições, o User-Agent e o Referer — o adaptador só diz o que quer buscar.
export type PedidoHttp = { metodo?: 'GET' | 'POST'; referer?: string; ajax?: boolean }
export type Http = (url: string, pedido?: PedidoHttp) => Promise<string>

// O site respondeu com o desafio do Cloudflare. Não tentamos burlar: quem chama
// registra o erro na fonte e segue para a próxima.
export class ErroDesafioCloudflare extends Error {
  constructor(url: string) {
    super(`O site respondeu com desafio do Cloudflare: ${url}`)
    this.name = 'ErroDesafioCloudflare'
  }
}

export function ehDesafioCloudflare(html: string): boolean {
  return /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(html) || html.includes('cf-chl-')
}

// Número do capítulo como decimal: "118.5", "119-5" (vira 119.5) e "1.1".
export function numeroDoCapitulo(texto: string): number | null {
  const m = texto.match(/chapter[\s\-_]*(\d+(?:[.\-]\d+)?)/i)
  return m ? Number(m[1].replace('-', '.')) : null
}

// "Chapter 266 - 223": capítulo antigo (o 223) repostado com outro número na
// frente. Visto no Manhua Top em The Beginning After the End: os capítulos 223
// a 237 reapareceram como "266 - 223" a "280 - 237", todos no mesmo dia, e o
// sistema achou que a obra tinha chegado ao 280. Capítulo duplo de verdade
// ("Chapter 10 - 11") tem o segundo número maior e continua valendo.
export function ehCapituloRepostado(titulo: string): boolean {
  const m = titulo.match(/chapter\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/i)
  return m !== null && Number(m[2]) < Number(m[1])
}

// Entidades HTML que aparecem em títulos ("God&#039;s Contempt").
export function decodificarHtml(texto: string): string {
  return texto
    .replace(/&#(\d+);/g, (_, codigo) => String.fromCodePoint(Number(codigo)))
    .replace(/&#x([0-9a-f]+);/gi, (_, codigo) => String.fromCodePoint(parseInt(codigo, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
