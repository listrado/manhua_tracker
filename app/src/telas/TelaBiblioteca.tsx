import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Fase 1: a biblioteca ainda é uma casca. Ela só prova que o app publicado
// conversa com o banco. As abas, a busca e a lista entram na fase 4.
export function TelaBiblioteca() {
  const [resumo, setResumo] = useState<string>('Consultando o banco…')

  useEffect(() => {
    if (!supabase) return
    let cancelado = false

    // Conta as obras: confirma que a RLS deixa o dono ler
    supabase
      .from('obras')
      .select('id', { count: 'exact', head: true })
      .then(({ count, error }) => {
        if (cancelado) return
        setResumo(
          error
            ? `O banco recusou a leitura: ${error.message}`
            : `Banco respondendo. Obras cadastradas: ${count ?? 0}.`,
        )
      })

    return () => {
      cancelado = true
    }
  }, [])

  return (
    <main className="tela-centro">
      <section className="cartao">
        <h1>Biblioteca</h1>
        <p className="suave">{resumo}</p>
      </section>
    </main>
  )
}
