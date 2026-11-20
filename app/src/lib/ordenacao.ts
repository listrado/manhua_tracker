// Ordenação da biblioteca: o critério e o sentido ficam guardados no aparelho.

export type ObraOrdenavel = {
  titulo: string
  capitulo_atual: number | null
  total_capitulos: number | null
  ultima_leitura_em: string | null
  quente_ate: string | null
}

export type Criterio = 'alfabetica' | 'porcentagem' | 'lancados' | 'lidos' | 'recentes'
export type Sentido = 'crescente' | 'decrescente'
export type Ordenacao = { criterio: Criterio; sentido: Sentido }

// Nome de cada critério e o sentido que faz mais sentido como ponto de partida.
export const CRITERIOS: { id: Criterio; nome: string; sentidoInicial: Sentido }[] = [
  { id: 'recentes', nome: 'Lidos recentemente', sentidoInicial: 'decrescente' },
  { id: 'porcentagem', nome: '% já lida', sentidoInicial: 'decrescente' },
  { id: 'lidos', nome: 'Capítulos lidos', sentidoInicial: 'decrescente' },
  { id: 'lancados', nome: 'Capítulos lançados', sentidoInicial: 'decrescente' },
  { id: 'alfabetica', nome: 'Alfabética', sentidoInicial: 'crescente' },
]

const PADRAO: Ordenacao = { criterio: 'alfabetica', sentido: 'crescente' }
const CHAVE = 'manhua-ordenacao'

// Fração já lida, de 0 a 1. Sem total conhecido não dá para calcular.
// Passa de 1 quando a aba estava num capítulo que a fonte ainda não tem; trava em 1.
export function fracaoLida(obra: ObraOrdenavel): number | null {
  if (!obra.total_capitulos) return null
  return Math.min(1, (obra.capitulo_atual ?? 0) / obra.total_capitulos)
}

// Em destaque: alcançou o último capítulo e saiu capítulo novo há menos de uma semana.
export function estaQuente(obra: ObraOrdenavel, agora = Date.now()): boolean {
  return obra.quente_ate !== null && new Date(obra.quente_ate).getTime() > agora
}

// Em dia: já leu até o último capítulo lançado. Sem total conhecido não dá
// para afirmar, então a obra não conta como em dia.
export function estaEmDia(obra: ObraOrdenavel): boolean {
  return Boolean(obra.total_capitulos) && obra.capitulo_atual !== null && obra.capitulo_atual >= obra.total_capitulos!
}

// Filtro "esconder em dia", guardado no aparelho.
const CHAVE_EM_DIA = 'manhua-esconder-em-dia'

export function lerEsconderEmDia(): boolean {
  try {
    return localStorage.getItem(CHAVE_EM_DIA) === 'sim'
  } catch {
    return false
  }
}

export function salvarEsconderEmDia(esconder: boolean) {
  try {
    localStorage.setItem(CHAVE_EM_DIA, esconder ? 'sim' : 'nao')
  } catch {
    // Armazenamento indisponível: vale só até fechar a página
  }
}

// Valor numérico de cada obra no critério; null = "não tem esse dado".
function valor(obra: ObraOrdenavel, criterio: Criterio): number | null {
  if (criterio === 'porcentagem') return fracaoLida(obra)
  if (criterio === 'lancados') return obra.total_capitulos
  if (criterio === 'lidos') return obra.capitulo_atual
  if (criterio === 'recentes') return obra.ultima_leitura_em ? new Date(obra.ultima_leitura_em).getTime() : null
  return null
}

export function ordenar<T extends ObraOrdenavel>(obras: T[], ordenacao: Ordenacao): T[] {
  const fator = ordenacao.sentido === 'crescente' ? 1 : -1
  const porNome = (a: T, b: T) => a.titulo.localeCompare(b.titulo, 'pt-BR', { sensitivity: 'base' })

  return [...obras].sort((a, b) => {
    // 1. Obras em destaque ("hot") ficam sempre no topo, em qualquer ordenação
    const quentes = Number(estaQuente(b)) - Number(estaQuente(a))
    if (quentes !== 0) return quentes

    // 2. Alfabética: compara os nomes direto
    if (ordenacao.criterio === 'alfabetica') return porNome(a, b) * fator

    // 3. Critérios numéricos: quem não tem o dado vai sempre para o fim,
    //    nos dois sentidos; empate desempata pelo nome
    const va = valor(a, ordenacao.criterio)
    const vb = valor(b, ordenacao.criterio)
    if (va === null && vb === null) return porNome(a, b)
    if (va === null) return 1
    if (vb === null) return -1
    return (va - vb) * fator || porNome(a, b)
  })
}

export function lerOrdenacao(): Ordenacao {
  try {
    const guardada = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as Ordenacao | null
    const valida = guardada && CRITERIOS.some((c) => c.id === guardada.criterio) && ['crescente', 'decrescente'].includes(guardada.sentido)
    return valida ? guardada : PADRAO
  } catch {
    return PADRAO
  }
}

export function salvarOrdenacao(ordenacao: Ordenacao) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(ordenacao))
  } catch {
    // Armazenamento indisponível: vale só até fechar a página
  }
}
