// Testes do adaptador do ManhuaPlus contra HTML salvo do site real (fixtures).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  criarManhuaplus,
  extrairBusca,
  extrairCapitulos,
  extrairChapterId,
  extrairObra,
  extrairPaginas,
} from '../../supabase/functions/_shared/adaptadores/manhuaplus.ts'
import { ErroDesafioCloudflare, numeroDoCapitulo } from '../../supabase/functions/_shared/adaptadores/tipos.ts'

const BASE = 'https://manhuaplus.org'
const PASTA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'functions', '_shared', 'adaptadores', 'fixtures')
const fixture = (nome: string) => readFileSync(join(PASTA, nome), 'utf8')

test('número do capítulo: decimal, hífen e ponto', () => {
  assert.equal(numeroDoCapitulo('Chapter 118.5'), 118.5)
  assert.equal(numeroDoCapitulo('https://x/manga/y/chapter-119-5'), 119.5)
  assert.equal(numeroDoCapitulo('Chapter 1.1'), 1.1)
  assert.equal(numeroDoCapitulo('Prologue'), null)
})

test('busca: devolve título, link e capa', () => {
  const resultados = extrairBusca(fixture('manhuaplus-busca.html'), BASE)

  assert.ok(resultados.length >= 1)
  assert.deepEqual(resultados[0], {
    titulo: 'Dungeon Odyssey',
    url: 'https://manhuaplus.org/manga/dungeon-odyssey',
    capaUrl: 'https://manhuaplus.org/uploads/covers/dungeon-odyssey.jpg',
  })
})

test('obra: título, capa e outros nomes', () => {
  const obra = extrairObra(fixture('manhuaplus-obra.html'), BASE)

  assert.equal(obra.titulo, 'Dungeon Odyssey')
  assert.equal(obra.capaUrl, 'https://manhuaplus.org/uploads/covers/dungeon-odyssey.jpg')
  assert.ok(obra.titulosAlternativos.includes('Dungeon Experience Book'))
  assert.ok(obra.titulosAlternativos.includes("Mémoires d'un Donjon"))
})

test('capítulos: sem repetição, em ordem crescente', () => {
  const capitulos = extrairCapitulos(fixture('manhuaplus-obra.html'), BASE)

  assert.equal(capitulos[0].numero, 1)
  assert.deepEqual(capitulos.at(-1), {
    numero: 137,
    titulo: 'Chapter 137',
    url: 'https://manhuaplus.org/manga/dungeon-odyssey/chapter-137',
  })
  assert.equal(new Set(capitulos.map((c) => c.numero)).size, capitulos.length)
})

test('páginas: id do capítulo e imagens na ordem do data-index', () => {
  assert.equal(extrairChapterId(fixture('manhuaplus-capitulo.html')), '90615')

  const paginas = extrairPaginas(fixture('manhuaplus-paginas.json'))
  assert.equal(paginas.length, 11)
  // No arquivo salvo os blocos vêm na ordem 9,1,7,4,...; o índice 0 é a primeira página
  assert.equal(paginas[0], 'https://cdn.manhuaplus.cc/2025/11/25/11-43-50-474248527548013.webp')
  assert.equal(paginas[1], 'https://cdn.manhuaplus.cc/2025/11/25/11-43-55-474253806268043.webp')
  assert.equal(paginas[10], 'https://cdn.manhuaplus.cc/2025/11/25/11-44-38-474297263752054.webp')
  assert.ok(paginas.every((url) => url.startsWith('https://cdn.manhuaplus.cc/')))
})

test('desafio do Cloudflare vira erro próprio, sem tentar burlar', async () => {
  const adaptador = criarManhuaplus(BASE, async () => '<html><head><title>Just a moment...</title></head></html>')
  await assert.rejects(() => adaptador.buscar('qualquer'), ErroDesafioCloudflare)
})
