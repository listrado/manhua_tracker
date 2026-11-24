// Leitura dos dados que o leitor usa: a obra, os capítulos e as imagens.
// Com internet, vêm do Supabase; sem internet, da cópia guardada no aparelho
// (só existe para obra que foi baixada para leitura offline).
import { capitulosDaObra, guardarObra, lerCapitulo, lerObraGuardada } from './offline'
import { lerSenhaGuardada } from './senha'
import { supabase } from './supabase'

export type ObraLeitor = { id: number; titulo: string; capitulo_atual: number | null }
export type Capitulo = { id: number; numero: number; titulo: string | null; lido: boolean }

const URL_FUNCOES = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string

async function carregarObraDaRede(obraId: number): Promise<ObraLeitor> {
  if (!supabase) throw new Error('Supabase não configurado')

  const { data, error } = await supabase.from('obras').select('id,titulo,capitulo_atual').eq('id', obraId).single()
  if (error) throw new Error(error.message)
  return data as ObraLeitor
}

// Todos os capítulos da obra, em ordem. A API devolve no máximo 1000 linhas por
// pedido e há obras com mais que isso, então busca em páginas.
async function carregarCapitulosDaRede(obraId: number): Promise<Capitulo[]> {
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
    if (error) throw new Error(error.message)

    capitulos.push(...(data as Capitulo[]))
    if (data.length < porPagina) return capitulos
  }
}

// A obra e seus capítulos. Tenta a rede; se falhar e a obra estiver guardada
// no aparelho, abre a cópia guardada (semRede = true).
export async function carregarObraECapitulos(
  obraId: number,
): Promise<{ obra: ObraLeitor; capitulos: Capitulo[]; semRede: boolean }> {
  try {
    const [obra, capitulos] = await Promise.all([carregarObraDaRede(obraId), carregarCapitulosDaRede(obraId)])

    // Obra que já está no aparelho: aproveita para atualizar a cópia guardada
    const guardada = await lerObraGuardada<ObraLeitor, Capitulo>(obraId).catch(() => null)
    if (guardada) await guardarObra(obraId, obra, capitulos).catch(() => {})

    return { obra, capitulos, semRede: false }
  } catch (erro) {
    const guardada = await lerObraGuardada<ObraLeitor, Capitulo>(obraId).catch(() => null)
    if (guardada) return { obra: guardada.obra, capitulos: guardada.capitulos, semRede: true }
    throw erro
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
// O navegador guarda a resposta por um dia.
async function pedirPaginas(capituloId: number): Promise<RespostaPaginas & { paginas: string[] }> {
  const resposta = await fetch(`${URL_FUNCOES}/paginas-capitulo?capitulo_id=${capituloId}`, { headers: { apikey: CHAVE } })
  const corpo = (await resposta.json()) as RespostaPaginas

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

  const corpo = await pedirPaginas(capitulo.id)
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
