// Junta as abas que são a mesma obra (várias abas, vários sites, nomes parecidos).
import type { LinhaExtraida } from './extrair.ts'
import { normalizarTitulo, semelhanca } from './titulos.ts'

// Igual ou acima: mesma obra, junta sozinho.
export const LIMITE_JUNTAR = 0.85
// Entre este e o de cima: não junta, vai ao relatório para o usuário decidir.
export const LIMITE_DUVIDA = 0.6

export type ObraImportada = {
  titulo: string
  titulosAlternativos: string[]
  status: 'lendo' | 'nao_iniciada'
  capituloAtual: number | null
  sites: string[]
  linhas: number[]
}

export type CasoDuvidoso = { a: string; b: string; score: number }

type Grupo = {
  // nome escrito -> quantas abas usaram essa grafia
  variantes: Map<string, number>
  normalizados: Set<string>
  capitulos: number[]
  sites: Set<string>
  linhas: number[]
}

// Fração de palavras em comum entre dois títulos normalizados. Pega o que os
// trigramas deixam passar: nomes iguais com UMA palavra trocada por outra
// tradução ("The Turn-Bound Mage" × "The Turn-Based Mage").
export const LIMITE_DUVIDA_PALAVRAS = 0.6

function palavrasEmComum(a: string, b: string): number {
  const pa = new Set(a.split(' '))
  const pb = new Set(b.split(' '))
  let emComum = 0
  for (const p of pa) {
    if (pb.has(p)) emComum++
  }
  return emComum / (pa.size + pb.size - emComum)
}

// Maior semelhança entre um título normalizado e qualquer grafia do grupo.
function melhorScore(normalizado: string, grupo: Grupo): number {
  let melhor = 0
  for (const outro of grupo.normalizados) {
    melhor = Math.max(melhor, outro === normalizado ? 1 : semelhanca(normalizado, outro))
  }
  return melhor
}

// juntar: grupos de nomes que o usuário confirmou serem a mesma obra
// (vem de dados/juntar.txt). Esses são unidos mesmo abaixo do limite.
export function agruparObras(
  linhas: LinhaExtraida[],
  juntar: string[][] = [],
): { obras: ObraImportada[]; duvidosos: CasoDuvidoso[] } {
  let grupos: Grupo[] = []

  // 1. Cada linha entra no grupo mais parecido, ou abre um grupo novo
  for (const linha of linhas) {
    if (linha.descartada || linha.titulo === null) continue
    const normalizado = normalizarTitulo(linha.titulo)

    // Procura o grupo mais parecido
    let alvo: Grupo | null = null
    let scoreAlvo = 0
    for (const grupo of grupos) {
      const score = melhorScore(normalizado, grupo)
      if (score > scoreAlvo) {
        alvo = grupo
        scoreAlvo = score
      }
    }

    // Abaixo do limite, é obra nova
    if (alvo === null || scoreAlvo < LIMITE_JUNTAR) {
      alvo = { variantes: new Map(), normalizados: new Set(), capitulos: [], sites: new Set(), linhas: [] }
      grupos.push(alvo)
    }

    // Registra a linha no grupo
    alvo.variantes.set(linha.titulo, (alvo.variantes.get(linha.titulo) ?? 0) + 1)
    alvo.normalizados.add(normalizado)
    alvo.linhas.push(linha.linhaNumero)
    if (linha.capitulo !== null) alvo.capitulos.push(linha.capitulo)
    if (linha.siteSlug !== null) alvo.sites.add(linha.siteSlug)
  }

  // 1b. Une os grupos que o usuário confirmou serem a mesma obra
  for (const nomes of juntar) {
    const normalizados = new Set(nomes.map(normalizarTitulo))
    const mesmos = grupos.filter((g) => [...g.normalizados].some((n) => normalizados.has(n)))
    if (mesmos.length < 2) continue

    // Despeja todos no primeiro e remove os outros
    const [destino, ...outros] = mesmos
    for (const outro of outros) {
      for (const [nome, vezes] of outro.variantes) {
        destino.variantes.set(nome, (destino.variantes.get(nome) ?? 0) + vezes)
      }
      for (const n of outro.normalizados) destino.normalizados.add(n)
      for (const s of outro.sites) destino.sites.add(s)
      destino.capitulos.push(...outro.capitulos)
      destino.linhas.push(...outro.linhas)
    }
    destino.linhas.sort((a, b) => a - b)
    grupos = grupos.filter((g) => !outros.includes(g))
  }

  // 2. Cada grupo vira uma obra; o nome principal é a grafia mais usada
  const obras = grupos.map((grupo): ObraImportada => {
    const variantes = [...grupo.variantes.entries()].sort((x, y) => y[1] - x[1]).map(([nome]) => nome)
    const temCapitulo = grupo.capitulos.length > 0

    return {
      titulo: variantes[0],
      titulosAlternativos: variantes.slice(1),
      // Com capítulo em alguma aba: está lendo, no maior capítulo encontrado.
      // Só páginas de obra, sem capítulo: vai para "Para ler depois".
      status: temCapitulo ? 'lendo' : 'nao_iniciada',
      capituloAtual: temCapitulo ? Math.max(...grupo.capitulos) : null,
      sites: [...grupo.sites].sort(),
      linhas: grupo.linhas,
    }
  })

  // 3. Pares parecidos que NÃO foram juntados: o usuário decide
  const duvidosos: CasoDuvidoso[] = []
  for (let i = 0; i < grupos.length; i++) {
    for (let j = i + 1; j < grupos.length; j++) {
      let score = 0
      let palavras = 0
      for (const normalizado of grupos[i].normalizados) {
        score = Math.max(score, melhorScore(normalizado, grupos[j]))
        for (const outro of grupos[j].normalizados) {
          palavras = Math.max(palavras, palavrasEmComum(normalizado, outro))
        }
      }

      if (score >= LIMITE_DUVIDA || palavras >= LIMITE_DUVIDA_PALAVRAS) {
        duvidosos.push({ a: obras[i].titulo, b: obras[j].titulo, score })
      }
    }
  }
  duvidosos.sort((x, y) => y.score - x.score)

  return { obras, duvidosos }
}
