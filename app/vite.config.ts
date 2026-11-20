import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// O GitHub Pages publica o app em https://listrado.github.io/manhua_tracker/,
// por isso todos os arquivos precisam do prefixo do repositório.
export default defineConfig({
  base: '/manhua_tracker/',
  plugins: [react()],
})
