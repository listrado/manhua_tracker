// Extrai nome da obra, capítulo e site a partir do título de uma aba do Safari.
// Os padrões vêm da seção 8 da especificação.

export type LinhaExtraida = {
  linhaNumero: number
  original: string
  titulo: string | null
  capitulo: number | null
  siteSlug: string | null
  descartada: boolean
  motivo: string | null
}

// Número de capítulo: "118", "118.5", "119-5" (vira 119.5), "1.1".
const NUM = String.raw`(\d+(?:[.\-]\d+)?)`

// Marca que identifica o site dentro do título da aba. A marca é removida do
// texto antes de procurar o nome e o capítulo. A ordem importa: as mais
// específicas vêm antes.
const SITES: { slug: string; marca: RegExp }[] = [
  { slug: 'manhuaplus', marca: /\s*\[Read new chapter at ManhuaPlus\]\s*$/i },
  { slug: 'manhuaplus', marca: /\s*Fastest and highest quality updates\s*$/i },
  { slug: 'manganato', marca: /\s*-\s*Manganato\s*$/i },
  { slug: 'manganelo', marca: /\s*-\s*Manganelo\s*$/i },
  { slug: 'manhuaus', marca: /\s*-\s*MANHUAUS\.(?:COM|ORG)\s*$/i },
  { slug: 'manhuafast', marca: /\s*-\s*MANHUAFAST\.(?:COM|NET)\s*$/i },
  { slug: 'manhwa-manhua-top', marca: /\s*-\s*Manhwa Manhua Top\s*$/i },
  { slug: 'manhwa-manhua-top', marca: /\s*-\s*Top Manhua\s*$/i },
  { slug: 'manhwa-manhua-top', marca: /\s*\|\s*Manhua Top\s*$/i },
  { slug: 'manhwatop', marca: /\s*-\s*MANHWATOP\s*$/i },
  { slug: 'kingofshojo', marca: /\s*\|\s*Kingofshojo\s*$/i },
  { slug: 'vortex-scans', marca: /\s*[-|]\s*Vortex Scans\s*$/i },
  { slug: 'arenascans', marca: /\s*-\s*Arenascans\s*$/i },
  { slug: 'manhwa-clan', marca: /\s*-\s*Manhwa Clan\s*$/i },
  { slug: 'asura-scans', marca: /\s*(?:-\s*Read Online\s*)?\|\s*Asura Scans\s*$/i },
  { slug: 'mangadex', marca: /\s*-\s*MangaDex\s*$/i },
  { slug: 'kayn-scans', marca: /\s*\|\s*Kayn Scans\s*$/i },
  { slug: 'roliascan', marca: /\s*\|\s*Read Manhwa Online at roliascan\.com\s*$/i },
  { slug: 'thunderscans', marca: /\s*[-–|]\s*Thunderscans(?: EN)?\s*$/i },
  { slug: 'webtoonscan', marca: /\s*[-|]\s*webtoonscan(?:\.com)?\s*$/i },
  { slug: 'toongod', marca: /\s*(?:Online\s*)?-\s*ToonGod\s*$/i },
  { slug: 'manhwagalaxy', marca: /\s*[-|]\s*ManhwaGalaxy(?:\.com)?\s*$/i },
  { slug: 'bato-to', marca: /\s*-\s*(?:Read Free Manga Online at\s*)?Bato\.To\s*$/i },
  { slug: 'mangafox', marca: /\s*-\s*(?:Page \d+\s*-\s*)?MangaFox(?: Mobile)?\s*$/i },
]

