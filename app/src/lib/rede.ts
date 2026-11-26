// Pedidos à rede com prazo. Sem internet, ou com sinal tão fraco que nada
// volta, o app não fica esperando: desiste e usa o que está no aparelho.

export class ErroSemRede extends Error {}

// O aparelho sabe que está sem conexão (modo avião, sem Wi-Fi nem dados).
// O contrário não garante internet: com sinal fraco os pedidos ainda podem
// travar, e é para isso que existe o prazo.
export function semConexao(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// Roda "tarefa" com um prazo. Estourou: cancela os pedidos (pelo sinal) e
// rejeita com ErroSemRede, mesmo que a tarefa esteja presa em algo que não
// obedece ao sinal (como a renovação da sessão do Supabase).
export async function comPrazo<T>(ms: number, tarefa: (sinal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controle = new AbortController()
  let relogio: ReturnType<typeof setTimeout> | undefined

  const prazo = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => {
      controle.abort()
      rejeitar(new ErroSemRede('a internet não respondeu a tempo'))
    }, ms)
  })

  try {
    return await Promise.race([tarefa(controle.signal), prazo])
  } finally {
    clearTimeout(relogio)
  }
}
