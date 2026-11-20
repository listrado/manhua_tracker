import { useCallback, useEffect, useRef, useState } from 'react'
import {
  carregarCapitulos,
  carregarObra,
  carregarPaginas,
  ErroSenhaIncorreta,
  lerPosicao,
  marcarLido,
  salvarPosicao,
  type Capitulo,
  type ObraLeitor,
} from '../lib/dados'
import { esquecerSenha } from '../lib/senha'

// Leitor contínuo, versão online: os capítulos aparecem um embaixo do outro e o
// próximo é carregado sozinho quando o fim se aproxima. As imagens vêm direto
// do site de origem. No fim de cada capítulo há a caixinha "lido". O download
// para ler offline entra depois (depende do proxy de imagem).

// Distância da tela em que um capítulo conta como "perto" e fica montado.
// Longe disso ele vira um espaço reservado com a mesma altura, para o Safari
// não segurar milhares de imagens na memória.
const MARGEM_PERTO = '3000px 0px'
// Quanto antes do fim da página o próximo capítulo começa a carregar.
const MARGEM_PROXIMO = '2000px 0px'
// Tempo que o menu fica visível depois do toque.
const MENU_MS = 4000

function Pagina({ url }: { url: string }) {
  const [estado, setEstado] = useState<'carregando' | 'pronta' | 'erro'>('carregando')
  const [tentativa, setTentativa] = useState(0)

  if (estado === 'erro') {
    return (
      <button
        type="button"
        className="pagina-erro"
        onClick={(e) => {
          e.stopPropagation()
          setTentativa((t) => t + 1)
          setEstado('carregando')
        }}
      >
        Imagem não carregou. Tocar para tentar de novo.
      </button>
    )
  }

  // Sem referer: é assim que o próprio site carrega as imagens
  return (
    <img
      key={tentativa}
      className={estado === 'pronta' ? 'pagina' : 'pagina pagina-carregando'}
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={() => setEstado('pronta')}
      onError={() => setEstado('erro')}
    />
  )
}

type PropsBloco = {
  capitulo: Capitulo
  aoCarregar: (capituloId: number) => void
  aoFicarNoCentro: (numero: number) => void
  aoMarcar: (capitulo: Capitulo, lido: boolean) => void
}

function BlocoCapitulo({ capitulo, aoCarregar, aoFicarNoCentro, aoMarcar }: PropsBloco) {
  const elemento = useRef<HTMLElement>(null)
  const [paginas, setPaginas] = useState<string[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [perto, setPerto] = useState(true)
  const [alturaGuardada, setAlturaGuardada] = useState<number | null>(null)

  // Busca a lista de imagens do capítulo
  useEffect(() => {
    let cancelado = false

    carregarPaginas(capitulo.id)
      .then((lista) => {
        if (cancelado) return
        setPaginas(lista)
        aoCarregar(capitulo.id)
      })
      .catch((e: Error) => {
        if (cancelado) return
        setErro(e.message)
        // Mesmo com erro, libera o leitor para seguir para o próximo capítulo
        aoCarregar(capitulo.id)
      })

    return () => {
      cancelado = true
    }
  }, [capitulo.id, tentativa, aoCarregar])

  // Monta as imagens só quando o capítulo está perto da tela
  useEffect(() => {
    const el = elemento.current
    if (!el) return

    const observador = new IntersectionObserver(
      ([entrada]) => {
        // Ao sair de perto, guarda a altura para o espaço reservado não encolher
        if (!entrada.isIntersecting) setAlturaGuardada(el.offsetHeight)
        setPerto(entrada.isIntersecting)
      },
      { rootMargin: MARGEM_PERTO },
    )

    observador.observe(el)
    return () => observador.disconnect()
  }, [])

  // Avisa quando este capítulo cruza o meio da tela (é o que está sendo lido)
  useEffect(() => {
    const el = elemento.current
    if (!el) return

    const observador = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) aoFicarNoCentro(capitulo.numero)
      },
      { rootMargin: '-50% 0px -50% 0px' },
    )

    observador.observe(el)
    return () => observador.disconnect()
  }, [capitulo.numero, aoFicarNoCentro])

  const reservado = !perto && alturaGuardada !== null

  return (
    <section
      ref={elemento}
      className="capitulo"
      data-numero={capitulo.numero}
      style={reservado ? { height: alturaGuardada } : undefined}
    >
      {!reservado && (
        <>
          <h2 className="separador">Capítulo {capitulo.numero}</h2>

          {paginas === null && erro === null && <p className="suave aviso">Carregando capítulo {capitulo.numero}…</p>}

          {erro !== null && (
            <div className="aviso">
              <p className="erro">Não foi possível carregar o capítulo {capitulo.numero}.</p>
              <p className="suave pequeno">{erro}</p>
              <button
                type="button"
                className="secundario"
                onClick={(e) => {
                  e.stopPropagation()
                  setErro(null)
                  setTentativa((t) => t + 1)
                }}
              >
                Tentar de novo
              </button>
            </div>
          )}

          {paginas?.map((url) => <Pagina key={url} url={url} />)}

          {/* Fim do capítulo: a caixinha "lido". O toque nela não abre o menu */}
          {paginas !== null && (
            <label className="marcar-lido" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={capitulo.lido} onChange={(e) => aoMarcar(capitulo, e.target.checked)} />
              <span>Capítulo {capitulo.numero} lido</span>
            </label>
          )}
        </>
      )}
    </section>
  )
}