// Linhas que não são obra. Cada uma é gravada como descartada, com o motivo.
const DESCARTES: { motivo: string; teste: RegExp }[] = [
  { motivo: 'página de erro', teste: /Can['’]t Open Page|Just a moment\.\.\.|500 Internal Server Error|\b52[02]:/i },
  { motivo: 'domínio solto sem nome de obra', teste: /^[\w-]+(?:\.[\w-]+)*\.(?:org|com|net|to|io|xyz|cc)\/?$/i },
  { motivo: 'página inicial ou de busca de site', teste: /^Manhuaplus\s*-\s*Read Manga Fastest|^Manga\s*:\s*.+-\s*Manganato\s*$/i },
  {
    motivo: 'não é mangá',
    teste: /Google Search|Pesquisa Google|^https?:\/\/(?:www\.)?google\.|AnimeFire|Nexus(?: -)? Mods|SpinzyWheel/i,
  },
]

function paraNumero(texto: string): number {
  return Number(texto.replace('-', '.'))
}

// Tira prefixos, sufixos e separadores que sobram em volta do nome da obra.
function limparTitulo(titulo: string): string {
  const limpo = titulo
    .replace(/^Read\s+(?:Manga\s+)?/i, '')
    .replace(/^Manga:\s*/i, '')
    .replace(/\s+Manga Online Free$/i, '')
    .replace(/\s+Manga\s*\[Latest Chapters\]$/i, '')
    // Separadores que sobram nas pontas ("Fire Punch," / "Obra -")
    .replace(/^[\s\-–—|:,]+|[\s\-–—|:,]+$/g, '')
    // "Dungeon Reset Manhwa", "Another God of War Manhua", "The Ultimate Tank Manga":
    // o tipo no fim é do site, não faz parte do nome
    .replace(/\s+(?:Manga|Manhwa|Manhua)$/i, '')

  return limpo.replace(/\s+/g, ' ').trim()
}

export function extrairLinha(original: string, linhaNumero: number): LinhaExtraida {
  const texto = original.replace(/\s+/g, ' ').trim()
  const base: LinhaExtraida = {
    linhaNumero,
    original,
    titulo: null,
    capitulo: null,
    siteSlug: null,
    descartada: false,
    motivo: null,
  }

  // 1. Linhas que não são obra
  const descarte = DESCARTES.find((d) => d.teste.test(texto))
  if (descarte) {
    return { ...base, descartada: true, motivo: descarte.motivo }
  }

  // 2. Descobre o site pela marca e tira a marca do texto
  let resto = texto
  let slug: string | null = null
  for (const site of SITES) {
    if (site.marca.test(resto)) {
      slug = site.slug
      resto = resto.replace(site.marca, '')
      break
    }
  }

  // 3. Formatos em que o capítulo vem ANTES do nome
  let titulo: string | null = null
  let capitulo: number | null = null

  // "Chapter {n} - {título}" (Kayn, roliascan) ou "{vol} | Chapter {n} - {título}" (MangaDex)
  const capituloAntes = resto.match(new RegExp(String.raw`^(?:[^|]*\|\s*)?Chapter\s+${NUM}\s*-\s*(.+)$`, 'i'))
  if (capituloAntes) {
    capitulo = paraNumero(capituloAntes[1])
    titulo = capituloAntes[2]
  }

  // "Episode {n} | {título}"
  const episodio = resto.match(new RegExp(String.raw`^Episode\s+${NUM}\s*\|\s*(.+)$`, 'i'))
  if (titulo === null && episodio) {
    capitulo = paraNumero(episodio[1])
    titulo = episodio[2]
  }

  // MangaFox repete o nome: "{título} {n} - Read {título} Chapter {n} Online"
  if (titulo === null && slug === 'mangafox') {
    const m = resto.match(new RegExp(String.raw`^(.+?)\s+${NUM}\s*-\s*Read\b`, 'i'))
    if (m) {
      titulo = m[1]
      capitulo = paraNumero(m[2])
    }
  }

  // 4. Formato comum: "{título} ... Chapter {n}"
  if (titulo === null) {
    const m = resto.match(new RegExp(String.raw`^(.+?)[\s\-–—|:]*(?:Lastest\s+|Latest\s+)?Chapter\s*[-–—:]?\s*${NUM}`, 'i'))
    if (m) {
      titulo = m[1]
      capitulo = paraNumero(m[2])
    }
  }

  // 5. Arenascans não escreve "Chapter": "{título} {n}"
  if (titulo === null && slug === 'arenascans') {
    const m = resto.match(new RegExp(String.raw`^(.+?)\s+${NUM}$`))
    if (m) {
      titulo = m[1]
      capitulo = paraNumero(m[2])
    }
  }

  // 6. Sem capítulo: é a página da obra. Só vale se o site foi reconhecido ou se
  //    o título termina dizendo o tipo ("The Turn-Based Mage Manhwa")
  if (titulo === null) {
    if (slug === null && !/\s(?:Manga|Manhwa|Manhua)$/i.test(resto)) {
      return { ...base, descartada: true, motivo: 'formato não reconhecido' }
    }
    titulo = resto
  }

  // 7. Limpa o nome; se não sobrar nada, não é obra
  const tituloLimpo = limparTitulo(titulo)
  if (tituloLimpo === '') {
    return { ...base, siteSlug: slug, descartada: true, motivo: 'sem nome de obra' }
  }

  return { ...base, titulo: tituloLimpo, capitulo, siteSlug: slug }
}

// Lê o arquivo de abas: um título por linha, separados por linhas de hífens.
// A primeira linha é só a palavra "Manhua" (nome do grupo de abas).
export function lerArquivoDeAbas(conteudo: string): string[] {
  const linhas = conteudo
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^-{3,}$/.test(l))

  // Descarta o cabeçalho
  if (linhas[0]?.toLowerCase() === 'manhua') {
    linhas.shift()
  }

  return linhas
}
