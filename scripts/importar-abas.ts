// Importação da lista inicial de abas (fase 2).
//
// Lê dados/abas.txt e gera DOIS arquivos, sem tocar no banco:
//   dados/relatorio-importacao.md  -> para o usuário conferir
//   dados/importacao.sql           -> o que será gravado, depois da conferência
//
// O SQL pode ser aplicado mais de uma vez sem duplicar nada:
//   supabase db query --linked -f dados/importacao.sql
//
// Uso: npm run importar   (dentro da pasta scripts)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agruparObras, LIMITE_DUVIDA, LIMITE_JUNTAR, type CasoDuvidoso, type ObraImportada } from './lib/agrupar.ts'
import { extrairLinha, lerArquivoDeAbas, type LinhaExtraida } from './lib/extrair.ts'

const PASTA_DADOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'dados')
const ARQUIVO_ABAS = join(PASTA_DADOS, 'abas.txt')

// Texto e número como literais SQL seguros.
function sqlTexto(valor: string | null): string {
  return valor === null ? 'null' : `'${valor.replace(/'/g, "''")}'`
}

function sqlNumero(valor: number | null): string {
  return valor === null ? 'null' : String(valor)
}

function sqlLista(valores: string[]): string {
  return valores.length === 0 ? `'{}'::text[]` : `array[${valores.map(sqlTexto).join(', ')}]::text[]`
}

function montarSql(linhas: LinhaExtraida[], obras: ObraImportada[]): string {
  const partes: string[] = ['begin;', '']

  // 1. Obras: só cria a que ainda não existe (compara pelo título normalizado)
  for (const obra of obras) {
    partes.push(
      `insert into manhua.obras (titulo, titulos_alternativos, status, capitulo_atual)`,
      `select ${sqlTexto(obra.titulo)}, ${sqlLista(obra.titulosAlternativos)}, ${sqlTexto(obra.status)}, ${sqlNumero(obra.capituloAtual)}`,
      ` where not exists (select 1 from manhua.obras where titulo_normalizado = manhua.normalizar_titulo(${sqlTexto(obra.titulo)}));`,
    )
  }
  partes.push('')

  // 2. Linhas brutas: uma por aba, ligada à obra em que caiu
  const obraDaLinha = new Map<number, ObraImportada>()
  for (const obra of obras) {
    for (const numero of obra.linhas) obraDaLinha.set(numero, obra)
  }

  for (const linha of linhas) {
    const obra = obraDaLinha.get(linha.linhaNumero)
    const obraId = obra
      ? `(select id from manhua.obras where titulo_normalizado = manhua.normalizar_titulo(${sqlTexto(obra.titulo)}))`
      : 'null'

    partes.push(
      `insert into manhua.importacao (linha_numero, linha_original, titulo_extraido, capitulo, site_slug, descartada, motivo, obra_id)`,
      `values (${linha.linhaNumero}, ${sqlTexto(linha.original)}, ${sqlTexto(linha.titulo)}, ${sqlNumero(linha.capitulo)}, ${sqlTexto(linha.siteSlug)}, ${linha.descartada}, ${sqlTexto(linha.motivo)}, ${obraId})`,
      `on conflict (linha_numero) do update set linha_original = excluded.linha_original, titulo_extraido = excluded.titulo_extraido,`,
      `  capitulo = excluded.capitulo, site_slug = excluded.site_slug, descartada = excluded.descartada, motivo = excluded.motivo, obra_id = excluded.obra_id;`,
    )
  }

  partes.push('', 'commit;', '')
  return partes.join('\n')
}

