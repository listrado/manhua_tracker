// Regra da busca automática (seção 8 da especificação): dado o que o site
// devolveu para uma obra, decide se vincula sozinho ou manda para "Confirmar".
import type { ResultadoBusca } from '../../supabase/functions/_shared/adaptadores/tipos.ts'
import { normalizarTitulo, semelhanca } from './titulos.ts'

// Melhor resultado com score igual ou acima disto...
export const SCORE_VINCULAR = 0.9
// ...e sem outro resultado a menos disto dele: vincula sozinho.
export const MARGEM_SEGUNDO = 0.05
// Abaixo disto o resultado nem vira candidato (é ruído da busca).
export const SCORE_MINIMO_CANDIDATO = 0.3

export type Pontuado = ResultadoBusca & { score: number }

export type Decisao =
  | { tipo: 'vincular'; escolhido: Pontuado }
  | { tipo: 'confirmar'; candidatos: Pontuado[] }
  | { tipo: 'nada' }

// Maior semelhança entre o título encontrado e qualquer nome conhecido da obra.
export function pontuar(nomesDaObra: string[], tituloEncontrado: string): number {
  const encontrado = normalizarTitulo(tituloEncontrado)
  let melhor = 0
  for (const nome of nomesDaObra) {
    melhor = Math.max(melhor, semelhanca(normalizarTitulo(nome), encontrado))
  }
  return melhor
}

export function decidir(nomesDaObra: string[], resultados: ResultadoBusca[]): Decisao {
  // Pontua e ordena do mais parecido para o menos
  const pontuados = resultados
    .map((r): Pontuado => ({ ...r, score: pontuar(nomesDaObra, r.titulo) }))
    .filter((r) => r.score >= SCORE_MINIMO_CANDIDATO)
    .sort((a, b) => b.score - a.score)

  if (pontuados.length === 0) return { tipo: 'nada' }

  // Certeza: score alto e nenhum outro resultado colado nele
  const [primeiro, segundo] = pontuados
  const semRival = !segundo || primeiro.score - segundo.score >= MARGEM_SEGUNDO
  if (primeiro.score >= SCORE_VINCULAR && semRival) {
    return { tipo: 'vincular', escolhido: primeiro }
  }

  // Dúvida: os 3 melhores vão para a aba "Confirmar"
  return { tipo: 'confirmar', candidatos: pontuados.slice(0, 3) }
}

// Termos a tentar, em ordem: título completo, título encurtado (4 primeiras
// palavras) e depois cada título alternativo.
export function termosDeBusca(titulo: string, alternativos: string[]): string[] {
  const curto = titulo.split(/\s+/).slice(0, 4).join(' ')
  return [...new Set([titulo, curto, ...alternativos])].filter((t) => t.trim() !== '')
}
