// Para cada obra já vinculada a um site: lê a página da obra e traz os outros
// nomes, a lista de capítulos e a capa (reduzida para miniatura).
//
// Não grava no banco. Gera:
//   dados/capas/<obra_id>.webp          -> miniaturas, para subir ao Storage
//   dados/sincronizar-<site>-NN.sql     -> capítulos, capa e outros nomes
//
// Uso: node sincronizar-obras.ts manhuaplus [limite]
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { CAMPOS_SITE, montarAdaptador, type Site } from './lib/adaptadores.ts'
import { ler, PASTA_DADOS, sqlLista, sqlNumero, sqlTexto } from './lib/banco.ts'
import { normalizarTitulo } from './lib/titulos.ts'

type Obra = { id: number; titulo: string; titulos_alternativos: string[]; capa_path: string | null }
type Fonte = { id: number; obra_id: number; url_obra: string }

// Miniatura: 300 px de largura em WebP. Alvo da especificação: até 60 KB.
const LARGURA_CAPA = 300
const LIMITE_CAPA_BYTES = 60 * 1024
// Cada arquivo .sql fica pequeno o bastante para a API do Supabase aceitar.
const LIMITE_SQL_BYTES = 300 * 1024
// Nomes alternativos guardados por obra (os sites listam dezenas, em várias línguas).
const MAXIMO_ALTERNATIVOS = 15

async function gerarMiniatura(original: Buffer): Promise<Buffer> {
  // Baixa a qualidade até caber no limite
  for (const qualidade of [78, 65, 50, 35]) {
    const miniatura = await sharp(original).resize({ width: LARGURA_CAPA, withoutEnlargement: true }).webp({ quality: qualidade }).toBuffer()
    if (miniatura.length <= LIMITE_CAPA_BYTES) return miniatura
  }
  throw new Error('capa não coube em 60 KB')
}

// Junta os nomes já conhecidos com os do site, sem repetir (compara normalizado).
function juntarNomes(obra: Obra, tituloNoSite: string, alternativosDoSite: string[]): string[] {
  const vistos = new Set([normalizarTitulo(obra.titulo)])
  const nomes: string[] = []

  for (const nome of [...obra.titulos_alternativos, tituloNoSite, ...alternativosDoSite]) {
    const chave = normalizarTitulo(nome) || nome
    if (vistos.has(chave)) continue

    vistos.add(chave)
    nomes.push(nome)
  }

  return nomes.slice(0, MAXIMO_ALTERNATIVOS)
}