// Onde começar: onde parou neste aparelho; senão o primeiro capítulo depois do
// "capítulo atual" da obra; senão o primeiro de todos.
function indiceInicial(obra: ObraLeitor, capitulos: Capitulo[]): number {
  const salvo = lerPosicao(obra.id)
  if (salvo !== null) {
    const i = capitulos.findIndex((c) => c.numero === salvo)
    if (i >= 0) return i
  }

  if (obra.capitulo_atual !== null) {
    const atual = obra.capitulo_atual
    const proximo = capitulos.findIndex((c) => c.numero > atual)
    return proximo >= 0 ? proximo : capitulos.length - 1
  }

  return 0
}

export function TelaLeitor({ obraId, aoPerderAcesso }: { obraId: number; aoPerderAcesso: () => void }) {
  const [obra, setObra] = useState<ObraLeitor | null>(null)
  const [capitulos, setCapitulos] = useState<Capitulo[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Capítulos montados na página: do índice "inicio" ao "fim", inclusive
  const [inicio, setInicio] = useState(0)
  const [fim, setFim] = useState(0)
  const [carregados, setCarregados] = useState<Set<number>>(() => new Set())

  // Cópias "ao vivo" para os observadores, que rodam fora do ciclo de desenho
  const capitulosRef = useRef<Capitulo[]>([])
  const carregadosRef = useRef<Set<number>>(new Set())
  const fimVisivel = useRef(false)

  const [numeroAtual, setNumeroAtual] = useState<number | null>(null)
  const [menuAberto, setMenuAberto] = useState(false)
  const sentinela = useRef<HTMLDivElement>(null)

  // Carrega a obra e a lista de capítulos
  useEffect(() => {
    let cancelado = false

    Promise.all([carregarObra(obraId), carregarCapitulos(obraId)])
      .then(([dadosObra, lista]) => {
        if (cancelado) return
        const comeco = lista.length > 0 ? indiceInicial(dadosObra, lista) : 0

        capitulosRef.current = lista
        setObra(dadosObra)
        setCapitulos(lista)
        setInicio(comeco)
        setFim(comeco)
        setNumeroAtual(lista[comeco]?.numero ?? null)
      })
      .catch((e: Error) => {
        if (!cancelado) setErro(e.message)
      })

    return () => {
      cancelado = true
    }
  }, [obraId])

  // Fim da página perto + último capítulo já carregado = monta o próximo.
  // É chamada nos dois momentos em que isso pode passar a ser verdade: quando
  // o fim da página entra na tela e quando um capítulo termina de carregar.
  const avancarSePuder = useCallback(() => {
    setFim((atual) => {
      const lista = capitulosRef.current
      const ultimo = lista[atual]
      const pode = fimVisivel.current && ultimo && carregadosRef.current.has(ultimo.id) && atual < lista.length - 1
      return pode ? atual + 1 : atual
    })
  }, [])

  // Observa o fim da página
  useEffect(() => {
    const el = sentinela.current
    if (!el) return

    const observador = new IntersectionObserver(
      ([entrada]) => {
        fimVisivel.current = entrada.isIntersecting
        avancarSePuder()
      },
      { rootMargin: MARGEM_PROXIMO },
    )

    observador.observe(el)
    return () => observador.disconnect()
  }, [capitulos.length, avancarSePuder])

  // O menu some sozinho depois de alguns segundos
  useEffect(() => {
    if (!menuAberto) return
    const relogio = setTimeout(() => setMenuAberto(false), MENU_MS)
    return () => clearTimeout(relogio)
  }, [menuAberto, numeroAtual])

  const aoCarregar = useCallback(
    (capituloId: number) => {
      carregadosRef.current.add(capituloId)
      setCarregados(new Set(carregadosRef.current))
      avancarSePuder()
    },
    [avancarSePuder],
  )

  // Guarda no aparelho o capítulo que está no meio da tela
  const aoFicarNoCentro = useCallback(
    (numero: number) => {
      setNumeroAtual(numero)
      salvarPosicao(obraId, numero)
    },
    [obraId],
  )

  // Marca ou desmarca um capítulo como lido
  const aoMarcar = useCallback(
    (capitulo: Capitulo, lido: boolean) => {
      const aplicar = (valor: boolean) => {
        const nova = capitulosRef.current.map((c) => (c.id === capitulo.id ? { ...c, lido: valor } : c))
        capitulosRef.current = nova
        setCapitulos(nova)
      }

      // Mostra na hora; se o banco recusar, desfaz
      aplicar(lido)
      setAviso(null)

      marcarLido(capitulo.id, lido).catch((e: Error) => {
        aplicar(!lido)

        // Senha guardada não vale mais (foi trocada): pede de novo
        if (e instanceof ErroSenhaIncorreta) {
          esquecerSenha()
          aoPerderAcesso()
          return
        }
        setAviso(`Não foi possível salvar o capítulo ${capitulo.numero}: ${e.message}`)
      })
    },
    [aoPerderAcesso],
  )

  // Pular: recomeça a página a partir do capítulo escolhido
  function pularPara(indice: number) {
    setInicio(indice)
    setFim(indice)
    setNumeroAtual(capitulos[indice].numero)
    salvarPosicao(obraId, capitulos[indice].numero)
    window.scrollTo(0, 0)
  }

  if (erro) {
    return (
      <main className="tela-centro">
        <section className="cartao">
          <p className="erro">Não foi possível abrir a obra: {erro}</p>
          <a href="#/">Voltar para a biblioteca</a>
        </section>
      </main>
    )
  }

  if (!obra) return <main className="tela-centro suave">Carregando…</main>

  if (capitulos.length === 0) {
    return (
      <main className="tela-centro">
        <section className="cartao">
          <h1>{obra.titulo}</h1>
          <p className="suave">Esta obra ainda não tem capítulos cadastrados.</p>
          <a href="#/">Voltar para a biblioteca</a>
        </section>
      </main>
    )
  }

  const indiceAtual = capitulos.findIndex((c) => c.numero === numeroAtual)

  return (
    // Um toque em qualquer ponto da leitura mostra ou esconde o menu
    <main className="leitor" onClick={() => setMenuAberto((aberto) => !aberto)}>
      {menuAberto && (
        <div className="menu-leitor" onClick={(e) => e.stopPropagation()}>
          <a className="menu-voltar" href="#/">
            ← Biblioteca
          </a>

          <span className="menu-titulo">{obra.titulo}</span>

          <select
            aria-label="Pular para capítulo"
            value={indiceAtual >= 0 ? indiceAtual : inicio}
            onChange={(e) => pularPara(Number(e.target.value))}
          >
            {capitulos.map((c, i) => (
              <option key={c.id} value={i}>
                Capítulo {c.numero}
                {c.lido ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {inicio > 0 && (
        <button
          type="button"
          className="secundario anterior"
          onClick={(e) => {
            e.stopPropagation()
            pularPara(inicio - 1)
          }}
        >
          Capítulo anterior ({capitulos[inicio - 1].numero})
        </button>
      )}

      {capitulos.slice(inicio, fim + 1).map((capitulo) => (
        <BlocoCapitulo
          key={capitulo.id}
          capitulo={capitulo}
          aoCarregar={aoCarregar}
          aoFicarNoCentro={aoFicarNoCentro}
          aoMarcar={aoMarcar}
        />
      ))}

      {aviso && (
        <button type="button" className="aviso-flutuante" onClick={(e) => (e.stopPropagation(), setAviso(null))}>
          {aviso}
        </button>
      )}

      <div ref={sentinela} className="fim-leitor">
        {fim >= capitulos.length - 1 && carregados.has(capitulos[fim].id) && (
          <p className="suave aviso">Você chegou ao último capítulo disponível.</p>
        )}
      </div>
    </main>
  )
}