function montarRelatorio(linhas: LinhaExtraida[], obras: ObraImportada[], duvidosos: CasoDuvidoso[]): string {
  const descartadas = linhas.filter((l) => l.descartada)
  const juntadas = obras.filter((o) => o.linhas.length > 1)
  const r: string[] = []

  // Resumo
  r.push('# Relatório da importação', '')
  r.push(`- Linhas lidas: **${linhas.length}**`)
  r.push(`- Descartadas: **${descartadas.length}**`)
  r.push(`- Obras criadas: **${obras.length}**`)
  r.push(`  - lendo: ${obras.filter((o) => o.status === 'lendo').length}`)
  r.push(`  - para ler depois: ${obras.filter((o) => o.status === 'nao_iniciada').length}`)
  r.push(`- Obras que juntaram mais de uma aba: **${juntadas.length}**`)
  r.push(`- Casos duvidosos (semelhança entre ${LIMITE_DUVIDA} e ${LIMITE_JUNTAR}): **${duvidosos.length}**`, '')

  // Abas por site
  const porSite = new Map<string, number>()
  for (const l of linhas.filter((x) => !x.descartada)) {
    const chave = l.siteSlug ?? '(site desconhecido)'
    porSite.set(chave, (porSite.get(chave) ?? 0) + 1)
  }
  r.push('## Abas por site', '', '| Site | Abas |', '| --- | ---: |')
  for (const [site, total] of [...porSite.entries()].sort((a, b) => b[1] - a[1])) {
    r.push(`| ${site} | ${total} |`)
  }
  r.push('')

  // Casos duvidosos
  r.push('## Casos duvidosos — são a mesma obra?', '')
  if (duvidosos.length === 0) r.push('Nenhum.')
  for (const d of duvidosos) {
    r.push(`- [ ] **${d.a}** × **${d.b}** (${d.score.toFixed(2)})`)
  }
  r.push('')

  // Descartadas, por motivo
  r.push('## Linhas descartadas', '')
  const motivos = [...new Set(descartadas.map((l) => l.motivo ?? ''))]
  for (const motivo of motivos) {
    const doMotivo = descartadas.filter((l) => l.motivo === motivo)
    r.push(`### ${motivo} (${doMotivo.length})`, '')
    for (const l of doMotivo) r.push(`- linha ${l.linhaNumero}: \`${l.original}\``)
    r.push('')
  }

  // Obras juntadas
  r.push('## Obras que juntaram mais de uma aba', '')
  for (const o of juntadas) {
    const outros = o.titulosAlternativos.length > 0 ? ` — também como: ${o.titulosAlternativos.join('; ')}` : ''
    r.push(`- **${o.titulo}** (${o.linhas.length} abas, cap. ${o.capituloAtual ?? '—'})${outros}`)
  }
  r.push('')

  // Lista completa
  r.push('## Todas as obras', '', '| Obra | Status | Cap. atual | Sites |', '| --- | --- | ---: | --- |')
  for (const o of [...obras].sort((a, b) => a.titulo.localeCompare(b.titulo))) {
    r.push(`| ${o.titulo.replace(/\|/g, '\\|')} | ${o.status} | ${o.capituloAtual ?? '—'} | ${o.sites.join(', ') || '—'} |`)
  }
  r.push('')

  return r.join('\n')
}

// dados/juntar.txt (opcional): grupos de nomes que o usuário confirmou serem a
// mesma obra. Um grupo por linha, nomes separados por " = ".
function lerJuntar(): string[][] {
  const arquivo = join(PASTA_DADOS, 'juntar.txt')
  if (!existsSync(arquivo)) return []

  return readFileSync(arquivo, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => l.split(/\s+=\s+/).map((nome) => nome.trim()))
}

function principal() {
  // O arquivo é colocado pelo usuário; sem ele não há o que importar
  if (!existsSync(ARQUIVO_ABAS)) {
    console.error(`Arquivo não encontrado: ${ARQUIVO_ABAS}\nSalve a lista de abas exportada nesse caminho e rode de novo.`)
    process.exit(1)
  }

  // Extrai nome, capítulo e site de cada aba e junta as duplicadas
  const titulos = lerArquivoDeAbas(readFileSync(ARQUIVO_ABAS, 'utf8'))
  const linhas = titulos.map((titulo, indice) => extrairLinha(titulo, indice + 1))
  const { obras, duvidosos } = agruparObras(linhas, lerJuntar())

  // Grava o relatório e o SQL
  writeFileSync(join(PASTA_DADOS, 'relatorio-importacao.md'), montarRelatorio(linhas, obras, duvidosos), 'utf8')
  writeFileSync(join(PASTA_DADOS, 'importacao.sql'), montarSql(linhas, obras), 'utf8')

  console.log(`Linhas: ${linhas.length} | descartadas: ${linhas.filter((l) => l.descartada).length} | obras: ${obras.length} | duvidosos: ${duvidosos.length}`)
  console.log('Gerados: dados/relatorio-importacao.md e dados/importacao.sql')
}

principal()
