import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agruparObras } from '../lib/agrupar.ts'
import { extrairLinha, lerArquivoDeAbas } from '../lib/extrair.ts'
import { normalizarTitulo, semelhanca } from '../lib/titulos.ts'

// Atalho: extrai e devolve só o que interessa comparar.
function ex(titulo: string) {
  const l = extrairLinha(titulo, 1)
  return l.descartada ? { descartada: l.motivo } : { titulo: l.titulo, capitulo: l.capitulo, site: l.siteSlug }
}

test('normalização: acento, aspas curvas, pontuação e espaços', () => {
  assert.equal(normalizarTitulo('The Player Who Can’t  Level-Up!'), 'the player who can t level up')
  assert.equal(normalizarTitulo('  Olá,   “Mundo”  '), 'ola mundo')
})

test('semelhança bate com a similarity() do pg_trgm do banco', () => {
  // Valor medido no banco: 0.703704
  const s = semelhanca(normalizarTitulo('Leveling With The Gods'), normalizarTitulo('Level Up with the Gods'))
  assert.ok(Math.abs(s - 0.703704) < 0.0001, `veio ${s}`)
  assert.equal(semelhanca('abc', 'abc'), 1)
})

test('extração: um caso por padrão de site', () => {
  const casos: [string, object][] = [
    ['Read Dungeon Odyssey Chapter 176 [Read new chapter at ManhuaPlus]', { titulo: 'Dungeon Odyssey', capitulo: 176, site: 'manhuaplus' }],
    ['Read Dungeon Odyssey Fastest and highest quality updates', { titulo: 'Dungeon Odyssey', capitulo: null, site: 'manhuaplus' }],
    ['Solo Leveling Chapter 12: O começo - Manganato', { titulo: 'Solo Leveling', capitulo: 12, site: 'manganato' }],
    ['Solo Leveling Manga Online Free - Manganato', { titulo: 'Solo Leveling', capitulo: null, site: 'manganato' }],
    ['Solo Leveling Chapter 118.5 - Manganelo', { titulo: 'Solo Leveling', capitulo: 118.5, site: 'manganelo' }],
    ['My System Is Serious - Chapter 119-5 - MANHUAUS.COM', { titulo: 'My System Is Serious', capitulo: 119.5, site: 'manhuaus' }],
    ['My System Is Serious - Chapter 7 - MANHUAFAST.NET', { titulo: 'My System Is Serious', capitulo: 7, site: 'manhuafast' }],
    ['Lord of Destiny Wheel Manhwa - Chapter 30 - Manhwa Manhua Top', { titulo: 'Lord of Destiny Wheel', capitulo: 30, site: 'manhwa-manhua-top' }],
    ['Lord of Destiny Wheel — Chapter 31 | Manhua Top', { titulo: 'Lord of Destiny Wheel', capitulo: 31, site: 'manhwa-manhua-top' }],
    ['The Turn-Bound Mage - Lastest Chapter 44 - MANHWATOP', { titulo: 'The Turn-Bound Mage', capitulo: 44, site: 'manhwatop' }],
    ['Some Shojo Chapter 9 | Kingofshojo', { titulo: 'Some Shojo', capitulo: 9, site: 'kingofshojo' }],
    ['Read Some Shojo Manga [Latest Chapters] | Kingofshojo', { titulo: 'Some Shojo', capitulo: null, site: 'kingofshojo' }],
    ['Obra X Chapter 1.1 | Vortex Scans', { titulo: 'Obra X', capitulo: 1.1, site: 'vortex-scans' }],
    ['Obra X 55 - Arenascans', { titulo: 'Obra X', capitulo: 55, site: 'arenascans' }],
    ['Obra X - Chapter 3 - Manhwa Clan', { titulo: 'Obra X', capitulo: 3, site: 'manhwa-clan' }],
    ['Obra X Chapter 200 - Read Online | Asura Scans', { titulo: 'Obra X', capitulo: 200, site: 'asura-scans' }],
    ['Vol. 2 | Chapter 14 - Obra X - MangaDex', { titulo: 'Obra X', capitulo: 14, site: 'mangadex' }],
    ['Chapter 8 - Obra X | Kayn Scans', { titulo: 'Obra X', capitulo: 8, site: 'kayn-scans' }],
    ['Manga: Obra X Chapter - 21-eng-li', { titulo: 'Obra X', capitulo: 21, site: null }],
    ['Obra X Chapter 5 - Site Qualquer', { titulo: 'Obra X', capitulo: 5, site: null }],
  ]

  for (const [entrada, esperado] of casos) {
    assert.deepEqual(ex(entrada), esperado, entrada)
  }
})

