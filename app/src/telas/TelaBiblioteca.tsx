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
import { guardarCapasQueFaltam, URL_CAPAS, type Capitulo, type ObraLeitor } from '../lib/dados'
import { formatarBytes, lerCapas, obrasGuardadas, resumoPorObra, type CapaGuardada, type ResumoOffline } from '../lib/offline'
import { comPrazo, semConexao } from '../lib/rede'
import { supabase } from '../lib/supabase'

// Biblioteca: lista as obras em duas abas, com busca, ordenação e capa; tocar
// numa obra abre o leitor. Obras "hot" (capítulo novo em obra que estava em
// dia) ficam no topo por uma semana. Aba "Confirmar", adicionar obra e as
// ações por obra ainda não existem.
//
// Sem internet, entra no MODO OFFLINE: mostra só as obras baixadas no aparelho
// (de todas as abas), com a capa guardada, e volta sozinha quando a internet volta.

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

// Quanto a biblioteca espera pelo servidor antes de entrar no modo offline
const PRAZO_MS = 8000

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

// Obra baixada que não está na última lista guardada: monta o item a partir
// da cópia que o download guardou.
function obraDaCopia(obraId: number, obra: ObraLeitor, capitulos: Capitulo[]): Obra {
  return {
    id: obraId,
    titulo: obra.titulo,
    titulo_normalizado: normalizar(obra.titulo),
    titulos_alternativos: [],
    status: 'lendo',
    capitulo_atual: obra.capitulo_atual,
    total_capitulos: capitulos.length,
    capa_path: obra.capa_path ?? null,
    tem_novo: false,
    ultima_leitura_em: null,
    quente_ate: null,
    fontes: [],
  }
}

// Lista do modo offline: a última lista guardada mais as obras baixadas que
// não estão nela (o filtro de "só baixadas" é feito na hora de mostrar).
async function listaOffline(): Promise<Obra[]> {
  const porId = new Map((lerBibliotecaGuardada() ?? []).map((o) => [o.id, o]))
  const copias = await obrasGuardadas<ObraLeitor, Capitulo>().catch(() => [])

  for (const { obraId, guardada } of copias) {
    if (!porId.has(obraId)) porId.set(obraId, obraDaCopia(obraId, guardada.obra, guardada.capitulos))
  }
  return [...porId.values()]
}

// Capa da obra. Se a imagem não carregar (sem internet), fica o espaço vazio
// em vez do ícone de imagem quebrada.
function Capa({ src }: { src: string | null }) {
  const [falhou, setFalhou] = useState(false)
  if (!src || falhou) return <div className="capa capa-vazia" aria-hidden="true" />
  return <img className="capa" src={src} alt="" loading="lazy" onError={() => setFalhou(true)} />
}

type PropsItem = { obra: Obra; noAparelho: ResumoOffline | null; capaLocal: string | null }

