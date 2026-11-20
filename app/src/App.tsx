import { useRota } from './lib/rota'
import { useSessao } from './lib/sessao'
import { supabaseConfigurado } from './lib/supabase'
import { TelaBiblioteca } from './telas/TelaBiblioteca'
import { TelaLeitor } from './telas/TelaLeitor'
import { TelaLogin } from './telas/TelaLogin'

const EXIGIR_LOGIN: boolean = false

export default function App() {
  const sessao = useSessao()
  const rota = useRota()

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

  // Por enquanto o app abre SEM login (decisão do dono): a leitura do banco é
  // aberta e a escrita continua fechada. Para voltar a exigir login, basta
  // trocar EXIGIR_LOGIN para true — a tela de login e a sessão já estão prontas.
  if (EXIGIR_LOGIN) {
    // Esperando o Supabase devolver a sessão guardada
    if (sessao.estado === 'carregando') {
      return <main className="tela-centro suave">Carregando…</main>
    }

    // Sem login não existe nenhuma outra tela
    if (sessao.estado === 'deslogado') {
      return <TelaLogin />
    }
  }

  // #/obra/<id> abre o leitor; qualquer outra rota é a biblioteca.
  // A key faz o leitor recomeçar do zero ao trocar de obra.
  if (rota.tela === 'obra') {
    return <TelaLeitor key={rota.obraId} obraId={rota.obraId} />
  }

  return <TelaBiblioteca />
}
