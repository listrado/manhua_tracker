// Busca automática de links (fase 3): para cada obra que apareceu num site e
// ainda não tem fonte nele, procura pelo nome e decide (regra em lib/decidir.ts).
//
// Não grava no banco. Gera:
//   dados/fontes-<site>.sql     -> vínculos certos (fontes) e dúvidas (candidatos)
//   dados/fontes-<site>.md      -> resumo para conferir
//
// As respostas da busca ficam em dados/cache/, então rodar de novo não repete
// os pedidos já feitos ao site.
//
// Uso: node resolver-fontes.ts manhuaplus [limite]
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Adaptador, ResultadoBusca } from '../supabase/functions/_shared/adaptadores/tipos.ts'
import { CAMPOS_SITE, montarAdaptador, type Site } from './lib/adaptadores.ts'
import { ler, PASTA_DADOS, sqlNumero, sqlTexto } from './lib/banco.ts'
import { decidir, termosDeBusca, type Decisao } from './lib/decidir.ts'

type Obra = { id: number; titulo: string; titulos_alternativos: string[] }

// Busca com cache em disco: a chave é o site + o termo.
async function buscarComCache(adaptador: Adaptador, termo: string): Promise<ResultadoBusca[]> {
  const pasta = join(PASTA_DADOS, 'cache', adaptador.slug)
  mkdirSync(pasta, { recursive: true })
  const arquivo = join(pasta, `busca-${createHash('sha1').update(termo.toLowerCase()).digest('hex').slice(0, 16)}.json`)

  if (existsSync(arquivo)) {
    return (JSON.parse(readFileSync(arquivo, 'utf8')) as { resultados: ResultadoBusca[] }).resultados
  }

  const resultados = await adaptador.buscar(termo)
  writeFileSync(arquivo, JSON.stringify({ termo, resultados }, null, 2), 'utf8')
  return resultados
}

