import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Versão inicial da biblioteca: só leitura. Lista as obras em duas abas, com
// busca, capa e link para o site de origem. Ordenações, aba "Confirmar",
// adicionar obra e as ações por obra entram na fase 4; o leitor, na fase 5.

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

function ItemObra({ obra }: { obra: Obra }) {
  const link = linkDaObra(obra)
  const progresso =
    obra.capitulo_atual === null
      ? obra.total_capitulos
        ? `${obra.total_capitulos} capítulos`
        : 'sem capítulo lido'
      : `cap. ${obra.capitulo_atual}${obra.total_capitulos ? ` / ${obra.total_capitulos}` : ''}`

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
          {obra.tem_novo && <span className="selo">novo</span>}
        </span>
        {!link && <span className="suave pequeno">link ainda não encontrado</span>}
      </div>
    </>
  )

  // Enquanto o leitor não existe, tocar na obra abre o site de origem
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

  useEffect(() => {
    if (!supabase) return
    let cancelado = false

    // Carrega todas as obras de uma vez (são algumas centenas), já com as fontes
    supabase
      .from('obras')
      .select(
        'id,titulo,titulo_normalizado,titulos_alternativos,status,capitulo_atual,total_capitulos,capa_path,tem_novo,fontes(url_obra,prioridade,ativa)',
      )
      .order('titulo')
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) setErro(error.message)
        else setObras(data as Obra[])
      })

    return () => {
      cancelado = true
    }
  }, [])

  // Obras da aba aberta, filtradas pela busca (título e títulos alternativos)
  const visiveis = useMemo(() => {
    const termo = normalizar(busca)

    return (obras ?? []).filter((obra) => {
      if (obra.status !== aba) return false
      if (termo === '') return true
      return obra.titulo_normalizado.includes(termo) || obra.titulos_alternativos.some((t) => normalizar(t).includes(termo))
    })
  }, [obras, aba, busca])

  const total = (id: Aba) => (obras ?? []).filter((o) => o.status === id).length

  return (
    <main className="biblioteca">
      <header className="topo">
        <input
          type="search"
          placeholder="Buscar obra…"
          aria-label="Buscar obra"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        <nav className="abas">
          {ABAS.map((a) => (
            <button key={a.id} type="button" className={a.id === aba ? 'aba ativa' : 'aba'} onClick={() => setAba(a.id)}>
              {a.nome} {obras && <span className="contagem">{total(a.id)}</span>}
            </button>
          ))}
        </nav>
      </header>

      {erro && <p className="erro aviso">Não foi possível carregar: {erro}</p>}
      {!erro && obras === null && <p className="suave aviso">Carregando…</p>}
      {obras !== null && visiveis.length === 0 && <p className="suave aviso">Nenhuma obra aqui.</p>}

      <ul className="lista">
        {visiveis.map((obra) => (
          <ItemObra key={obra.id} obra={obra} />
        ))}
      </ul>
    </main>
  )
}
