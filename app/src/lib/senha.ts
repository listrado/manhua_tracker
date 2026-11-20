// Senha de acesso: o usuário digita uma vez, ela fica guardada no aparelho e
// vai junto em cada gravação. Quem confere é o banco (função manhua.senha_confere).
import { supabase } from './supabase'

const CHAVE = 'manhua-senha'

export function lerSenhaGuardada(): string | null {
  try {
    return localStorage.getItem(CHAVE)
  } catch {
    return null
  }
}

function guardarSenha(senha: string) {
  try {
    localStorage.setItem(CHAVE, senha)
  } catch {
    // Armazenamento indisponível (aba privada): vale só até fechar a página
  }
}

export function esquecerSenha() {
  try {
    localStorage.removeItem(CHAVE)
  } catch {
    // Nada a apagar
  }
}

// Confere a senha no banco e, se estiver certa, guarda no aparelho.
// Devolve null quando deu certo, ou a mensagem de erro para mostrar.
export async function entrarComSenha(senha: string): Promise<string | null> {
  if (!supabase) return 'Supabase não configurado.'

  const { data, error } = await supabase.rpc('senha_confere', { p_senha: senha })
  if (error) return error.message
  if (data !== true) return 'Senha incorreta.'

  guardarSenha(senha)
  return null
}
