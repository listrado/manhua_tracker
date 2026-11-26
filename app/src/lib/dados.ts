// Leitura dos dados que o leitor usa: a obra, os capítulos e as imagens.
// Com internet, vêm do Supabase; sem internet, da cópia guardada no aparelho
// (só existe para obra que foi baixada para leitura offline).
//
// As leituras daqui não usam as novas tentativas automáticas do Supabase (três,
// esperando 1 s, 2 s e 4 s): sem internet, isso só atrasava a hora de abrir a
// cópia do aparelho. No lugar delas, cada leitura tem um prazo.
import { capitulosDaObra, guardarCapa, guardarObra, lerCapas, lerCapitulo, lerObraGuardada, resumoPorObra } from './offline'
import { comPrazo, ErroSemRede, semConexao } from './rede'
import { lerSenhaGuardada } from './senha'
import { supabase } from './supabase'

// capa_path: cópias guardadas antes de a capa existir aqui não têm o campo
export type ObraLeitor = { id: number; titulo: string; capitulo_atual: number | null; capa_path?: string | null }
export type Capitulo = { id: number; numero: number; titulo: string | null; lido: boolean }

const URL_FUNCOES = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string
export const URL_CAPAS = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/manhua-capas/`

// Prazo para abrir a obra pela rede. Se ela está baixada, a cópia do aparelho
// serve de reserva e o prazo é curto; senão, espera um pouco mais.
const PRAZO_OBRA_COM_COPIA_MS = 6000
const PRAZO_OBRA_SEM_COPIA_MS = 15000
// A lista de imagens de um capítulo passa pelo site de origem, que pode demorar.
const PRAZO_PAGINAS_MS = 30000

async function carregarObraDaRede(obraId: number, sinal: AbortSignal): Promise<ObraLeitor> {
  if (!supabase) throw new Error('Supabase não configurado')

  const { data, error } = await supabase
    .from('obras')
    .select('id,titulo,capitulo_atual,capa_path')
    .eq('id', obraId)
    .abortSignal(sinal)
    .retry(false)
    .single()
  if (error) throw new Error(error.message)
  return data as ObraLeitor
}

// Todos os capítulos da obra, em ordem. A API devolve no máximo 1000 linhas por
// pedido e há obras com mais que isso, então busca em páginas.
async function carregarCapitulosDaRede(obraId: number, sinal: AbortSignal): Promise<Capitulo[]> {
  if (!supabase) throw new Error('Supabase não configurado')
  const capitulos: Capitulo[] = []
  const porPagina = 1000

  for (let inicio = 0; ; inicio += porPagina) {
    const { data, error } = await supabase
      .from('capitulos')
      .select('id,numero,titulo,lido')
      .eq('obra_id', obraId)
      .order('numero')
      .range(inicio, inicio + porPagina - 1)
      .abortSignal(sinal)
      .retry(false)
    if (error) throw new Error(error.message)

    capitulos.push(...(data as Capitulo[]))
    if (data.length < porPagina) return capitulos
  }
}

// A obra e seus capítulos. Sem conexão, abre direto a cópia do aparelho (se a
// obra foi baixada) sem nem tentar a rede. Com conexão, tenta a rede dentro do
// prazo; se não der, cai na cópia (semRede = true).
export async function carregarObraECapitulos(
  obraId: number,
): Promise<{ obra: ObraLeitor; capitulos: Capitulo[]; semRede: boolean }> {
  const guardada = await lerObraGuardada<ObraLeitor, Capitulo>(obraId).catch(() => null)

  if (semConexao()) {
    if (guardada) return { obra: guardada.obra, capitulos: guardada.capitulos, semRede: true }
    throw new ErroSemRede('Sem internet, e esta obra não está baixada no aparelho.')
  }

  try {
    const [obra, capitulos] = await comPrazo(guardada ? PRAZO_OBRA_COM_COPIA_MS : PRAZO_OBRA_SEM_COPIA_MS, (sinal) =>
      Promise.all([carregarObraDaRede(obraId, sinal), carregarCapitulosDaRede(obraId, sinal)]),
    )

    // Obra que já está no aparelho: aproveita para atualizar a cópia guardada
    if (guardada) await guardarObra(obraId, obra, capitulos).catch(() => {})

    return { obra, capitulos, semRede: false }
  } catch (erro) {
    if (guardada) return { obra: guardada.obra, capitulos: guardada.capitulos, semRede: true }
    if (erro instanceof ErroSemRede) throw new ErroSemRede('A internet não respondeu, e esta obra não está baixada no aparelho.')
    throw erro
  }
}

// Baixa a capa da obra e guarda no aparelho, para a biblioteca mostrá-la sem internet.
export async function baixarCapa(obraId: number, capaPath: string): Promise<void> {
  const resposta = await comPrazo(PRAZO_OBRA_SEM_COPIA_MS, (sinal) => fetch(URL_CAPAS + capaPath, { signal: sinal }))
  if (!resposta.ok) throw new Error(`a capa respondeu ${resposta.status}`)

  const dados = await resposta.arrayBuffer()
  await guardarCapa(obraId, { dados, tipo: resposta.headers.get('Content-Type') ?? 'image/jpeg', path: capaPath })
}

// Obras baixadas cuja capa ainda não está no aparelho (baixadas antes de a capa
// ser guardada) ou mudou: guarda a capa delas. Roda com internet, sem pressa.
export async function guardarCapasQueFaltam(obras: { id: number; capa_path: string | null }[]): Promise<void> {
  const baixadas = await resumoPorObra()
  const candidatas = obras.filter((o) => o.capa_path && (baixadas.get(o.id)?.capitulos ?? 0) > 0)
  const guardadas = await lerCapas(candidatas.map((o) => o.id))

  for (const obra of candidatas) {
    if (guardadas.get(obra.id)?.path === obra.capa_path) continue
    await baixarCapa(obra.id, obra.capa_path!).catch(() => {})
  }
}

// Uma página do capítulo, de onde quer que ela venha:
//   rede ...... endereço para mostrar e, quando existir, um segundo caminho
//               (o proxy de imagem) para tentar se o primeiro falhar;
//   aparelho .. a imagem está guardada no aparelho (leitura offline).
export type PaginaCapitulo =
  | { origem: 'rede'; url: string; reserva: string | null }
  | { origem: 'aparelho'; obraId: number; numero: number; indice: number }

type RespostaPaginas = {
  paginas?: string[]
  paginas_proxy?: string[] | null
  precisa_proxy?: boolean
  erro?: string
  falhas?: string[]
}

// Pergunta à Edge Function paginas-capitulo quais são as imagens do capítulo.
// O navegador guarda a resposta por um dia (por isso não desiste antes de
// tentar, mesmo sem conexão: um capítulo aberto há pouco pode vir dessa cópia).
async function pedirPaginas(capituloId: number): Promise<RespostaPaginas & { paginas: string[] }> {
  let resposta: Response
  let corpo: RespostaPaginas
  try {
    ;[resposta, corpo] = await comPrazo(PRAZO_PAGINAS_MS, async (sinal) => {
      const r = await fetch(`${URL_FUNCOES}/paginas-capitulo?capitulo_id=${capituloId}`, { headers: { apikey: CHAVE }, signal: sinal })
      return [r, (await r.json()) as RespostaPaginas] as const
    })
  } catch (erro) {
    // Sem internet o fetch falha na hora (TypeError); sinal fraco estoura o prazo
    if (erro instanceof ErroSemRede || erro instanceof TypeError) throw new ErroSemRede('sem internet, ou ela não respondeu a tempo')
    throw erro
  }

  if (!resposta.ok || !corpo.paginas) {
    throw new Error([corpo.erro ?? `Erro ${resposta.status}`, ...(corpo.falhas ?? [])].join(' — '))
  }
  return { ...corpo, paginas: corpo.paginas }
}

// Páginas de um capítulo, em ordem. Capítulo baixado por completo é lido do
// aparelho, sem nenhum pedido à rede.
export async function carregarPaginas(obraId: number, capitulo: Capitulo): Promise<PaginaCapitulo[]> {
  const guardado = await lerCapitulo(obraId, capitulo.numero).catch(() => null)
  if (guardado?.completo) {
    return Array.from({ length: guardado.total }, (_, indice) => ({ origem: 'aparelho', obraId, numero: capitulo.numero, indice }))
  }

  const corpo = await pedirPaginas(capitulo.id).catch((erro: unknown) => {
    if (erro instanceof ErroSemRede) throw new ErroSemRede('Sem internet (ou ela não respondeu a tempo), e este capítulo não está baixado no aparelho.')
    throw erro
  })
  const proxy = corpo.paginas_proxy ?? null

  return corpo.paginas.map((direta, i) => {
    const peloProxy = proxy?.[i] ?? null

    // Site que exige Referer: só o proxy consegue mostrar, então ele vai primeiro.
    // Nos demais a imagem vem direto do site e o proxy fica de reserva.
    return corpo.precisa_proxy && peloProxy
      ? { origem: 'rede', url: peloProxy, reserva: null }
      : { origem: 'rede', url: direta, reserva: peloProxy }
  })
}

// Endereços para BAIXAR as imagens de um capítulo. Sempre pelo proxy: é ele
// que devolve a permissão (CORS) sem a qual o navegador não deixa guardar a imagem.
export async function carregarEnderecosParaBaixar(capituloId: number): Promise<string[]> {
  const corpo = await pedirPaginas(capituloId)
  if (!corpo.paginas_proxy) throw new Error('O proxy de imagem não está configurado')
  return corpo.paginas_proxy
}

// Números dos capítulos da obra que estão completos no aparelho.
export async function numerosOffline(obraId: number): Promise<Set<number>> {
  const guardados = await capitulosDaObra(obraId).catch(() => new Map())
  return new Set([...guardados.values()].filter((c) => c.completo).map((c) => c.numero))
}

export class ErroSenhaIncorreta extends Error {}

// Marca ou desmarca um capítulo como lido no banco. A senha de acesso vai
// junto: é o banco que decide se a gravação vale.
export async function marcarLido(capituloId: number, lido: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase não configurado')

  const { error } = await supabase.rpc('marcar_lido', {
    p_senha: lerSenhaGuardada() ?? '',
    p_capitulo_id: capituloId,
    p_lido: lido,
    p_em: new Date().toISOString(),
  })

  // 28P01 é o código que a função usa para "senha incorreta"
  if (error?.code === '28P01') throw new ErroSenhaIncorreta(error.message)
  if (error) throw new Error(error.message)
}

// Posição de leitura guardada no aparelho: o capítulo, a imagem dentro dele e
// quanto dessa imagem já tinha passado pelo topo da tela (0 a 1). É o que
// permite voltar ao ponto exato depois de recarregar a página.
// "proporcoes" guarda altura/largura das imagens do capítulo até a que estava
// na tela (null = ainda não tinha carregado). Ao reabrir, o espaço de cada
// imagem já nasce do tamanho certo e a página não se desloca enquanto carregam.
export type Posicao = { numero: number; indice: number; fracao: number; proporcoes?: (number | null)[] }

const chavePosicao = (obraId: number) => `manhua-posicao-${obraId}`

export function lerPosicao(obraId: number): Posicao | null {
  try {
    const valor = localStorage.getItem(chavePosicao(obraId))
    if (valor === null) return null

    // Formato antigo: só o número do capítulo
    const dados = JSON.parse(valor) as Posicao | number
    if (typeof dados === 'number') return { numero: dados, indice: 0, fracao: 0 }
    return Number.isFinite(dados.numero) ? dados : null
  } catch {
    return null
  }
}

export function salvarPosicao(obraId: number, posicao: Posicao) {
  try {
    localStorage.setItem(chavePosicao(obraId), JSON.stringify(posicao))
  } catch {
    // Armazenamento indisponível (aba privada): segue sem lembrar a posição
  }
}

// Modo de marcar como lido, guardado no aparelho: false = só ao tocar no botão
// (padrão), true = sozinho, quando o fim do capítulo passa pela tela.
const CHAVE_MODO = 'manhua-marcar-automatico'

export function lerModoAutomatico(): boolean {
  try {
    return localStorage.getItem(CHAVE_MODO) === 'sim'
  } catch {
    return false
  }
}

export function salvarModoAutomatico(automatico: boolean) {
  try {
    localStorage.setItem(CHAVE_MODO, automatico ? 'sim' : 'nao')
  } catch {
    // Armazenamento indisponível: vale só até fechar a página
  }
}

// Modo "toque para rolar", guardado no aparelho: ligado, um toque na leitura
// desce quase uma tela inteira, em vez de precisar arrastar.
const CHAVE_TOQUE_ROLA = 'manhua-toque-rola'

export function lerToqueRola(): boolean {
  try {
    return localStorage.getItem(CHAVE_TOQUE_ROLA) === 'sim'
  } catch {
    return false
  }
}

export function salvarToqueRola(ligado: boolean) {
  try {
    localStorage.setItem(CHAVE_TOQUE_ROLA, ligado ? 'sim' : 'nao')
  } catch {
    // Armazenamento indisponível: vale só até fechar a página
  }
}
