import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const chaveAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Sem as variáveis o app ainda abre e mostra a tela de "configuração faltando",
// em vez de quebrar com tela branca.
export const supabaseConfigurado = Boolean(url && chaveAnon)

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- os tipos do banco serão gerados depois
export const supabase: SupabaseClient<any, 'manhua'> | null = supabaseConfigurado
  ? createClient(url!, chaveAnon!, {
      // O projeto Supabase é compartilhado; este sistema vive no schema "manhua".
      db: { schema: 'manhua' },
      auth: {
        // Chave própria: não mistura a sessão com a de outro site do mesmo projeto.
        storageKey: 'manhua-sessao',
        // A sessão fica no aparelho e se renova sozinha: o login é feito uma vez.
        persistSession: true,
        autoRefreshToken: true,
        // O app usa rotas por hash (#/obra/123); o Supabase não deve ler o hash.
        detectSessionInUrl: false,
      },
    })
  : null
