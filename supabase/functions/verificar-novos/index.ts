// Edge Function: verifica se saiu capítulo novo nas obras em leitura.
//
// Chamada pelo agendamento do banco (pg_cron) à meia-noite e ao meio-dia de
// Brasília, a cada 2 minutos durante uma hora. Cada chamada trata UM lote
// pequeno, para caber nos limites da função (150 s e 2 s de CPU); o banco
// entrega sempre as obras há mais tempo sem verificação, então as chamadas
// seguidas continuam de onde a anterior parou.
//
// Não usa chave de administrador: lê e grava pelas funções do banco
// verificacao_lote e verificacao_registrar, que exigem o segredo interno.
import { criarAdaptador } from '../_shared/adaptadores/indice.ts'
import { ErroDesafioCloudflare, type Adaptador, type Http } from '../_shared/adaptadores/tipos.ts'

const TAMANHO_DO_LOTE = 12
// Para de pegar obra nova quando a chamada já gastou este tempo.
const TEMPO_MAXIMO_MS = 110_000

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

type ItemDoLote = {
  fonte_id: number
  obra_id: number
  url_obra: string
  site_slug: string
  dominios: string[]
  adaptador: string
  intervalo_ms: number
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))

// Um acesso por site, com intervalo entre os pedidos ao mesmo site. Sem rajadas.
const ultimoPedidoPorSite = new Map<string, number>()

function criarHttp(site: string, intervaloMs: number): Http {
  return async (url, pedido = {}) => {
    // Respeita o intervalo desde o pedido anterior a este site
    const falta = (ultimoPedidoPorSite.get(site) ?? 0) + intervaloMs - Date.now()
    if (falta > 0) await esperar(falta)
    ultimoPedidoPorSite.set(site, Date.now())

    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' }
    if (pedido.referer) headers.Referer = pedido.referer
    if (pedido.ajax) headers['X-Requested-With'] = 'XMLHttpRequest'

    const resposta = await fetch(url, { method: pedido.metodo ?? 'GET', headers, signal: AbortSignal.timeout(20_000) })
    const corpo = await resposta.text()
    if (!resposta.ok && resposta.status !== 403) throw new Error(`HTTP ${resposta.status} em ${url}`)
    return corpo
  }
}

function montarAdaptador(item: ItemDoLote): Adaptador {
  return criarAdaptador(
    { slug: item.site_slug, adaptador: item.adaptador, dominios: item.dominios },
    criarHttp(item.site_slug, item.intervalo_ms),
  )
}

// Chama uma função do schema manhua pela API do banco.
async function rpc<T>(nome: string, parametros: Record<string, unknown>): Promise<T> {
  const resposta = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: {
      apikey: Deno.env.get('MANHUA_CHAVE_PUBLICA') ?? '',
      'Content-Type': 'application/json',
      'Content-Profile': 'manhua',
    },
    body: JSON.stringify(parametros),
  })

  if (!resposta.ok) throw new Error(`${nome}: ${resposta.status} ${await resposta.text()}`)
  const texto = await resposta.text()
  return (texto ? JSON.parse(texto) : null) as T
}

Deno.serve(async (pedido) => {
  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

  // Só o agendamento (que conhece o segredo) pode disparar
  const segredo = Deno.env.get('VERIFICAR_SEGREDO') ?? ''
  if (segredo.length < 32 || pedido.headers.get('x-segredo') !== segredo) {
    return json({ erro: 'Não autorizado' }, 401)
  }

  const inicio = Date.now()
  const resumo = { verificadas: 0, com_erro: 0, erros: [] as string[] }

  try {
    // Pede ao banco o próximo lote
    const lote = await rpc<ItemDoLote[]>('verificacao_lote', { p_segredo: segredo, p_lote: TAMANHO_DO_LOTE })

    for (const item of lote) {
      // Sem tempo para mais uma: o que sobrou fica para a próxima chamada
      if (Date.now() - inicio > TEMPO_MAXIMO_MS) break

      try {
        // Para saber se saiu capítulo novo bastam os mais recentes
        const capitulos = await montarAdaptador(item).listarCapitulos(item.url_obra, { soRecentes: true })

        await rpc('verificacao_registrar', {
          p_segredo: segredo,
          p_fonte_id: item.fonte_id,
          p_capitulos: capitulos.map((c) => ({ n: c.numero, t: c.titulo, u: c.url })),
        })
        resumo.verificadas++
      } catch (erro) {
        // Desafio do Cloudflare não é burlado: registra na fonte e segue
        const motivo =
          erro instanceof ErroDesafioCloudflare ? 'bloqueado pelo Cloudflare' : erro instanceof Error ? erro.message : String(erro)

        await rpc('verificacao_registrar', {
          p_segredo: segredo,
          p_fonte_id: item.fonte_id,
          p_capitulos: [],
          p_erro: motivo.slice(0, 500),
        }).catch(() => {})
        resumo.com_erro++
        resumo.erros.push(`fonte ${item.fonte_id}: ${motivo}`)
      }
    }

    return json({ ...resumo, lote: lote.length, segundos: Math.round((Date.now() - inicio) / 1000) })
  } catch (erro) {
    return json({ erro: erro instanceof Error ? erro.message : String(erro) }, 500)
  }
})
