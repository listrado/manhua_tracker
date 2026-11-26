// Armazenamento offline no aparelho (IndexedDB): as imagens dos capítulos
// baixados e uma cópia dos dados da obra, para abrir sem internet.
//
// Quatro "gavetas":
//   paginas ..... [obraId, numero, indice] -> a imagem (bytes + tipo)
//   capitulos ... [obraId, numero]         -> quantas páginas, quantos bytes, se está completo
//   obras ....... obraId                   -> cópia da obra e da lista de capítulos
//   capas ....... obraId                   -> a capa da obra (bytes + tipo + qual arquivo era)
//
// A imagem é guardada como bytes (ArrayBuffer), não como Blob: o Safari do
// iPhone já teve problemas com Blob dentro do IndexedDB.

export type PaginaGuardada = { dados: ArrayBuffer; tipo: string }
export type CapituloGuardado = { obraId: number; numero: number; total: number; bytes: number; completo: boolean }
export type ObraGuardada<O, C> = { obra: O; capitulos: C[]; salvoEm: string }
export type ResumoOffline = { capitulos: number; bytes: number }
// path: o arquivo da capa no servidor, para saber se ela mudou desde que foi guardada
export type CapaGuardada = { dados: ArrayBuffer; tipo: string; path: string }

const NOME_DO_BANCO = 'manhua-offline'
// Versão 2: gaveta das capas. Subir a versão não apaga o que já está guardado.
const VERSAO = 2

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
      if (!banco.objectStoreNames.contains('capas')) banco.createObjectStore('capas')
    }

    pedido.onsuccess = () => {
      const banco = pedido.result
      // Outra aba abriu uma versão mais nova do app: solta o banco para ela poder atualizar
      banco.onversionchange = () => {
        banco.close()
        conexao = null
      }
      resolver(banco)
    }
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

// Todas as cópias de obra guardadas no aparelho.
export async function obrasGuardadas<O, C>(): Promise<{ obraId: number; guardada: ObraGuardada<O, C> }[]> {
  const banco = await abrir()
  const gaveta = banco.transaction('obras').objectStore('obras')
  const [chaves, valores] = await Promise.all([esperar(gaveta.getAllKeys()), esperar(gaveta.getAll())])
  return chaves.map((chave, i) => ({ obraId: Number(chave), guardada: valores[i] as ObraGuardada<O, C> }))
}

export async function guardarCapa(obraId: number, capa: CapaGuardada): Promise<void> {
  const banco = await abrir()
  const transacao = banco.transaction('capas', 'readwrite')
  transacao.objectStore('capas').put(capa, obraId)
  await concluir(transacao)
}

// Capas guardadas das obras pedidas (as que não têm capa ficam de fora).
export async function lerCapas(obraIds: number[]): Promise<Map<number, CapaGuardada>> {
  const banco = await abrir()
  const gaveta = banco.transaction('capas').objectStore('capas')
  const capas = await Promise.all(obraIds.map((id) => esperar(gaveta.get(id))))

  const resultado = new Map<number, CapaGuardada>()
  obraIds.forEach((id, i) => {
    if (capas[i]) resultado.set(id, capas[i] as CapaGuardada)
  })
  return resultado
}

// Libera o espaço de uma obra: apaga as imagens, os capítulos, a cópia da obra e a capa.
export async function apagarObra(obraId: number): Promise<void> {
  const banco = await abrir()
  const transacao = banco.transaction(['paginas', 'capitulos', 'obras', 'capas'], 'readwrite')

  transacao.objectStore('paginas').delete(faixaDaObra(obraId))
  transacao.objectStore('capitulos').delete(faixaDaObra(obraId))
  transacao.objectStore('obras').delete(obraId)
  transacao.objectStore('capas').delete(obraId)
  await concluir(transacao)
}

// "340 MB", "1,2 GB"
export function formatarBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`
  return `${Math.round(mb)} MB`
}
