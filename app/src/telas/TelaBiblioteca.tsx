import { useEffect, useMemo, useState } from 'react'
import { Logo } from '../componentes/Logo'
import {
  CRITERIOS,
  estaEmDia,
  estaQuente,
  fracaoLida,
  lerEsconderEmDia,
  lerOrdenacao,
  ordenar,
  salvarEsconderEmDia,
  salvarOrdenacao,
  type Criterio,
  type Ordenacao,
} from '../lib/ordenacao'
import { formatarBytes, resumoPorObra, type ResumoOffline } from '../lib/offline'
import { supabase } from '../lib/supabase'

// Biblioteca: lista as obras em duas abas, com busca, ordenação e capa; tocar
// numa obra abre o leitor. Obras "hot" (capítulo novo em obra que estava em
// dia) ficam no topo por uma semana. Aba "Confirmar", adicionar obra e as
// ações por obra ainda não existem.

type Fonte = { url_obra: string; prioridade: number; ativa: boolean }

type Obra = {
  id: number
  titulo: string
  titulo_normalizado: string
  titulos_alternativos: string[]
  status: 'lendo' | 'nao_iniciada' | 'pausada' | 'concluida'
  capitulo_atual: number | null
  total_capitulos: number | null
  capa_path: string | null
  tem_novo: boolean
  ultima_leitura_em: string | null
  quente_ate: string | null
  fontes: Fonte[]
}

type Aba = 'lendo' | 'nao_iniciada'

const ABAS: { id: Aba; nome: string }[] = [
  { id: 'lendo', nome: 'Lendo' },
  { id: 'nao_iniciada', nome: 'Para ler depois' },
]

const URL_CAPAS = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/manhua-capas/`

// Mesma normalização do banco: minúsculas, sem acento, sem pontuação.
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Link da fonte preferida (menor prioridade) que esteja ativa.
function linkDaObra(obra: Obra): string | null {
  const ativas = obra.fontes.filter((f) => f.ativa).sort((a, b) => a.prioridade - b.prioridade)
  return ativas[0]?.url_obra ?? null
}

// Última lista de obras, guardada no aparelho para a biblioteca abrir sem internet.
const CHAVE_BIBLIOTECA = 'manhua-biblioteca'

function guardarBiblioteca(obras: Obra[]) {
  try {
    localStorage.setItem(CHAVE_BIBLIOTECA, JSON.stringify(obras))
  } catch {
    // Sem espaço ou armazenamento indisponível: a biblioteca só abre com internet
  }
}

function lerBibliotecaGuardada(): Obra[] | null {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_BIBLIOTECA) ?? 'null') as Obra[] | null
  } catch {
    return null
  }
}

function ItemObra({ obra, noAparelho }: { obra: Obra; noAparelho: ResumoOffline | null }) {
  const link = linkDaObra(obra)
  const fracao = fracaoLida(obra)
  const quente = estaQuente(obra)

  // "cap. 39 / 120 · 32%"
  const progresso =
    obra.capitulo_atual === null
      ? obra.total_capitulos
        ? `${obra.total_capitulos} capítulos`
        : 'sem capítulo lido'
      : `cap. ${obra.capitulo_atual}${obra.total_capitulos ? ` / ${obra.total_capitulos}` : ''}` +
        (fracao !== null ? ` · ${Math.round(fracao * 100)}%` : '')

  const conteudo = (
    <>
      {obra.capa_path ? (
        <img className="capa" src={URL_CAPAS + obra.capa_path} alt="" loading="lazy" />
      ) : (
        <div className="capa capa-vazia" aria-hidden="true" />
      )}

      <div className="obra-texto">
        <span className="obra-titulo">{obra.titulo}</span>
        <span className="suave">
          {progresso}
          {quente && <span className="selo selo-hot">hot</span>}
          {obra.tem_novo && !quente && <span className="selo">novo</span>}
        </span>
        {!link && <span className="suave pequeno">link ainda não encontrado</span>}
        {noAparelho && noAparelho.bytes > 0 && (
          <span className="suave pequeno">
            ⬇ offline: {noAparelho.capitulos} cap., {formatarBytes(noAparelho.bytes)}
          </span>
        )}
      </div>
    </>
  )

  // Obra com capítulos cadastrados abre no leitor do app
  if (obra.total_capitulos) {
    return (
      <li>
        <a className="obra" href={`#/obra/${obra.id}`}>
          {conteudo}
        </a>
      </li>
    )
  }

  // Sem capítulos ainda: se já tem link, abre o site de origem
  return (
    <li>
      {link ? (
        <a className="obra" href={link} target="_blank" rel="noreferrer">
          {conteudo}
        </a>
      ) : (
        <div className="obra">{conteudo}</div>
      )}
    </li>
  )
}

