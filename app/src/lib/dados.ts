// Leitura dos dados que o leitor usa: a obra, os capítulos e as imagens.
import { lerSenhaGuardada } from './senha'
import { supabase } from './supabase'

export type ObraLeitor = { id: number; titulo: string; capitulo_atual: number | null }
export type Capitulo = { id: number; numero: number; titulo: string | null; lido: boolean }

const URL_FUNCOES = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export async function carregarObra(obraId: number): Promise<ObraLeitor> {
  if (!supabase) throw new Error('Supabase não configurado')

  const { data, error } = await supabase.from('obras').select('id,titulo,capitulo_atual').eq('id', obraId).single()
  if (error) throw new Error(error.message)
  return data as ObraLeitor
}

// Todos os capítulos da obra, em ordem. A API devolve no máximo 1000 linhas por
// pedido e há obras com mais que isso, então busca em páginas.
export async function carregarCapitulos(obraId: number): Promise<Capitulo[]> {
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

// URLs das imagens de um capítulo, em ordem. Quem lê o site de origem é a Edge
// Function paginas-capitulo; o navegador guarda a resposta por um dia.
export async function carregarPaginas(capituloId: number): Promise<string[]> {
  const resposta = await fetch(`${URL_FUNCOES}/paginas-capitulo?capitulo_id=${capituloId}`, { headers: { apikey: CHAVE } })
  const corpo = (await resposta.json()) as { paginas?: string[]; erro?: string; falhas?: string[] }

  if (!resposta.ok || !corpo.paginas) {
    throw new Error([corpo.erro ?? `Erro ${resposta.status}`, ...(corpo.falhas ?? [])].join(' — '))
  }
  return corpo.paginas
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

// Posição de leitura guardada no aparelho (o número do capítulo em que parou).
const chavePosicao = (obraId: number) => `manhua-posicao-${obraId}`

export function lerPosicao(obraId: number): number | null {
  try {
    const valor = localStorage.getItem(chavePosicao(obraId))
    return valor === null ? null : Number(valor)
  } catch {
    return null
  }
}

export function salvarPosicao(obraId: number, numero: number) {
  try {
    localStorage.setItem(chavePosicao(obraId), String(numero))
  } catch {
    // Armazenamento indisponível (aba privada): segue sem lembrar a posição
  }
}
