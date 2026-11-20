import { useState, type FormEvent } from 'react'
import { entrarComSenha } from '../lib/senha'

// Pede a senha de acesso uma vez por aparelho.
export function TelaSenha({ aoEntrar }: { aoEntrar: () => void }) {
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function entrar(evento: FormEvent) {
    evento.preventDefault()

    // Confere no banco
    setEnviando(true)
    setErro(null)
    const mensagem = await entrarComSenha(senha)
    setEnviando(false)

    // Certa: libera o app. Errada: mostra o motivo e limpa o campo
    if (mensagem === null) {
      aoEntrar()
    } else {
      setErro(mensagem)
      setSenha('')
    }
  }

  return (
    <main className="tela-centro">
      <form className="cartao" onSubmit={entrar}>
        <h1>Manhuas</h1>

        <label>
          Senha
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </label>

        {erro && <p className="erro">{erro}</p>}

        <button type="submit" disabled={enviando || senha === ''}>
          {enviando ? 'Conferindo…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