async function principal() {
  const slug = process.argv[2]
  const limite = Number(process.argv[3] ?? Infinity)
  if (!slug) throw new Error('Informe o site. Ex.: node resolver-fontes.ts manhuaplus')

  // 1. Lê o site, as obras, de qual site cada obra veio e as fontes já vinculadas
  const [site] = await ler<Site>('sites', `slug=eq.${slug}&select=${CAMPOS_SITE}`)
  if (!site) throw new Error(`Site "${slug}" não está cadastrado em manhua.sites`)

  const obras = await ler<Obra>('obras', 'select=id,titulo,titulos_alternativos&order=id')
  const origens = await ler<{ obra_id: number }>('importacao', `site_slug=eq.${slug}&obra_id=not.is.null&select=obra_id`)
  const fontes = await ler<{ obra_id: number }>('fontes', `site_id=eq.${site.id}&select=obra_id`)

  // 2. Fica só com as obras que apareceram neste site e ainda não têm fonte nele
  const vieramDoSite = new Set(origens.map((o) => o.obra_id))
  const jaTemFonte = new Set(fontes.map((f) => f.obra_id))
  const pendentes = obras.filter((o) => vieramDoSite.has(o.id) && !jaTemFonte.has(o.id)).slice(0, limite)
  console.log(`${slug}: ${pendentes.length} obras para procurar`)

  // 3. Procura cada uma; para na primeira tentativa que der resultado útil
  const { adaptador } = montarAdaptador(site)
  const decisoes: { obra: Obra; decisao: Decisao; termo: string }[] = []
  const erros: { obra: Obra; erro: string }[] = []

  for (const [indice, obra] of pendentes.entries()) {
    const nomes = [obra.titulo, ...obra.titulos_alternativos]
    let decisao: Decisao = { tipo: 'nada' }
    let termoUsado = obra.titulo

    try {
      for (const termo of termosDeBusca(obra.titulo, obra.titulos_alternativos)) {
        const tentativa = decidir(nomes, await buscarComCache(adaptador, termo))
        termoUsado = termo

        // Guarda a melhor situação vista: vincular > confirmar > nada
        if (tentativa.tipo === 'vincular' || (tentativa.tipo === 'confirmar' && decisao.tipo === 'nada')) {
          decisao = tentativa
        }
        if (decisao.tipo === 'vincular') break
      }

      // Último recurso: a busca do site não achou nada, tenta o endereço direto.
      // Se a página existir (não der 404), é a obra: o endereço saiu do nome dela.
      if (decisao.tipo === 'nada' && adaptador.urlProvavel) {
        const url = adaptador.urlProvavel(obra.titulo)
        try {
          const dados = await adaptador.lerObra(url)
          decisao = { tipo: 'vincular', escolhido: { titulo: dados.titulo, url, capaUrl: dados.capaUrl, score: 1 } }
          termoUsado = url
        } catch {
          // Página não existe: continua sem resultado
        }
      }
      decisoes.push({ obra, decisao, termo: termoUsado })
    } catch (erro) {
      erros.push({ obra, erro: erro instanceof Error ? erro.message : String(erro) })
    }

    if ((indice + 1) % 20 === 0) console.log(`  ${indice + 1}/${pendentes.length}`)
  }

  // 4. Monta o SQL
  const sql: string[] = ['begin;', '']
  for (const { obra, decisao } of decisoes) {
    if (decisao.tipo === 'vincular') {
      sql.push(
        `insert into manhua.fontes (obra_id, site_id, url_obra, prioridade) values (${obra.id}, ${site.id}, ${sqlTexto(decisao.escolhido.url)}, 1) on conflict (obra_id, site_id) do nothing;`,
      )
    }

    if (decisao.tipo === 'confirmar') {
      for (const c of decisao.candidatos) {
        sql.push(
          `insert into manhua.candidatos (obra_id, site_id, titulo_encontrado, url, capa_url, score) values (${obra.id}, ${site.id}, ${sqlTexto(c.titulo)}, ${sqlTexto(c.url)}, ${sqlTexto(c.capaUrl)}, ${sqlNumero(Number(c.score.toFixed(4)))}) on conflict (obra_id, site_id, url) do nothing;`,
        )
      }
    }
  }
  sql.push('', 'commit;', '')
  writeFileSync(join(PASTA_DADOS, `fontes-${slug}.sql`), sql.join('\n'), 'utf8')

  // 5. Monta o resumo
  const vinculadas = decisoes.filter((d) => d.decisao.tipo === 'vincular')
  const duvidas = decisoes.filter((d) => d.decisao.tipo === 'confirmar')
  const nada = decisoes.filter((d) => d.decisao.tipo === 'nada')

  const md: string[] = [`# Busca de links — ${slug}`, '']
  md.push(`- Procuradas: **${pendentes.length}**`)
  md.push(`- Vinculadas sozinhas: **${vinculadas.length}**`)
  md.push(`- Para confirmar: **${duvidas.length}**`)
  md.push(`- Sem resultado: **${nada.length}**`)
  md.push(`- Erros: **${erros.length}**`, '')

  md.push('## Para confirmar', '')
  for (const { obra, decisao } of duvidas) {
    if (decisao.tipo !== 'confirmar') continue
    md.push(`- **${obra.titulo}**`)
    for (const c of decisao.candidatos) md.push(`  - ${c.score.toFixed(2)} — [${c.titulo}](${c.url})`)
  }

  md.push('', '## Sem resultado', '')
  for (const { obra } of nada) md.push(`- ${obra.titulo}`)

  md.push('', '## Erros', '')
  for (const { obra, erro } of erros) md.push(`- ${obra.titulo}: ${erro}`)

  md.push('', '## Vinculadas', '', '| Obra | Encontrado | Score | Link |', '| --- | --- | ---: | --- |')
  for (const { obra, decisao } of vinculadas) {
    if (decisao.tipo !== 'vincular') continue
    const e = decisao.escolhido
    md.push(`| ${obra.titulo.replace(/\|/g, '\\|')} | ${e.titulo.replace(/\|/g, '\\|')} | ${e.score.toFixed(2)} | ${e.url} |`)
  }
  writeFileSync(join(PASTA_DADOS, `fontes-${slug}.md`), md.join('\n') + '\n', 'utf8')

  console.log(`Vinculadas: ${vinculadas.length} | confirmar: ${duvidas.length} | sem resultado: ${nada.length} | erros: ${erros.length}`)
  console.log(`Gerados: dados/fontes-${slug}.sql e dados/fontes-${slug}.md`)
}

await principal()