export function TelaBiblioteca() {
  const [obras, setObras] = useState<Obra[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>('lendo')
  const [busca, setBusca] = useState('')
  const [ordenacao, setOrdenacao] = useState<Ordenacao>(() => lerOrdenacao())
  const [esconderEmDia, setEsconderEmDia] = useState(() => lerEsconderEmDia())
  const [noAparelho, setNoAparelho] = useState<Map<number, ResumoOffline>>(() => new Map())
  const [semRede, setSemRede] = useState(false)

  // Troca a ordenação e guarda a escolha no aparelho
  function mudarOrdenacao(nova: Ordenacao) {
    setOrdenacao(nova)
    salvarOrdenacao(nova)
  }

  useEffect(() => {
    if (!supabase) return
    let cancelado = false

    // O que está baixado no aparelho, por obra
    resumoPorObra()
      .then((resumo) => {
        if (!cancelado) setNoAparelho(resumo)
      })
      .catch(() => {})

    // Carrega todas as obras de uma vez (são algumas centenas), já com as fontes
    supabase
      .from('obras')
      .select(
        'id,titulo,titulo_normalizado,titulos_alternativos,status,capitulo_atual,total_capitulos,capa_path,tem_novo,ultima_leitura_em,quente_ate,fontes(url_obra,prioridade,ativa)',
      )
      .order('titulo')
      .then(({ data, error }) => {
        if (cancelado) return

        if (!error) {
          // Guarda a lista no aparelho, para a biblioteca abrir sem internet
          setObras(data as Obra[])
          guardarBiblioteca(data as Obra[])
          return
        }

        // Sem internet: mostra a última lista guardada
        const guardada = lerBibliotecaGuardada()
        if (guardada) {
          setObras(guardada)
          setSemRede(true)
        } else {
          setErro(error.message)
        }
      })

    return () => {
      cancelado = true
    }
  }, [])

  // Obras da aba aberta, filtradas pela busca (título e títulos alternativos)
  // e na ordem escolhida
  const visiveis = useMemo(() => {
    const termo = normalizar(busca)

    const filtradas = (obras ?? []).filter((obra) => {
      if (obra.status !== aba) return false
      if (esconderEmDia && estaEmDia(obra)) return false
      if (termo === '') return true
      return obra.titulo_normalizado.includes(termo) || obra.titulos_alternativos.some((t) => normalizar(t).includes(termo))
    })

    return ordenar(filtradas, ordenacao)
  }, [obras, aba, busca, ordenacao, esconderEmDia])

  const total = (id: Aba) => (obras ?? []).filter((o) => o.status === id).length

  return (
    <main className="biblioteca">
      <header className="topo">
        <h1 className="cabecalho-logo">
          <Logo />
        </h1>

        <div className="linha-busca">
          <input
            type="search"
            placeholder="Buscar obra…"
            aria-label="Buscar obra"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />

          {/* Esconde as obras em que já se leu tudo o que foi lançado */}
          <button
            type="button"
            className={esconderEmDia ? 'secundario filtro ligado' : 'secundario filtro'}
            aria-pressed={esconderEmDia}
            onClick={() => {
              salvarEsconderEmDia(!esconderEmDia)
              setEsconderEmDia(!esconderEmDia)
            }}
          >
            {esconderEmDia ? '✓ Sem em dia' : 'Esconder em dia'}
          </button>
        </div>

        <nav className="abas">
          {ABAS.map((a) => (
            <button key={a.id} type="button" className={a.id === aba ? 'aba ativa' : 'aba'} onClick={() => setAba(a.id)}>
              {a.nome} {obras && <span className="contagem">{total(a.id)}</span>}
            </button>
          ))}
        </nav>

        {/* Ordenação: o critério e o sentido (de cima para baixo ou o contrário) */}
        <div className="ordenacao">
          <select
            aria-label="Ordenar por"
            value={ordenacao.criterio}
            onChange={(e) => {
              const criterio = e.target.value as Criterio
              const inicial = CRITERIOS.find((c) => c.id === criterio)?.sentidoInicial ?? 'crescente'
              mudarOrdenacao({ criterio, sentido: inicial })
            }}
          >
            {CRITERIOS.map((c) => (
              <option key={c.id} value={c.id}>
                Ordenar: {c.nome}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="secundario sentido"
            aria-label={ordenacao.sentido === 'crescente' ? 'Ordem crescente. Tocar para inverter' : 'Ordem decrescente. Tocar para inverter'}
            onClick={() =>
              mudarOrdenacao({ ...ordenacao, sentido: ordenacao.sentido === 'crescente' ? 'decrescente' : 'crescente' })
            }
          >
            {ordenacao.sentido === 'crescente' ? '↑ menor primeiro' : '↓ maior primeiro'}
          </button>
        </div>
      </header>

      {semRede && <p className="suave aviso">Sem internet: mostrando a última lista guardada. Só abrem as obras baixadas.</p>}
      {erro && <p className="erro aviso">Não foi possível carregar: {erro}</p>}
      {!erro && obras === null && <p className="suave aviso">Carregando…</p>}
      {obras !== null && visiveis.length === 0 && <p className="suave aviso">Nenhuma obra aqui.</p>}

      <ul className="lista">
        {visiveis.map((obra) => (
          <ItemObra key={obra.id} obra={obra} noAparelho={noAparelho.get(obra.id) ?? null} />
        ))}
      </ul>
    </main>
  )
}
