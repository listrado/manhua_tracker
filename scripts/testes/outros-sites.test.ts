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

test('site com motor desconhecido dá erro claro', () => {
  assert.throws(() => criarAdaptador({ slug: 'x', adaptador: 'nao-existe', dominios: ['x.com'] }, async () => ''), /Ainda não existe adaptador/)
})
