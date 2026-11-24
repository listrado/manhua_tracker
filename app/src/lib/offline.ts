// Armazenamento offline no aparelho (IndexedDB): as imagens dos capítulos
// baixados e uma cópia dos dados da obra, para abrir sem internet.
//
// Três "gavetas":
//   paginas ..... [obraId, numero, indice] -> a imagem (bytes + tipo)
//   capitulos ... [obraId, numero]         -> quantas páginas, quantos bytes, se está completo
//   obras ....... obraId                   -> cópia da obra e da lista de capítulos
//
// A imagem é guardada como bytes (ArrayBuffer), não como Blob: o Safari do
// iPhone já teve problemas com Blob dentro do IndexedDB.

export type PaginaGuardada = { dados: ArrayBuffer; tipo: string }
export type CapituloGuardado = { obraId: number; numero: number; total: number; bytes: number; completo: boolean }
export type ObraGuardada<O, C> = { obra: O; capitulos: C[]; salvoEm: string }
export type ResumoOffline = { capitulos: number; bytes: number }

const NOME_DO_BANCO = 'manhua-offline'
const VERSAO = 1

let conexao: Promise<IDBDatabase> | null = null

function abrir(): Promise<IDBDatabase> {
  conexao ??= new Promise((resolver, rejeitar) => {
    const pedido = indexedDB.open(NOME_DO_BANCO, VERSAO)

    // Primeira vez (ou versão nova): cria as gavetas
    pedido.onupgradeneeded = () => {
      const banco = pedido.result
      if (!banco.objectStoreNames.contains('paginas')) banco.createObjectStore('paginas')
      if (!banco.objectStoreNames.contains('capitulos')) banco.createObjectStore('capitulos')
      if (!banco.objectStoreNames.contains('obras')) banco.createObjectStore('obras')
    }

    pedido.onsuccess = () => resolver(pedido.result)
    pedido.onerror = () => {
      conexao = null
      rejeitar(pedido.error ?? new Error('Não foi possível abrir o armazenamento do aparelho'))
    }
  })
  return conexao
}

// Transforma um pedido do IndexedDB em Promise.
function esperar<T>(pedido: IDBRequest<T>): Promise<T> {
  return new Promise((resolver, rejeitar) => {
    pedido.onsuccess = () => resolver(pedido.result)
    pedido.onerror = () => rejeitar(pedido.error ?? new Error('Falha no armazenamento do aparelho'))
  })
}

// Espera a transação inteira terminar (é quando a gravação vale de verdade).
function concluir(transacao: IDBTransaction): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    transacao.oncomplete = () => resolver()
    transacao.onerror = () => rejeitar(transacao.error ?? new Error('Falha ao gravar no aparelho'))
    transacao.onabort = () => rejeitar(transacao.error ?? new Error('Gravação cancelada (pode ser falta de espaço)'))
  })
}

// Todas as chaves de uma obra: de [obraId] até [obraId, <qualquer coisa>].
// Na ordenação do IndexedDB, uma lista vazia vem depois de qualquer número.
function faixaDaObra(obraId: number): IDBKeyRange {
  return IDBKeyRange.bound([obraId], [obraId, []])
}

export async function guardarPagina(obraId: number, numero: number, indice: number, pagina: PaginaGuardada): Promise<void> {
  const banco = await abrir()
  const transacao = banco.transaction('paginas', 'readwrite')
  transacao.objectStore('paginas').put(pagina, [obraId, numero, indice])
  await concluir(transacao)
}

export async function lerPagina(obraId: number, numero: number, indice: number): Promise<PaginaGuardada | null> {
  const banco = await abrir()
  const pagina = await esperar(banco.transaction('paginas').objectStore('paginas').get([obraId, numero, indice]))
  return (pagina as PaginaGuardada | undefined) ?? null
}

export async function guardarCapitulo(capitulo: CapituloGuardado): Promise<void> {
  const banco = await abrir()
  const transacao = banco.transaction('capitulos', 'readwrite')
  transacao.objectStore('capitulos').put(capitulo, [capitulo.obraId, capitulo.numero])
  await concluir(transacao)
}

export async function lerCapitulo(obraId: number, numero: number): Promise<CapituloGuardado | null> {
  const banco = await abrir()
  const capitulo = await esperar(banco.transaction('capitulos').objectStore('capitulos').get([obraId, numero]))
  return (capitulo as CapituloGuardado | undefined) ?? null
}

// Capítulos guardados de uma obra, pelo número.
export async function capitulosDaObra(obraId: number): Promise<Map<number, CapituloGuardado>> {
  const banco = await abrir()
  const lista = (await esperar(banco.transaction('capitulos').objectStore('capitulos').getAll(faixaDaObra(obraId)))) as CapituloGuardado[]
  return new Map(lista.map((c) => [c.numero, c]))
}

// Quanto cada obra ocupa no aparelho: capítulos completos e bytes.
export async function resumoPorObra(): Promise<Map<number, ResumoOffline>> {
  const banco = await abrir()
  const lista = (await esperar(banco.transaction('capitulos').objectStore('capitulos').getAll())) as CapituloGuardado[]
  const resumo = new Map<number, ResumoOffline>()

  for (const c of lista) {
    const daObra = resumo.get(c.obraId) ?? { capitulos: 0, bytes: 0 }
    if (c.completo) daObra.capitulos++
    daObra.bytes += c.bytes
    resumo.set(c.obraId, daObra)
  }

  return resumo
}

export async function guardarObra<O, C>(obraId: number, obra: O, capitulos: C[]): Promise<void> {
  const banco = await abrir()
  const transacao = banco.transaction('obras', 'readwrite')
  transacao.objectStore('obras').put({ obra, capitulos, salvoEm: new Date().toISOString() }, obraId)
  await concluir(transacao)
}

export async function lerObraGuardada<O, C>(obraId: number): Promise<ObraGuardada<O, C> | null> {
  const banco = await abrir()
  const guardada = await esperar(banco.transaction('obras').objectStore('obras').get(obraId))
  return (guardada as ObraGuardada<O, C> | undefined) ?? null
}

// Libera o espaço de uma obra: apaga as imagens, os capítulos e a cópia da obra.
export async function apagarObra(obraId: number): Promise<void> {
  const banco = await abrir()
  const transacao = banco.transaction(['paginas', 'capitulos', 'obras'], 'readwrite')

  transacao.objectStore('paginas').delete(faixaDaObra(obraId))
  transacao.objectStore('capitulos').delete(faixaDaObra(obraId))
  transacao.objectStore('obras').delete(obraId)
  await concluir(transacao)
}

// "340 MB", "1,2 GB"
export function formatarBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`
  return `${Math.round(mb)} MB`
}
