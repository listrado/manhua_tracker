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

// O tipo no fim do nome ("Another God of War Manhua") é do site, não da obra.
function semTipo(normalizado: string): string {
  return normalizado.replace(/ (?:manga|manhwa|manhua)$/, '')
}

// Nome que está no endereço: ".../manga/a-big-shot-actually" -> "a big shot actually".
// Os sites renomeiam obras, mas o endereço costuma guardar o nome antigo — que
// é justamente o que estava no título da aba.
export function nomeDoEndereco(url: string): string {
  const ultimo = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? ''
  return normalizarTitulo(decodeURIComponent(ultimo))
}

// Maior semelhança entre qualquer nome conhecido da obra e o que foi
// encontrado: o título do resultado ou o nome que está no endereço dele.
export function pontuar(nomesDaObra: string[], tituloEncontrado: string, url?: string): number {
  const encontrados = [semTipo(normalizarTitulo(tituloEncontrado))]
  if (url) encontrados.push(semTipo(nomeDoEndereco(url)))

  let melhor = 0
  for (const nome of nomesDaObra) {
    const normalizado = semTipo(normalizarTitulo(nome))
    for (const encontrado of encontrados) {
      melhor = Math.max(melhor, semelhanca(normalizado, encontrado))
    }
  }
  return melhor
}

export function decidir(nomesDaObra: string[], resultados: ResultadoBusca[]): Decisao {
  // Pontua e ordena do mais parecido para o menos
  const pontuados = resultados
    .map((r): Pontuado => ({ ...r, score: pontuar(nomesDaObra, r.titulo, r.url) }))
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

// Quantos nomes alternativos entram na busca. As obras acumulam até 15 nomes
// (em várias línguas); tentar todos em todo site levaria horas.
export const MAXIMO_ALTERNATIVOS_NA_BUSCA = 2

// Termos a tentar, em ordem: título completo, título encurtado (4 primeiras
// palavras) e depois os primeiros nomes alternativos escritos em alfabeto
// latino (os sites buscam em inglês; nome em coreano ou chinês não acha nada).
export function termosDeBusca(titulo: string, alternativos: string[]): string[] {
  const curto = titulo.split(/\s+/).slice(0, 4).join(' ')
  const latinos = alternativos.filter((nome) => /^[\x20-\x7e’‘“”]+$/.test(nome) && /[a-z]/i.test(nome))

  return [...new Set([titulo, curto, ...latinos.slice(0, MAXIMO_ALTERNATIVOS_NA_BUSCA)])].filter((t) => t.trim() !== '')
}
