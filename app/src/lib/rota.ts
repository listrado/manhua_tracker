import { useEffect, useState } from 'react'

// O GitHub Pages não redireciona rotas de SPA, então a rota mora no hash:
// "#/" é a biblioteca, "#/obra/123" é o leitor da obra 123.
export type Rota = { tela: 'biblioteca' } | { tela: 'obra'; obraId: number }

export function lerRota(hash: string): Rota {
  const partes = hash.replace(/^#\/?/, '').split('/').filter(Boolean)

  // #/obra/<id>
  if (partes[0] === 'obra' && /^\d+$/.test(partes[1] ?? '')) {
    return { tela: 'obra', obraId: Number(partes[1]) }
  }

  // Qualquer outra coisa cai na biblioteca
  return { tela: 'biblioteca' }
}

export function useRota(): Rota {
  const [rota, setRota] = useState<Rota>(() => lerRota(window.location.hash))

  useEffect(() => {
    const aoMudar = () => setRota(lerRota(window.location.hash))

    window.addEventListener('hashchange', aoMudar)
    return () => window.removeEventListener('hashchange', aoMudar)
  }, [])

  return rota
}