test('extração: linhas a descartar', () => {
  assert.deepEqual(ex('Can’t Open Page'), { descartada: 'página de erro' })
  assert.deepEqual(ex('Just a moment...'), { descartada: 'página de erro' })
  assert.deepEqual(ex('manhuaplus.org | 522: Connection timed out'), { descartada: 'página de erro' })
  assert.deepEqual(ex('vortexscans.org'), { descartada: 'domínio solto sem nome de obra' })
  assert.deepEqual(ex('Manhuaplus - Read Manga Fastest and highest quality'), { descartada: 'página inicial ou de busca de site' })
  assert.deepEqual(ex('Manga : solo level - Manganato'), { descartada: 'página inicial ou de busca de site' })
  assert.deepEqual(ex('AnimeFire - Assistir animes'), { descartada: 'não é mangá' })
  assert.deepEqual(ex('Alguma página aleatória'), { descartada: 'formato não reconhecido' })
})

test('arquivo de abas: ignora cabeçalho, hífens e linhas vazias', () => {
  const conteudo = 'Manhua\n----------------------\nA Chapter 1 - Manganato\n----------------------\n\nB Chapter 2 - Manganelo\n'
  assert.deepEqual(lerArquivoDeAbas(conteudo), ['A Chapter 1 - Manganato', 'B Chapter 2 - Manganelo'])
})

test('agrupamento: junta a mesma obra e fica com o maior capítulo', () => {
  const linhas = [
    'Read Dungeon Odyssey Chapter 123 [Read new chapter at ManhuaPlus]',
    'Dungeon Odyssey Chapter 176 - Manganato',
    'Read Dungeon Odyssey Fastest and highest quality updates',
    'Read Outra Obra Fastest and highest quality updates',
    'Just a moment...',
  ].map((t, i) => extrairLinha(t, i + 1))

  const { obras } = agruparObras(linhas)
  assert.equal(obras.length, 2)

  // Dungeon Odyssey: três abas, dois sites, capítulo mais alto
  assert.deepEqual(obras[0], {
    titulo: 'Dungeon Odyssey',
    titulosAlternativos: [],
    status: 'lendo',
    capituloAtual: 176,
    sites: ['manganato', 'manhuaplus'],
    linhas: [1, 2, 3],
  })

  // Só página de obra, sem capítulo: para ler depois
  assert.equal(obras[1].status, 'nao_iniciada')
  assert.equal(obras[1].capituloAtual, null)
})

test('agrupamento: casos reais da lista são juntados ou vão ao relatório, nunca ignorados', () => {
  const pares: [string, string][] = [
    ['Level Up with the Gods', 'Leveling With The Gods'],
    ['The Tutorial is Too Hard', 'The Tutorial Is Too Tough!'],
    ["The Player Who Can't Level Up", "The Player That Can't Level Up"],
    ['Lord of Destiny Wheel', 'The Lord of the Wheel of Destiny'],
    ['The Turn-Bound Mage', 'The Turn-Based Mage'],
    ['My System Is Serious', 'My System Is Very Serious'],
  ]

  for (const [a, b] of pares) {
    const linhas = [`${a} Chapter 1 - Manganato`, `${b} Chapter 2 - Manganato`].map((t, i) => extrairLinha(t, i + 1))
    const { obras, duvidosos } = agruparObras(linhas)

    const juntou = obras.length === 1
    const foiAoRelatorio = duvidosos.length === 1
    assert.ok(juntou || foiAoRelatorio, `"${a}" × "${b}" passou sem ser notado`)
  }
})
