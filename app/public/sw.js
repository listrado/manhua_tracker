// Service Worker: faz o APP abrir sem internet (a página, o JavaScript, o CSS e
// os ícones). As imagens dos capítulos não passam por aqui: o leitor as lê
// direto do armazenamento do aparelho.
//
// Regras:
//   * a página (index.html) vem da rede quando há internet, para pegar a
//     versão mais nova; sem internet, vem a última guardada;
//   * os arquivos do app têm nome único por versão (index-XXXX.js), então
//     valem para sempre: guardado uma vez, nunca mais vai à rede.
const CACHE = 'listrado-reader-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      // Apaga caches de versões antigas deste Service Worker
      const nomes = await caches.keys()
      await Promise.all(nomes.filter((nome) => nome !== CACHE).map((nome) => caches.delete(nome)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request
  const endereco = new URL(pedido.url)

  // Só cuida do que é do próprio app; o resto (banco, imagens, proxy) segue direto
  if (pedido.method !== 'GET' || endereco.origin !== self.location.origin) return
  if (!endereco.pathname.startsWith(new URL(self.registration.scope).pathname)) return

  // A página: rede primeiro, cache como reserva
  if (pedido.mode === 'navigate') {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        try {
          const resposta = await fetch(pedido)
          if (resposta.ok) await cache.put(self.registration.scope, resposta.clone())
          return resposta
        } catch {
          return (await cache.match(self.registration.scope)) ?? Response.error()
        }
      })(),
    )
    return
  }

  // Arquivos do app: cache primeiro; o que não estiver lá vem da rede e é guardado
  evento.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const guardada = await cache.match(pedido)
      if (guardada) return guardada

      const resposta = await fetch(pedido)
      if (resposta.ok) await cache.put(pedido, resposta.clone())
      return resposta
    })(),
  )
})
