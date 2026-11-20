// Logo do app: o livrinho e o nome, "Listrado" em vermelho e "Reader" em azul.
export function Logo() {
  return (
    <span className="logo">
      <svg className="logo-icone" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 18c-5-4-12-5-20-4v32c8-1 15 0 20 4z" fill="#e5484d" />
        <path d="M32 18c5-4 12-5 20-4v32c-8-1-15 0-20 4z" fill="#3b82f6" />
        <path d="M32 18v32" stroke="#0f1115" strokeWidth="2.5" strokeLinecap="round" />
      </svg>

      <span className="logo-nome">
        <span className="logo-listrado">Listrado</span>
        <span className="logo-reader">Reader</span>
      </span>
    </span>
  )
}