async function principal() {
  const slug = process.argv[2]
  const limite = Number(process.argv[3] ?? Infinity)
  if (!slug) throw new Error('Informe o site. Ex.: node sincronizar-obras.ts manhuaplus')

  // 1. Lê o site, as fontes dele e as obras
  const [site] = await ler<Site>('sites', `slug=eq.${slug}&select=${CAMPOS_SITE}`)
  if (!site) throw new Error(`Site "${slug}" não está cadastrado em manhua.sites`)

  const fontes = (await ler<Fonte>('fontes', `site_id=eq.${site.id}&ativa=is.true&select=id,obra_id,url_obra&order=id`)).slice(0, limite)
  const obras = new Map((await ler<Obra>('obras', 'select=id,titulo,titulos_alternativos,capa_path')).map((o) => [o.id, o]))
  console.log(`${slug}: ${fontes.length} obras para sincronizar`)

  // 2. Prepara as pastas e apaga os .sql de uma execução anterior
  const pastaCapas = join(PASTA_DADOS, 'capas')
  mkdirSync(pastaCapas, { recursive: true })
  for (const antigo of readdirSync(PASTA_DADOS).filter((f) => f.startsWith(`sincronizar-${slug}-`))) {
    rmSync(join(PASTA_DADOS, antigo))
  }

  const { adaptador, rede } = montarAdaptador(site)
  const blocos: string[] = []
  const erros: string[] = []
  let totalCapitulos = 0
  let totalCapas = 0

  // 3. Uma obra por vez
  for (const [indice, fonte] of fontes.entries()) {
    const obra = obras.get(fonte.obra_id)
    if (!obra) continue

    try {
      // Dados e capítulos saem da mesma página (o segundo pedido vem do cache)
      const dados = await adaptador.lerObra(fonte.url_obra)
      const capitulos = await adaptador.listarCapitulos(fonte.url_obra)
      const sql: string[] = []

      // Capa: só baixa se a obra ainda não tem
      let capaPath = obra.capa_path
      const arquivoCapa = join(pastaCapas, `${obra.id}.webp`)
      if (!capaPath && dados.capaUrl) {
        try {
          if (!existsSync(arquivoCapa)) {
            writeFileSync(arquivoCapa, await gerarMiniatura(await rede.baixar(dados.capaUrl, site.referer ?? undefined)))
          }
          capaPath = `${obra.id}.webp`
          totalCapas++
        } catch (erro) {
          erros.push(`${obra.titulo}: capa — ${erro instanceof Error ? erro.message : erro}`)
        }
      }

      // Obra: outros nomes, capa e total de capítulos (nunca diminui)
      const ultimo = capitulos.at(-1)?.numero ?? null
      sql.push(
        `update manhua.obras set titulos_alternativos = ${sqlLista(juntarNomes(obra, dados.titulo, dados.titulosAlternativos))}, capa_path = coalesce(capa_path, ${sqlTexto(capaPath)}), total_capitulos = greatest(coalesce(total_capitulos, 0), ${sqlNumero(ultimo ?? 0)}), sem_fonte = false where id = ${obra.id};`,
      )

      if (capitulos.length > 0) {
        const valores = capitulos.map((c) => `(${c.numero}, ${sqlTexto(c.titulo)}, ${sqlTexto(c.url)})`).join(', ')

        // Capítulos: os que estão até o capítulo atual da obra já entram como lidos
        sql.push(
          `insert into manhua.capitulos (obra_id, numero, titulo, lido) select ${obra.id}, v.n, v.t, v.n <= coalesce((select capitulo_atual from manhua.obras where id = ${obra.id}), -1) from (values ${valores}) as v(n, t, u) on conflict (obra_id, numero) do nothing;`,
        )

        // Link de cada capítulo nesta fonte
        sql.push(
          `insert into manhua.capitulos_fonte (capitulo_id, fonte_id, url) select c.id, ${fonte.id}, v.u from (values ${valores}) as v(n, t, u) join manhua.capitulos c on c.obra_id = ${obra.id} and c.numero = v.n on conflict (capitulo_id, fonte_id) do update set url = excluded.url;`,
        )
      }

      // Fonte: último capítulo visto e quando
      sql.push(`update manhua.fontes set ultimo_capitulo = ${sqlNumero(ultimo)}, verificado_em = now(), erro_ultimo = null where id = ${fonte.id};`)

      blocos.push(sql.join('\n'))
      totalCapitulos += capitulos.length
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro)
      erros.push(`${obra.titulo}: ${mensagem}`)
      blocos.push(`update manhua.fontes set erro_ultimo = ${sqlTexto(mensagem)}, verificado_em = now() where id = ${fonte.id};`)
    }

    if ((indice + 1) % 20 === 0) console.log(`  ${indice + 1}/${fontes.length}`)
  }

  // 4. Grava o SQL em arquivos pequenos, cada um numa transação
  let parte: string[] = []
  let tamanho = 0
  let numero = 0
  const fechar = () => {
    if (parte.length === 0) return
    numero++
    writeFileSync(join(PASTA_DADOS, `sincronizar-${slug}-${String(numero).padStart(2, '0')}.sql`), `begin;\n\n${parte.join('\n\n')}\n\ncommit;\n`, 'utf8')
    parte = []
    tamanho = 0
  }
  for (const bloco of blocos) {
    if (tamanho + bloco.length > LIMITE_SQL_BYTES) fechar()
    parte.push(bloco)
    tamanho += bloco.length
  }
  fechar()

  console.log(`Capítulos: ${totalCapitulos} | capas novas: ${totalCapas} | erros: ${erros.length} | arquivos .sql: ${numero}`)
  for (const erro of erros) console.log(`  ERRO ${erro}`)
}

await principal()
