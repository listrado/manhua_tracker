// Normalização e semelhança de títulos.
// As duas funções imitam o que o banco faz (manhua.normalizar_titulo e a
// similarity() do pg_trgm), para o script e o banco chegarem ao mesmo resultado.

// Minúsculas, sem acento, aspas curvas viram retas, sem pontuação, espaços colapsados.
export function normalizarTitulo(titulo: string): string {
  return titulo
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Trigramas no estilo do pg_trgm: cada palavra ganha dois espaços antes e um depois.
function trigramas(textoNormalizado: string): Set<string> {
  const conjunto = new Set<string>()

  for (const palavra of textoNormalizado.split(' ').filter(Boolean)) {
    const comBorda = `  ${palavra} `
    for (let i = 0; i + 3 <= comBorda.length; i++) {
      conjunto.add(comBorda.slice(i, i + 3))
    }
  }

  return conjunto
}

// Semelhança de 0 a 1 entre dois títulos JÁ normalizados:
// trigramas em comum dividido pelo total de trigramas distintos.
export function semelhanca(a: string, b: string): number {
  const ta = trigramas(a)
  const tb = trigramas(b)
  if (ta.size === 0 || tb.size === 0) return 0

  // Conta os trigramas que aparecem nos dois
  let emComum = 0
  for (const t of ta) {
    if (tb.has(t)) emComum++
  }

  return emComum / (ta.size + tb.size - emComum)
}
