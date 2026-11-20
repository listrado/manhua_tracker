import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function TelaLogin() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function entrar(evento: FormEvent) {
    evento.preventDefault()
    if (!supabase) return

    // Tenta o login
    setEnviando(true)
    setErro(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })

    // Em caso de sucesso, useSessao troca a tela sozinho
    setEnviando(false)
    if (error) {
      setErro(
        error.message === 'Invalid login credentials'
          ? 'E-mail ou senha incorretos.'
          : `Não foi possível entrar: ${error.message}`,
      )
    }
  }

  return (
    <main className="tela-centro">
      <form className="cartao" onSubmit={entrar}>
        <h1>Manhuas</h1>

        <label>
          E-mail
          <input
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label>
          Senha
          <input
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </label>

        {erro && <p className="erro">{erro}</p>}

        <button type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
