import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { assinarDownload, baixarObra, estadoDoDownload, pararDownload } from '../lib/baixar'
import {
  carregarObraECapitulos,
  carregarPaginas,
  ErroSenhaIncorreta,
  lerModoAutomatico,
  lerPosicao,
  marcarLido,
  numerosOffline,
  salvarModoAutomatico,
  salvarPosicao,
  type Capitulo,
  type ObraLeitor,
  type PaginaCapitulo,
  type Posicao,
} from '../lib/dados'
import { apagarObra, formatarBytes, lerPagina, resumoPorObra, type ResumoOffline } from '../lib/offline'
import { esquecerSenha } from '../lib/senha'

// Leitor contínuo: os capítulos aparecem um embaixo do outro e os próximos são
// carregados sozinhos. As imagens vêm do site de origem ou, para capítulo
// baixado, do próprio aparelho (leitura offline). No fim de cada capítulo há o
// botão de marcar como lido.

// Quantos capítulos À FRENTE do que está sendo lido ficam carregados (lista de
// imagens e as próprias imagens). Assim, se a internet cair, dá para seguir
// lendo. Não é a obra inteira: centenas de capítulos não cabem na memória do
// Safari — para isso existe o download offline.
const CAPITULOS_ADIANTE = 5

// Distância da tela em que um capítulo JÁ LIDO (acima) ainda fica montado.
// Além disso ele vira um espaço reservado com a mesma altura, para o Safari
// não segurar milhares de imagens na memória. Os capítulos abaixo nunca são
// desmontados: são os que ainda vão ser lidos.
const MARGEM_PERTO = '3000px 0px'
// Quanto antes do fim da página o próximo capítulo começa a carregar.
const MARGEM_PROXIMO = '2000px 0px'
// Tempo que o menu fica visível depois do último toque.
const MENU_MS = 6000
// Por quanto tempo o leitor insiste em voltar ao ponto salvo depois de abrir
// (as imagens de cima vão chegando e empurrando a página).
const RESTAURAR_MS = 20000
// De quanto em quanto tempo a posição de leitura é gravada enquanto se rola.
const SALVAR_POSICAO_MS = 400

// proporcao: altura/largura da imagem, conhecida de uma leitura anterior
type PropsPagina = { pagina: PaginaCapitulo; proporcao: number | null; aoCarregar: () => void }