function ItemObra({ obra, noAparelho, capaLocal }: PropsItem) {
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

  // A capa guardada no aparelho vale mais: abre sem internet e não gasta dados
  const capa = capaLocal ?? (obra.capa_path ? URL_CAPAS + obra.capa_path : null)

  const conteudo = (
    <>
      <Capa key={capa ?? ''} src={capa} />

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

  // Obra com capítulos cadastrados (ou baixados) abre no leitor do app
  if (obra.total_capitulos || (noAparelho?.capitulos ?? 0) > 0) {
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
  const [aba, setAba] = useState<Aba>('lendo')
  const [busca, setBusca] = useState('')
  const [ordenacao, setOrdenacao] = useState<Ordenacao>(() => lerOrdenacao())
  const [esconderEmDia, setEsconderEmDia] = useState(() => lerEsconderEmDia())
  // O que está baixado no aparelho, por obra (null = ainda lendo do aparelho)
  const [noAparelho, setNoAparelho] = useState<Map<number, ResumoOffline> | null>(null)
  // Capas guardadas no aparelho, já como endereços que a <img> entende
  const [capas, setCapas] = useState<Map<number, string>>(() => new Map())

  // Modo offline: sem internet, só as obras baixadas aparecem
  const [modoOffline, setModoOffline] = useState(false)
  // Por que entrou no modo offline quando o aparelho diz que TEM conexão
  // ("a internet não respondeu a tempo", erro do servidor); null quando está
  // mesmo sem conexão
  const [motivoOffline, setMotivoOffline] = useState<string | null>(null)
  // Cada mudança tenta falar com o servidor de novo
  const [tentativa, setTentativa] = useState(0)
  const [conectando, setConectando] = useState(false)

  // Troca a ordenação e guarda a escolha no aparelho
  function mudarOrdenacao(nova: Ordenacao) {
    setOrdenacao(nova)
    salvarOrdenacao(nova)
  }

  // O que está baixado no aparelho e as capas guardadas dessas obras
  useEffect(() => {
    let cancelado = false
    const enderecos: string[] = []

    void (async () => {
      const resumo = await resumoPorObra().catch(() => new Map<number, ResumoOffline>())
      if (cancelado) return
      setNoAparelho(resumo)

      // Os bytes de cada capa viram um endereço temporário, liberado ao sair da tela
      const guardadas = await lerCapas([...resumo.keys()]).catch(() => new Map<number, CapaGuardada>())
      if (cancelado) return
      const mapa = new Map<number, string>()
      for (const [id, capa] of guardadas) {
        const endereco = URL.createObjectURL(new Blob([capa.dados], { type: capa.tipo }))
        enderecos.push(endereco)
        mapa.set(id, endereco)
      }
      setCapas(mapa)
    })()

    return () => {
      cancelado = true
      for (const endereco of enderecos) URL.revokeObjectURL(endereco)
    }
  }, [])

  // A lista de obras: do servidor; sem internet, do aparelho (modo offline)
  useEffect(() => {
    const cliente = supabase
    if (!cliente) return
    let cancelado = false

    const entrarNoModoOffline = async (motivo: string | null) => {
      const lista = await listaOffline()
      if (cancelado) return
      setObras(lista)
      setModoOffline(true)
      setMotivoOffline(motivo)
      setConectando(false)
    }

    // O aparelho já sabe que está sem conexão: nem tenta o servidor
    if (semConexao()) {
      void entrarNoModoOffline(null)
      return () => {
        cancelado = true
      }
    }

    // Todas as obras de uma vez (são algumas centenas), já com as fontes. Sem
    // as novas tentativas automáticas do Supabase: sem internet elas só atrasam.
    comPrazo(PRAZO_MS, (sinal) =>
      cliente
        .from('obras')
        .select(
          'id,titulo,titulo_normalizado,titulos_alternativos,status,capitulo_atual,total_capitulos,capa_path,tem_novo,ultima_leitura_em,quente_ate,fontes(url_obra,prioridade,ativa)',
        )
        .order('titulo')
        .abortSignal(sinal)
        .retry(false),
    )
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) throw new Error(error.message)

        const lista = data as Obra[]
        setObras(lista)
        setModoOffline(false)
        setMotivoOffline(null)
        setConectando(false)

        // Guarda a lista no aparelho, para a biblioteca abrir sem internet, e
        // a capa das obras baixadas que ainda não têm
        guardarBiblioteca(lista)
        void guardarCapasQueFaltam(lista).catch(() => {})
      })
      .catch((erro: unknown) => {
        if (cancelado) return
        void entrarNoModoOffline(semConexao() ? null : erro instanceof Error ? erro.message : String(erro))
      })

    return () => {
      cancelado = true
    }
  }, [tentativa])

  // No modo offline, a internet voltou: busca a lista de novo
  useEffect(() => {
    if (!modoOffline) return
    const voltou = () => setTentativa((t) => t + 1)

    window.addEventListener('online', voltou)
    return () => window.removeEventListener('online', voltou)
  }, [modoOffline])

  // Obras da aba aberta (no modo offline: as baixadas, de todas as abas),
  // filtradas pela busca (título e títulos alternativos) e na ordem escolhida
  const visiveis = useMemo(() => {
    const termo = normalizar(busca)

    const filtradas = (obras ?? []).filter((obra) => {
      if (modoOffline) {
        if ((noAparelho?.get(obra.id)?.capitulos ?? 0) === 0) return false
      } else {
        if (obra.status !== aba) return false
        if (esconderEmDia && estaEmDia(obra)) return false
      }
      if (termo === '') return true
      return obra.titulo_normalizado.includes(termo) || obra.titulos_alternativos.some((t) => normalizar(t).includes(termo))
    })

    return ordenar(filtradas, ordenacao)
  }, [obras, aba, busca, ordenacao, esconderEmDia, modoOffline, noAparelho])

  const total = (id: Aba) => (obras ?? []).filter((o) => o.status === id).length
  const totalBaixadas = (obras ?? []).filter((o) => (noAparelho?.get(o.id)?.capitulos ?? 0) > 0).length
  // No modo offline a lista depende do que está no aparelho
  const carregando = obras === null || (modoOffline && noAparelho === null)

  return (
    <main className="biblioteca">
      <header className="topo">
        <h1 className="cabecalho-logo">
          <Logo />
        </h1>

        {modoOffline && (
          <div className="faixa-offline" role="status">
            <div className="faixa-offline-texto">
              <strong>Modo offline</strong>
              <span className="suave pequeno">
                Só as obras baixadas no aparelho.{motivoOffline && ` (${motivoOffline})`}
              </span>
            </div>
            <button
              type="button"
              className="secundario"
              disabled={conectando}
              onClick={() => {
                setConectando(true)
                setTentativa((t) => t + 1)
              }}
            >
              {conectando ? 'Conectando…' : 'Tentar conectar'}
            </button>
          </div>
        )}

        <div className="linha-busca">
          <input
            type="search"
            placeholder="Buscar obra…"
            aria-label="Buscar obra"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />

          {/* Esconde as obras em que já se leu tudo o que foi lançado (no modo
              offline não se aplica: lá aparecem todas as baixadas) */}
          {!modoOffline && (
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
          )}
        </div>

        {/* Modo offline: no lugar das abas, uma só com as obras baixadas */}
        {modoOffline ? (
          <div className="abas">
            <span className="aba ativa aba-unica">
              Baixadas no aparelho {noAparelho && <span className="contagem">{totalBaixadas}</span>}
            </span>
          </div>
        ) : (
          <nav className="abas">
            {ABAS.map((a) => (
              <button key={a.id} type="button" className={a.id === aba ? 'aba ativa' : 'aba'} onClick={() => setAba(a.id)}>
                {a.nome} {obras && <span className="contagem">{total(a.id)}</span>}
              </button>
            ))}
          </nav>
        )}

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

      {carregando && <p className="suave aviso">Carregando…</p>}

      {!carregando && visiveis.length === 0 && (
        <p className="suave aviso">
          {modoOffline && totalBaixadas === 0
            ? 'Nenhuma obra baixada no aparelho. Para ler sem internet, abra a obra com internet e use o menu ☰ › Baixar para ler offline.'
            : 'Nenhuma obra aqui.'}
        </p>
      )}

      <ul className="lista">
        {visiveis.map((obra) => (
          <ItemObra key={obra.id} obra={obra} noAparelho={noAparelho?.get(obra.id) ?? null} capaLocal={capas.get(obra.id) ?? null} />
        ))}
      </ul>
    </main>
  )
}
