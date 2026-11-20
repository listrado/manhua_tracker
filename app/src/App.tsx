import { useState } from 'react'
import { useRota } from './lib/rota'
import { lerSenhaGuardada } from './lib/senha'
import { supabaseConfigurado } from './lib/supabase'
import { TelaBiblioteca } from './telas/TelaBiblioteca'
import { TelaLeitor } from './telas/TelaLeitor'
import { TelaSenha } from './telas/TelaSenha'

export default function App() {
  const rota = useRota()

  // O app pede a senha de acesso uma vez por aparelho (decisão do dono: senha
  // em vez de login com conta). A tela de login antiga (TelaLogin + useSessao)
  // continua no código, sem uso, caso um dia volte a ter conta.
  const [liberado, setLiberado] = useState(() => lerSenhaGuardada() !== null)

  // Build sem as variáveis do Supabase: avisa em vez de dar tela branca
  if (!supabaseConfigurado) {
    return (
      <main className="tela-centro">
        <section className="cartao">
          <h1>Manhuas</h1>
          <p className="erro">
            Configuração faltando: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja o README).
          </p>
        </section>
      </main>
    )
  }

  // Sem a senha não existe nenhuma outra tela
  if (!liberado) {
    return <TelaSenha aoEntrar={() => setLiberado(true)} />
  }

  // #/obra/<id> abre o leitor; qualquer outra rota é a biblioteca.
  // A key faz o leitor recomeçar do zero ao trocar de obra.
  if (rota.tela === 'obra') {
    return <TelaLeitor key={rota.obraId} obraId={rota.obraId} aoPerderAcesso={() => setLiberado(false)} />
  }

  return <TelaBiblioteca />
}
