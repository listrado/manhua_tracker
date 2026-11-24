// Download de uma obra para leitura offline.
//
// Baixa os capítulos a partir do que está sendo lido, um por vez, com algumas
// imagens em paralelo, e guarda tudo no aparelho. Pode ser parado e retomado:
// capítulo que já está completo não é baixado de novo.
//
// O download vive fora das telas (neste módulo), então continua enquanto se
// navega entre a biblioteca e o leitor. O iPhone, porém, suspende a página
// quando o app sai da tela: não existe download em segundo plano.
import { carregarEnderecosParaBaixar, type Capitulo, type ObraLeitor } from './dados'
import { capitulosDaObra, guardarCapitulo, guardarObra, guardarPagina } from './offline'

// Limite por obra. Uma obra longa passa fácil de 20 GB; o limite evita encher o aparelho.
export const LIMITE_POR_OBRA_BYTES = 2000 * 1024 * 1024
const IMAGENS_EM_PARALELO = 4
const TENTATIVAS_POR_IMAGEM = 3
// Capítulos seguidos com falha antes de desistir (quase sempre é falta de internet).
const FALHAS_SEGUIDAS_PARA_PARAR = 3

export type EstadoDownload = {
  obraId: number
  titulo: string
  situacao: 'baixando' | 'parado' | 'concluido' | 'limite' | 'erro'
  // Capítulos prontos e total a baixar nesta rodada
  feitos: number
  total: number
  bytes: number
  numeroAtual: number | null
  mensagem: string | null
}

let estado: EstadoDownload | null = null
let controle: AbortController | null = null
const ouvintes = new Set<() => void>()

// Para as telas acompanharem o download (useSyncExternalStore).
export function assinarDownload(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

export function estadoDoDownload(): EstadoDownload | null {
  return estado
}

function publicar(novo: EstadoDownload) {
  estado = novo
  for (const ouvinte of ouvintes) ouvinte()
}

export function pararDownload() {
  controle?.abort()
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))

// Baixa uma imagem pelo proxy, com novas tentativas e espera crescente.
async function baixarImagem(url: string, sinal: AbortSignal): Promise<{ dados: ArrayBuffer; tipo: string }> {
  let ultimoErro: unknown

  for (let tentativa = 1; tentativa <= TENTATIVAS_POR_IMAGEM; tentativa++) {
    try {
      const resposta = await fetch(url, { signal: sinal })
      if (!resposta.ok) throw new Error(`a imagem respondeu ${resposta.status}`)

      return { dados: await resposta.arrayBuffer(), tipo: resposta.headers.get('Content-Type') ?? 'image/jpeg' }
    } catch (erro) {
      if (sinal.aborted) throw erro
      ultimoErro = erro
      await esperar(800 * tentativa)
    }
  }

  throw ultimoErro
}

// Baixa e guarda todas as imagens de um capítulo. Devolve quantos bytes ocupou.
async function baixarCapitulo(obraId: number, capitulo: Capitulo, sinal: AbortSignal, aoBaixar: (bytes: number) => void): Promise<number> {
  const enderecos = await carregarEnderecosParaBaixar(capitulo.id)
  let proximo = 0
  let bytes = 0

  // Cada "trabalhador" pega a próxima imagem da fila até acabar
  async function trabalhador() {
    while (proximo < enderecos.length && !sinal.aborted) {
      const indice = proximo++
      const imagem = await baixarImagem(enderecos[indice], sinal)

      await guardarPagina(obraId, capitulo.numero, indice, imagem)
      bytes += imagem.dados.byteLength
      aoBaixar(imagem.dados.byteLength)
    }
  }

  await Promise.all(Array.from({ length: Math.min(IMAGENS_EM_PARALELO, enderecos.length) }, trabalhador))
  if (sinal.aborted) throw new DOMException('Download parado', 'AbortError')

  // Só agora o capítulo conta como completo
  await guardarCapitulo({ obraId, numero: capitulo.numero, total: enderecos.length, bytes, completo: true })
  return bytes
}

// Começa (ou retoma) o download da obra, do capítulo de índice "aPartirDe" em diante.
export async function baixarObra(obra: ObraLeitor, capitulos: Capitulo[], aPartirDe: number): Promise<void> {
  // Um download por vez
  controle?.abort()
  const meuControle = new AbortController()
  controle = meuControle
  const sinal = meuControle.signal

  const fila = capitulos.slice(Math.max(0, aPartirDe))
  let atual: EstadoDownload = {
    obraId: obra.id,
    titulo: obra.titulo,
    situacao: 'baixando',
    feitos: 0,
    total: fila.length,
    bytes: 0,
    numeroAtual: null,
    mensagem: null,
  }
  const avisar = (mudanca: Partial<EstadoDownload>) => {
    atual = { ...atual, ...mudanca }
    // Outro download tomou o lugar: este para de publicar
    if (controle === meuControle) publicar(atual)
  }

  try {
    // Pede ao navegador para não apagar estes dados por conta própria
    await navigator.storage?.persist?.().catch(() => false)

    // Cópia da obra e da lista de capítulos, para abrir sem internet
    await guardarObra(obra.id, obra, capitulos)

    // O que já está no aparelho (para retomar e para respeitar o limite)
    const guardados = await capitulosDaObra(obra.id)
    let bytesDaObra = [...guardados.values()].reduce((soma, c) => soma + c.bytes, 0)
    avisar({ bytes: bytesDaObra })

    let falhasSeguidas = 0
    for (const capitulo of fila) {
      if (sinal.aborted) break

      // Já completo: não baixa de novo
      if (guardados.get(capitulo.numero)?.completo) {
        avisar({ feitos: atual.feitos + 1 })
        continue
      }

      // Limite por obra atingido: para aqui
      if (bytesDaObra >= LIMITE_POR_OBRA_BYTES) {
        avisar({ situacao: 'limite', numeroAtual: null, mensagem: 'Limite de espaço desta obra atingido.' })
        return
      }

      avisar({ numeroAtual: capitulo.numero })
      try {
        await baixarCapitulo(obra.id, capitulo, sinal, (bytes) => {
          bytesDaObra += bytes
          avisar({ bytes: bytesDaObra })
        })
        falhasSeguidas = 0
        avisar({ feitos: atual.feitos + 1 })
      } catch (erro) {
        if (sinal.aborted) break

        // Sem espaço no aparelho: não adianta continuar
        if (erro instanceof DOMException && erro.name === 'QuotaExceededError') {
          avisar({ situacao: 'erro', numeroAtual: null, mensagem: 'O aparelho ficou sem espaço. Libere espaço e tente de novo.' })
          return
        }

        // Um capítulo falhou: segue para o próximo; vários seguidos, desiste
        falhasSeguidas++
        if (falhasSeguidas >= FALHAS_SEGUIDAS_PARA_PARAR) {
          const motivo = erro instanceof Error ? erro.message : String(erro)
          avisar({ situacao: 'erro', numeroAtual: null, mensagem: `O download parou (sem internet?): ${motivo}. Toque para retomar.` })
          return
        }
      }
    }

    avisar(
      sinal.aborted
        ? { situacao: 'parado', numeroAtual: null, mensagem: null }
        : { situacao: 'concluido', numeroAtual: null, mensagem: null },
    )
  } catch (erro) {
    avisar({ situacao: 'erro', numeroAtual: null, mensagem: erro instanceof Error ? erro.message : String(erro) })
  }
}
