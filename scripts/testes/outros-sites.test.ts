// Testes dos adaptadores do Manganato e do tema Themesia (Kingofshojo,
// Arenascans) contra páginas salvas dos sites reais.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { criarAdaptador } from '../../supabase/functions/_shared/adaptadores/indice.ts'
import {
  extrairCapitulosNato,
  extrairObraNato,
  extrairPaginasNato,
} from '../../supabase/functions/_shared/adaptadores/manganato.ts'
import {
  extrairBuscaManhuatop,
  extrairCapitulosManhuatop,
  extrairObraManhuatop,
  extrairPaginasManhuatop,
} from '../../supabase/functions/_shared/adaptadores/manhuatop.ts'
import {
  extrairBuscaThemesia,
  extrairCapitulosThemesia,
  extrairObraThemesia,
  extrairPaginasThemesia,
} from '../../supabase/functions/_shared/adaptadores/themesia.ts'

const PASTA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'functions', '_shared', 'adaptadores', 'fixtures')
const fixture = (nome: string) => readFileSync(join(PASTA, nome), 'utf8')

const NATO = 'https://www.manganato.gg'
const KOS = 'https://kingofshojo.com'

test('manganato: obra, capítulos pela API e páginas', () => {
  // Obra
  const obra = extrairObraNato(fixture('manganato-obra.html'), NATO)
  assert.equal(obra.titulo, 'Solo Max-Level Newbie')
  assert.equal(obra.capaUrl, 'https://img-r1.2xstorage.com/thumb/solo-max-level-newbie.webp')

  // Capítulos: em ordem crescente, sem repetir número, com o link montado
  const capitulos = extrairCapitulosNato(fixture('manganato-capitulos.json'), `${NATO}/manga/solo-max-level-newbie`)
  assert.equal(capitulos[0].numero, 0)
  assert.deepEqual(capitulos.at(-1), {
    numero: 285,
    titulo: 'Chapter 285',
    url: 'https://www.manganato.gg/manga/solo-max-level-newbie/chapter-285',
  })
  assert.equal(new Set(capitulos.map((c) => c.numero)).size, capitulos.length)

  // Páginas: servidor + caminho, na ordem
  const paginas = extrairPaginasNato(fixture('manganato-capitulo.html'))
  assert.equal(paginas[0], 'https://img-r1.2xstorage.com/solo-max-level-newbie/285/0.webp')
  assert.equal(paginas[1], 'https://img-r1.2xstorage.com/solo-max-level-newbie/285/1.webp')
  assert.ok(paginas.length > 10)

  // Servidor sem a barra no fim (Transcension Academy, capítulo 147, 2026-11):
  // antes saía "https://imgs-2.2xstorage.comtranscension-academy/..."
  const semBarra = extrairPaginasNato(
    'var cdns = ["https:\\/\\/imgs-2.2xstorage.com"]\nvar chapterImages = ["transcension-academy\\/147\\/0.webp"]',
  )
  assert.deepEqual(semBarra, ['https://imgs-2.2xstorage.com/transcension-academy/147/0.webp'])
})

test('manganato: o endereço da obra sai do nome', () => {
  const adaptador = criarAdaptador({ slug: 'manganato', adaptador: 'manganato', dominios: ['www.manganato.gg'] }, async () => '')

  assert.deepEqual(adaptador.urlsProvaveis?.('Solo Max-Level Newbie'), ['https://www.manganato.gg/manga/solo-max-level-newbie'])
  assert.deepEqual(adaptador.urlsProvaveis?.("God's Desire Game"), [
    'https://www.manganato.gg/manga/gods-desire-game',
    'https://www.manganato.gg/manga/god-s-desire-game',
  ])
})