function Pagina({ pagina, proporcao, aoCarregar }: PropsPagina) {
  const [estado, setEstado] = useState<'carregando' | 'pronta' | 'erro'>('carregando')
  const [tentativa, setTentativa] = useState(0)
  // Falhou pelo caminho principal: passa a usar a reserva (o proxy de imagem)
  const [usarReserva, setUsarReserva] = useState(false)
  // Imagem guardada no aparelho: endereço temporário criado a partir dos bytes
  const [enderecoLocal, setEnderecoLocal] = useState<string | null>(null)

  // Página offline: lê os bytes do aparelho e cria um endereço temporário.
  // O endereço é liberado quando a página sai da tela, para não vazar memória.
  useEffect(() => {
    if (pagina.origem !== 'aparelho') return
    let cancelado = false
    let criado: string | null = null

    lerPagina(pagina.obraId, pagina.numero, pagina.indice)
      .then((guardada) => {
        if (cancelado) return
        if (!guardada) {
          setEstado('erro')
          return
        }
        criado = URL.createObjectURL(new Blob([guardada.dados], { type: guardada.tipo }))
        setEnderecoLocal(criado)
      })
      .catch(() => {
        if (!cancelado) setEstado('erro')
      })

    return () => {
      cancelado = true
      if (criado) URL.revokeObjectURL(criado)
    }
  }, [pagina, tentativa])

  const url = pagina.origem === 'aparelho' ? enderecoLocal : usarReserva && pagina.reserva ? pagina.reserva : pagina.url

  if (estado === 'erro') {
    return (
      <button
        type="button"
        className="pagina-item pagina-erro"
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

  // Enquanto a imagem não chega, o espaço reservado tem o tamanho exato dela
  // (quando a proporção é conhecida); senão vale a altura padrão do CSS
  const reserva = proporcao !== null && estado !== 'pronta' ? { aspectRatio: `1 / ${proporcao}`, minHeight: 0 } : undefined

  // Ainda lendo do aparelho: reserva o espaço
  if (url === null) return <div className="pagina-item pagina pagina-carregando" style={reserva} />

  // Sem referer: é assim que o próprio site carrega as imagens.
  // loading="eager": a imagem baixa assim que o capítulo é montado, mesmo
  // longe da tela — é isso que adianta os capítulos seguintes.
  return (
    <img
      key={`${tentativa}-${usarReserva}`}
      className={estado === 'pronta' ? 'pagina-item pagina' : 'pagina-item pagina pagina-carregando'}
      style={reserva}
      src={url}
      alt=""
      loading="eager"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={() => {
        setEstado('pronta')
        aoCarregar()
      }}
      onError={() => {
        // Primeira falha com reserva disponível: tenta pelo proxy, sem incomodar
        if (pagina.origem === 'rede' && !usarReserva && pagina.reserva) setUsarReserva(true)
        else setEstado('erro')
      }}
    />
  )
}

type PropsBloco = {
  obraId: number
  capitulo: Capitulo
  offline: boolean
  // Proporções das imagens guardadas junto com o ponto de leitura (ou null)
  proporcoes: (number | null)[] | null
  aoCarregar: (capituloId: number) => void
  aoFicarNoCentro: (numero: number) => void
  aoMarcar: (capitulo: Capitulo, lido: boolean) => void
  // Avisa que a altura do capítulo mudou (páginas montadas ou imagem carregada)
  aoMudarAltura: (numero: number, indice: number) => void
  // Modo automático: marca sozinho quando o fim do capítulo passa pela tela
  automatico: boolean
}

function BlocoCapitulo({ obraId, capitulo, offline, proporcoes, aoCarregar, aoFicarNoCentro, aoMarcar, aoMudarAltura, automatico }: PropsBloco) {
  const elemento = useRef<HTMLElement>(null)
  const fimDoCapitulo = useRef<HTMLButtonElement>(null)
  const jaMarcouSozinho = useRef(false)
  const [paginas, setPaginas] = useState<PaginaCapitulo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [perto, setPerto] = useState(true)
  const [alturaGuardada, setAlturaGuardada] = useState<number | null>(null)

  // Busca a lista de imagens do capítulo (no aparelho, se estiver baixado)
  useEffect(() => {
    let cancelado = false

    carregarPaginas(obraId, capitulo)
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
    // Só o id e o número importam: marcar "lido" não deve buscar as páginas de novo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId, capitulo.id, capitulo.numero, tentativa, aoCarregar])

  // As páginas acabaram de ser montadas: a altura do capítulo mudou
  const numero = capitulo.numero
  useLayoutEffect(() => {
    if (paginas !== null) aoMudarAltura(numero, -1)
  }, [paginas, numero, aoMudarAltura])

  // Desmonta as imagens só de capítulo que ficou para trás (bem acima da tela)
  useEffect(() => {
    const el = elemento.current
    if (!el) return

    const observador = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) {
          setPerto(true)
          return
        }

        // Longe e ACIMA da tela: guarda a altura e vira espaço reservado.
        // Longe e abaixo: fica montado, é capítulo adiantado para leitura.
        if (entrada.boundingClientRect.bottom < 0) {
          setAlturaGuardada(el.offsetHeight)
          setPerto(false)
        }
      },
      { rootMargin: MARGEM_PERTO },
    )

    observador.observe(el)
    return () => observador.disconnect()
  }, [])

  // Modo automático: quando o botão do fim do capítulo aparece na tela, marca
  // como lido — uma vez só, para o usuário poder desmarcar à mão depois
  const temPaginas = paginas !== null
  useEffect(() => {
    const el = fimDoCapitulo.current
    if (!el || !automatico || !temPaginas || capitulo.lido || jaMarcouSozinho.current) return

    const observador = new IntersectionObserver(([entrada]) => {
      if (!entrada.isIntersecting) return
      jaMarcouSozinho.current = true
      aoMarcar(capitulo, true)
    })

    observador.observe(el)
    return () => observador.disconnect()
  }, [automatico, temPaginas, capitulo, aoMarcar])

  // Avisa quando este capítulo cruza o meio da tela (é o que está sendo lido)
  useEffect(() => {
    const el = elemento.current
    if (!el) return

    const observador = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) aoFicarNoCentro(numero)
      },
      { rootMargin: '-50% 0px -50% 0px' },
    )

    observador.observe(el)
    return () => observador.disconnect()
  }, [numero, aoFicarNoCentro])

  const reservado = !perto && alturaGuardada !== null

  return (
    <section ref={elemento} className="capitulo" data-numero={numero} style={reservado ? { height: alturaGuardada } : undefined}>
      {!reservado && (
        <>
          <h2 className="separador">
            Capítulo {numero}
            {offline && <span className="selo selo-offline">offline</span>}
          </h2>

          {paginas === null && erro === null && <p className="suave aviso">Carregando capítulo {numero}…</p>}

          {erro !== null && (
            <div className="aviso">
              <p className="erro">Não foi possível carregar o capítulo {numero}.</p>
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

          {paginas?.map((pagina, indice) => (
            <Pagina
              key={pagina.origem === 'rede' ? pagina.url : `aparelho-${pagina.indice}`}
              pagina={pagina}
              proporcao={proporcoes?.[indice] ?? null}
              aoCarregar={() => aoMudarAltura(numero, indice)}
            />
          ))}

          {/* Fim do capítulo: botão grande de marcar como lido. O toque nele não abre o menu */}
          {paginas !== null && (
            <button
              ref={fimDoCapitulo}
              type="button"
              className={capitulo.lido ? 'marcar-lido marcado' : 'marcar-lido'}
              aria-pressed={capitulo.lido}
              onClick={(e) => {
                e.stopPropagation()
                aoMarcar(capitulo, !capitulo.lido)
              }}
            >
              {capitulo.lido ? `✓ Capítulo ${numero} lido` : `Marcar capítulo ${numero} como lido`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

// Onde começar: onde parou neste aparelho; senão o primeiro capítulo depois do
// "capítulo atual" da obra; senão o primeiro de todos.
function indiceInicial(obra: ObraLeitor, capitulos: Capitulo[], salva: Posicao | null): number {
  if (salva !== null) {
    const i = capitulos.findIndex((c) => c.numero === salva.numero)
    if (i >= 0) return i
  }

  if (obra.capitulo_atual !== null) {
    const atual = obra.capitulo_atual
    const proximo = capitulos.findIndex((c) => c.numero > atual)
    return proximo >= 0 ? proximo : capitulos.length - 1
  }

  return 0
}

// Altura/largura das imagens do capítulo até a de índice dado (null = a imagem
// ainda não carregou). Vai junto com o ponto de leitura.
function proporcoesAte(itens: NodeListOf<HTMLElement>, indice: number): (number | null)[] {
  return [...itens].slice(0, indice + 1).map((item) => {
    if (!(item instanceof HTMLImageElement) || item.naturalWidth === 0) return null
    return Math.round((item.naturalHeight / item.naturalWidth) * 10000) / 10000
  })
}

// Mede o ponto de leitura: qual capítulo está no topo da tela, qual imagem
// dele e quanto dessa imagem já passou.
function medirPosicao(): Posicao | null {
  for (const secao of document.querySelectorAll<HTMLElement>('.capitulo')) {
    if (secao.getBoundingClientRect().bottom <= 1) continue

    // Capítulo desmontado (espaço reservado) não tem imagens para medir
    const itens = secao.querySelectorAll<HTMLElement>('.pagina-item')
    if (itens.length === 0) return null

    // Primeira imagem que ainda não saiu inteira pelo topo
    for (let indice = 0; indice < itens.length; indice++) {
      const caixa = itens[indice].getBoundingClientRect()
      if (caixa.bottom <= 1) continue

      const fracao = caixa.height > 0 ? Math.min(1, Math.max(0, -caixa.top / caixa.height)) : 0
      return { numero: Number(secao.dataset.numero), indice, fracao, proporcoes: proporcoesAte(itens, indice) }
    }

    // Passou de todas as imagens: está no botão do fim do capítulo
    const ultima = itens.length - 1
    return { numero: Number(secao.dataset.numero), indice: ultima, fracao: 1, proporcoes: proporcoesAte(itens, ultima) }
  }

  return null
}

export function TelaLeitor({ obraId, aoPerderAcesso }: { obraId: number; aoPerderAcesso: () => void }) {
  const [obra, setObra] = useState<ObraLeitor | null>(null)
  const [capitulos, setCapitulos] = useState<Capitulo[]>([])
  const [semRede, setSemRede] = useState(false)
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
  const indiceLendo = useRef(0)

  // Ponto salvo para o qual o leitor ainda está voltando depois de abrir
  const restaurando = useRef<Posicao | null>(null)
  // A volta ao ponto salvo já foi aplicada pelo menos uma vez? Antes disso, um
  // toque na tela não cancela a volta (o capítulo ainda nem apareceu).
  const voltaAplicada = useRef(false)
  // Ponto salvo com que o leitor abriu: dá as proporções das imagens do capítulo
  const [pontoInicial, setPontoInicial] = useState<Posicao | null>(null)

  // Modo de marcar como lido: ao tocar (padrão) ou automático. Fica guardado no aparelho
  const [automatico, setAutomatico] = useState(() => lerModoAutomatico())

  const [numeroAtual, setNumeroAtual] = useState<number | null>(null)
  const [menuAberto, setMenuAberto] = useState(false)
  const sentinela = useRef<HTMLDivElement>(null)

  // Leitura offline: o download em andamento e o que já está no aparelho
  const download = useSyncExternalStore(assinarDownload, estadoDoDownload)
  const downloadDaObra = download?.obraId === obraId ? download : null
  const [offline, setOffline] = useState<Set<number>>(() => new Set())
  const [resumo, setResumo] = useState<ResumoOffline | null>(null)
  const [confirmarApagar, setConfirmarApagar] = useState(false)

  // Relê do aparelho o que está baixado desta obra
  const atualizarOffline = useCallback(() => {
    numerosOffline(obraId).then(setOffline)
    resumoPorObra()
      .then((porObra) => setResumo(porObra.get(obraId) ?? null))
      .catch(() => setResumo(null))
  }, [obraId])

  // Ao abrir e a cada capítulo que o download termina
  const capitulosBaixados = downloadDaObra?.feitos ?? 0
  const situacaoDoDownload = downloadDaObra?.situacao ?? null
  useEffect(() => {
    atualizarOffline()
  }, [atualizarOffline, capitulosBaixados, situacaoDoDownload])

  // Carrega a obra e a lista de capítulos (da rede ou do aparelho)
  useEffect(() => {
    let cancelado = false

    carregarObraECapitulos(obraId)
      .then(({ obra: dadosObra, capitulos: lista, semRede: daCopia }) => {
        if (cancelado) return
        const salva = lerPosicao(obraId)
        const comeco = lista.length > 0 ? indiceInicial(dadosObra, lista, salva) : 0

        // Se havia um ponto salvo dentro deste capítulo, o leitor volta até ele
        const voltarPara = salva !== null && lista[comeco]?.numero === salva.numero ? salva : null
        restaurando.current = voltarPara && (voltarPara.indice > 0 || voltarPara.fracao > 0) ? voltarPara : null

        capitulosRef.current = lista
        indiceLendo.current = comeco
        setPontoInicial(voltarPara)
        setObra(dadosObra)
        setCapitulos(lista)
        setSemRede(daCopia)
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

  // Volta ao ponto salvo. Chamada toda vez que a altura do capítulo muda:
  // as imagens de cima chegam aos poucos e empurram a página.
  const aoMudarAltura = useCallback((numero: number, indice: number) => {
    const alvo = restaurando.current
    if (!alvo || alvo.numero !== numero || indice > alvo.indice) return

    const itens = document.querySelectorAll<HTMLElement>(`.capitulo[data-numero="${numero}"] .pagina-item`)
    const item = itens[Math.min(alvo.indice, itens.length - 1)]
    if (!item) return

    const caixa = item.getBoundingClientRect()
    window.scrollTo(0, window.scrollY + caixa.top + caixa.height * alvo.fracao)
    voltaAplicada.current = true
  }, [])

  // O leitor para de insistir no ponto salvo assim que o usuário mexe na
  // página (mas só depois de já ter voltado ao ponto), ou depois de um tempo
  useEffect(() => {
    const soltar = () => {
      restaurando.current = null
    }
    const soltarSeJaVoltou = () => {
      if (voltaAplicada.current) soltar()
    }
    const relogio = setTimeout(soltar, RESTAURAR_MS)

    // O próprio leitor cuida da posição; o navegador não deve tentar também
    history.scrollRestoration = 'manual'

    window.addEventListener('touchstart', soltarSeJaVoltou, { passive: true })
    window.addEventListener('wheel', soltarSeJaVoltou, { passive: true })
    window.addEventListener('keydown', soltarSeJaVoltou)
    return () => {
      clearTimeout(relogio)
      history.scrollRestoration = 'auto'
      window.removeEventListener('touchstart', soltarSeJaVoltou)
      window.removeEventListener('wheel', soltarSeJaVoltou)
      window.removeEventListener('keydown', soltarSeJaVoltou)
    }
  }, [obraId])

  // Grava o ponto de leitura enquanto se rola e quando a página vai embora
  // (o Safari descarta abas em segundo plano sem avisar)
  useEffect(() => {
    let ultimaVez = 0
    let agendado: ReturnType<typeof setTimeout> | null = null

    const gravar = () => {
      agendado = null
      ultimaVez = Date.now()
      if (restaurando.current !== null) return

      const posicao = medirPosicao()
      if (posicao) salvarPosicao(obraId, posicao)
    }

    // No máximo uma gravação a cada SALVAR_POSICAO_MS, sempre com uma no fim da rolagem
    const aoRolar = () => {
      if (agendado !== null) return
      agendado = setTimeout(gravar, Math.max(0, ultimaVez + SALVAR_POSICAO_MS - Date.now()))
    }

    window.addEventListener('scroll', aoRolar, { passive: true })
    window.addEventListener('pagehide', gravar)
    document.addEventListener('visibilitychange', gravar)
    return () => {
      if (agendado !== null) clearTimeout(agendado)
      window.removeEventListener('scroll', aoRolar)
      window.removeEventListener('pagehide', gravar)
      document.removeEventListener('visibilitychange', gravar)
    }
  }, [obraId])

  // Monta o próximo capítulo quando o último montado já carregou E (o fim da
  // página está perto OU ainda faltam capítulos adiantados à frente do que
  // está sendo lido). Um de cada vez, para não disparar tudo junto.
  // É chamada sempre que isso pode passar a ser verdade: o fim da página entra
  // na tela, um capítulo termina de carregar ou o leitor muda de capítulo.
  const avancarSePuder = useCallback(() => {
    setFim((atual) => {
      const lista = capitulosRef.current
      const ultimo = lista[atual]
      if (!ultimo || !carregadosRef.current.has(ultimo.id) || atual >= lista.length - 1) return atual

      const faltaAdiantar = atual < indiceLendo.current + CAPITULOS_ADIANTE
      return fimVisivel.current || faltaAdiantar ? atual + 1 : atual
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

  // O menu some sozinho depois de alguns segundos sem toque
  useEffect(() => {
    if (!menuAberto) return
    const relogio = setTimeout(() => setMenuAberto(false), MENU_MS)
    return () => clearTimeout(relogio)
  }, [menuAberto, numeroAtual, confirmarApagar, capitulosBaixados, situacaoDoDownload, automatico])

  const aoCarregar = useCallback(
    (capituloId: number) => {
      carregadosRef.current.add(capituloId)
      setCarregados(new Set(carregadosRef.current))
      avancarSePuder()
    },
    [avancarSePuder],
  )

  // Mudou o capítulo que está no meio da tela
  const aoFicarNoCentro = useCallback(
    (numero: number) => {
      setNumeroAtual(numero)

      // Adianta mais um capítulo lá na frente
      indiceLendo.current = capitulosRef.current.findIndex((c) => c.numero === numero)
      avancarSePuder()
    },
    [avancarSePuder],
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
        setAviso(`Não foi possível salvar o capítulo ${capitulo.numero} (sem internet?): ${e.message}`)
      })
    },
    [aoPerderAcesso],
  )

  // Pular: recomeça a página a partir do capítulo escolhido
  function pularPara(indice: number) {
    restaurando.current = null
    indiceLendo.current = indice
    setInicio(indice)
    setFim(indice)
    setNumeroAtual(capitulos[indice].numero)
    salvarPosicao(obraId, { numero: capitulos[indice].numero, indice: 0, fracao: 0 })
    window.scrollTo(0, 0)
  }

  // Libera o espaço desta obra no aparelho (pede um segundo toque para confirmar)
  function liberarEspaco() {
    if (!confirmarApagar) {
      setConfirmarApagar(true)
      return
    }

    setConfirmarApagar(false)
    pararDownload()
    apagarObra(obraId)
      .then(atualizarOffline)
      .catch((e: Error) => setAviso(`Não foi possível liberar o espaço: ${e.message}`))
  }

  if (erro) {
    return (
      <main className="tela-centro">
        <section className="cartao">
          <p className="erro">Não foi possível abrir a obra: {erro}</p>
          <p className="suave pequeno">Sem internet, só abrem as obras baixadas para leitura offline.</p>
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
  const baixando = downloadDaObra?.situacao === 'baixando'

  return (
    // Um toque em qualquer ponto da leitura mostra ou esconde o menu
    <main className="leitor" onClick={() => setMenuAberto((aberto) => !aberto)}>
      {menuAberto && (
        <div className="menu-leitor" onClick={(e) => e.stopPropagation()}>
          <a className="menu-voltar" href="#/">
            ← Biblioteca
          </a>

          <span className="menu-titulo">
            {obra.titulo}
            {semRede && ' (sem internet)'}
          </span>

          <select
            aria-label="Pular para capítulo"
            value={indiceAtual >= 0 ? indiceAtual : inicio}
            onChange={(e) => pularPara(Number(e.target.value))}
          >
            {capitulos.map((c, i) => (
              <option key={c.id} value={i}>
                Capítulo {c.numero}
                {c.lido ? ' ✓' : ''}
                {offline.has(c.numero) ? ' ⬇' : ''}
              </option>
            ))}
          </select>

          {/* Como os capítulos são marcados como lidos */}
          <button
            type="button"
            className="secundario menu-linha"
            onClick={() => {
              salvarModoAutomatico(!automatico)
              setAutomatico(!automatico)
            }}
          >
            Marcar lido: {automatico ? 'automático, ao passar do fim do capítulo' : 'só ao tocar no botão do fim do capítulo'}
          </button>

          {/* Leitura offline: baixar a partir do capítulo em leitura, parar, liberar */}
          {baixando ? (
            <button type="button" className="secundario menu-linha" onClick={pararDownload}>
              Baixando capítulo {downloadDaObra.numeroAtual ?? '…'} — {downloadDaObra.feitos} de {downloadDaObra.total} prontos,{' '}
              {formatarBytes(downloadDaObra.bytes)}. Tocar para parar
            </button>
          ) : (
            <button
              type="button"
              className="secundario menu-linha"
              onClick={() => void baixarObra(obra, capitulos, indiceAtual >= 0 ? indiceAtual : inicio)}
            >
              {resumo && resumo.capitulos > 0 ? 'Continuar download' : 'Baixar para ler offline'} (do capítulo{' '}
              {capitulos[indiceAtual >= 0 ? indiceAtual : inicio].numero} em diante)
            </button>
          )}

          {downloadDaObra?.mensagem && !baixando && <p className="menu-linha suave pequeno">{downloadDaObra.mensagem}</p>}

          {resumo && resumo.bytes > 0 && (
            <button type="button" className="secundario menu-linha" onClick={liberarEspaco}>
              {confirmarApagar
                ? 'Tocar de novo para apagar do aparelho'
                : `No aparelho: ${resumo.capitulos} capítulos, ${formatarBytes(resumo.bytes)}. Liberar espaço`}
            </button>
          )}
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
          obraId={obraId}
          capitulo={capitulo}
          offline={offline.has(capitulo.numero)}
          proporcoes={pontoInicial?.numero === capitulo.numero ? (pontoInicial.proporcoes ?? null) : null}
          aoCarregar={aoCarregar}
          aoFicarNoCentro={aoFicarNoCentro}
          aoMarcar={aoMarcar}
          aoMudarAltura={aoMudarAltura}
          automatico={automatico}
        />
      ))}

      {/* Download em andamento: fica visível mesmo com o menu fechado */}
      {baixando && !menuAberto && (
        <div className="chip-download">
          ⬇ {downloadDaObra.feitos}/{downloadDaObra.total} · {formatarBytes(downloadDaObra.bytes)}
        </div>
      )}

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
