// Monta o adaptador certo para um site cadastrado em manhua.sites, com o acesso
// à rede dos scripts locais (intervalo entre pedidos e cache em disco).
import { join } from 'node:path'
import { criarAdaptador } from '../../supabase/functions/_shared/adaptadores/indice.ts'
import type { Adaptador } from '../../supabase/functions/_shared/adaptadores/tipos.ts'
import { PASTA_DADOS } from './banco.ts'
import { criarRede, type Rede } from './rede.ts'

export type Site = { id: number; slug: string; dominios: string[]; adaptador: string; referer: string | null; intervalo_ms: number }

export const CAMPOS_SITE = 'id,slug,dominios,adaptador,referer,intervalo_ms'

export function montarAdaptador(site: Site): { adaptador: Adaptador; rede: Rede } {
  // As páginas buscadas ficam em dados/cache/<site>/
  const rede = criarRede(site.intervalo_ms, join(PASTA_DADOS, 'cache', site.slug))
  return { adaptador: criarAdaptador(site, rede.http), rede }
}