test('themesia: busca, obra, capítulos e páginas', () => {
  // Busca
  const resultados = extrairBuscaThemesia(fixture('themesia-busca.html'), KOS)
  assert.equal(resultados[0].titulo, 'Dungeon Odyssey')
  assert.equal(resultados[0].url, 'https://kingofshojo.com/manga/dungeon-odyssey/')
  assert.ok(resultados[0].capaUrl?.includes('kingofshojo.com/wp-content/uploads/'))

  // Obra
  const obra = extrairObraThemesia(fixture('themesia-obra.html'), KOS)
  assert.equal(obra.titulo, 'Dungeon Odyssey')
  assert.deepEqual(obra.titulosAlternativos, ['Records of Dungeon Travel', '던전 견문록'])

  // Capítulos
  const capitulos = extrairCapitulosThemesia(fixture('themesia-obra.html'), KOS)
  assert.deepEqual(capitulos.at(-1), {
    numero: 178,
    titulo: 'Chapter 178',
    url: 'https://kingofshojo.com/dungeon-odyssey-chapter-178/',
  })
  assert.equal(new Set(capitulos.map((c) => c.numero)).size, capitulos.length)

  // Páginas
  const paginas = extrairPaginasThemesia(fixture('themesia-capitulo.html'))
  assert.equal(paginas.length, 138)
  assert.equal(paginas[0], 'https://cdn.kingofshojo.com/king-bucket/145170/177/3776c7e3e6d9.webp')
})

test('manhua top: busca, obra, capítulos (uma página) e páginas', () => {
  const TOP = 'https://manhuatop.org'

  // Busca
  const resultados = extrairBuscaManhuatop(fixture('manhuatop-busca.html'), TOP)
  assert.deepEqual(resultados[0], {
    titulo: 'The Tutorial is Too Hard',
    url: 'https://manhuatop.org/manhua/the-tutorial-is-too-hard-mh/',
    capaUrl: 'https://cache.manhuatop.org/images/2021/08/post_77752_image.jpg',
  })

  // Obra (a página da aba de capítulos também traz título e outros nomes)
  const obra = extrairObraManhuatop(fixture('manhuatop-obra.html'), TOP)
  assert.equal(obra.titulo, 'The Tutorial is Too Hard')
  assert.ok(obra.titulosAlternativos.includes('The Tutorial Is Too Tough!'))

  // Capítulos: 50 por página, e o site avisa que tem mais
  const { capitulos, temMais } = extrairCapitulosManhuatop(fixture('manhuatop-obra.html'), TOP)
  const numeros = new Set(capitulos.map((c) => c.numero))
  assert.ok(numeros.has(297) && numeros.has(248))
  assert.equal(temMais, true)
  assert.equal(
    capitulos.find((c) => c.numero === 297)?.url,
    'https://manhuatop.org/manhua/the-tutorial-is-too-hard-mh/chapter-297/',
  )

  // Páginas, na ordem do índice
  const paginas = extrairPaginasManhuatop(fixture('manhuatop-capitulo.html'))
  assert.equal(paginas.length, 81)
  assert.ok(paginas[0].endsWith('/chapter-297/ch-297-img-1.jpg'))
  assert.ok(paginas[80].endsWith('/chapter-297/ch-297-img-81.jpg'))
})

test('manhua top: capítulo antigo repostado com outro número não conta como novo', () => {
  // Como estava em The Beginning After the End (2026-11): "Chapter 266 - 223"
  // é o capítulo 223 de novo. "Chapter 10 - 11" é capítulo duplo e vale.
  const item = (slug: string, titulo: string) =>
    `{\\"id\\":\\"1\\",\\"mangaId\\":\\"1\\",\\"volumeId\\":null,\\"slug\\":\\"${slug}\\",\\"title\\":\\"${titulo}\\",\\"extra\\":\\"\\",\\"date\\":\\"2026-08-07\\",\\"path\\":\\"/manhua/obra/${slug}/\\"}`
  const html = [
    item('chapter-280-237', 'Chapter 280 - 237'),
    item('chapter-266-223', 'Chapter 266 - 223'),
    item('chapter-259', 'Chapter 259'),
    item('chapter-10-11', 'Chapter 10 - 11'),
  ].join(',')

  const { capitulos } = extrairCapitulosManhuatop(html, 'https://manhuatop.org')
  assert.deepEqual(
    capitulos.map((c) => c.numero),
    [259, 10],
  )
})

test('site com motor desconhecido dá erro claro', () => {
  assert.throws(() => criarAdaptador({ slug: 'x', adaptador: 'nao-existe', dominios: ['x.com'] }, async () => ''), /Ainda não existe adaptador/)
})
