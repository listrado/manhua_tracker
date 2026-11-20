// Monta o adaptador certo para um site cadastrado em manhua.sites.
import { join } from 'node:path'
import { criarManhuaplus } from '../../supabase/functions/_shared/adaptadores/manhuaplus.ts'
import type { Adaptador } from '../../supabase/functions/_shared/adaptadores/tipos.ts'
import { PASTA_DADOS } from './banco.ts'
import { criarRede, type Rede } from './rede.ts'

export type Site = { id: number; slug: string; dominios: string[]; adaptador: string; referer: string | null; intervalo_ms: number }

export const CAMPOS_SITE = 'id,slug,dominios,adaptador,referer,intervalo_ms'

export function montarAdaptador(site: Site): { adaptador: Adaptador; rede: Rede } {
  // O domínio vem do banco; as páginas buscadas ficam em dados/cache/<site>/
  const base = `https://${site.dominios[0]}`
  const rede = criarRede(site.intervalo_ms, join(PASTA_DADOS, 'cache', site.slug))

  // Um adaptador por tipo de site (coluna sites.adaptador)
  if (site.adaptador === 'manhuaplus') return { adaptador: criarManhuaplus(base, rede.http), rede }
  throw new Error(`Ainda não existe adaptador "${site.adaptador}"`)
}
