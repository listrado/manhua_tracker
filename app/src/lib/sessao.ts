import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// "carregando" existe para a tela de login não piscar antes de o Supabase
// devolver a sessão que já estava guardada no aparelho.
export type EstadoSessao =
  | { estado: 'carregando' }
  | { estado: 'deslogado' }
  | { estado: 'logado'; sessao: Session }

export function useSessao(): EstadoSessao {
  // Sem Supabase configurado não há sessão para esperar
  const [estado, setEstado] = useState<EstadoSessao>(() =>
    supabase ? { estado: 'carregando' } : { estado: 'deslogado' },
  )

  useEffect(() => {
    if (!supabase) return

    // Sessão já guardada no aparelho (funciona sem rede)
    supabase.auth.getSession().then(({ data }) => {
      setEstado(data.session ? { estado: 'logado', sessao: data.session } : { estado: 'deslogado' })
    })

    // Login, logout e renovação do token
    const { data } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      setEstado(sessao ? { estado: 'logado', sessao } : { estado: 'deslogado' })
    })

    return () => data.subscription.unsubscribe()
  }, [])

  return estado
}
