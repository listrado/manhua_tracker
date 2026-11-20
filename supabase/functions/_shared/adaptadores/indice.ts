// Ponto único que monta o adaptador de um site cadastrado em manhua.sites.
// Usado pelas Edge Functions e pelos scripts locais: adaptador novo entra aqui
// e passa a valer para todos.
import { criarManganato } from './manganato.ts'
import { criarManhuaplus } from './manhuaplus.ts'
import { criarThemesia } from './themesia.ts'
import type { Adaptador, Http } from './tipos.ts'

// O que o banco guarda de cada site e interessa aqui.
export type SiteCadastrado = { slug: string; adaptador: string; dominios: string[] }

export function criarAdaptador(site: SiteCadastrado, http: Http): Adaptador {
  // O domínio vem do banco, nunca fixo no código: esses sites trocam de endereço
  const base = `https://${site.dominios[0]}`

  // sites.adaptador diz qual "motor" o site usa
  if (site.adaptador === 'manhuaplus') return criarManhuaplus(base, http)
  if (site.adaptador === 'manganato') return criarManganato(site.slug, base, http)
  if (site.adaptador === 'themesia') return criarThemesia(site.slug, base, http)

  throw new Error(`Ainda não existe adaptador "${site.adaptador}" (site ${site.slug})`)
}
