// Leitura do banco pelos scripts locais, pela API pública (a leitura do schema
// manhua é aberta). A escrita NÃO passa por aqui: os scripts geram um arquivo
// .sql em dados/, que é aplicado com `supabase db query --linked -f`.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PASTA_DADOS = join(RAIZ, 'dados')

// Lê app/.env (URL do Supabase e chave publishable).
function lerEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const linha of readFileSync(join(RAIZ, 'app', '.env'), 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

// GET numa tabela do schema manhua, paginando até trazer tudo.
export async function ler<T>(tabela: string, consulta: string): Promise<T[]> {
  const env = lerEnv()
  const linhas: T[] = []
  const porPagina = 1000

  for (let inicio = 0; ; inicio += porPagina) {
    const resposta = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${tabela}?${consulta}`, {
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY,
        'Accept-Profile': 'manhua',
        Range: `${inicio}-${inicio + porPagina - 1}`,
      },
    })
    if (!resposta.ok) throw new Error(`Leitura de ${tabela} falhou: ${resposta.status} ${await resposta.text()}`)

    const pagina = (await resposta.json()) as T[]
    linhas.push(...pagina)
    if (pagina.length < porPagina) return linhas
  }
}

// Literais SQL seguros.
export function sqlTexto(valor: string | null): string {
  return valor === null ? 'null' : `'${valor.replace(/'/g, "''")}'`
}

export function sqlNumero(valor: number | null): string {
  return valor === null ? 'null' : String(valor)
}

export function sqlLista(valores: string[]): string {
  return valores.length === 0 ? `'{}'::text[]` : `array[${valores.map(sqlTexto).join(', ')}]::text[]`
}
