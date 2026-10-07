import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// El proxy evita CORS y mantiene la cookie de refresh en el mismo origen.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3000' } },
})
