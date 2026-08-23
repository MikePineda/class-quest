import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite exposes VITE_* to client code through `import.meta.env`, but it never
  // puts them on `process.env`. The proxy target is read here, on the node side,
  // so it has to be loaded explicitly or `frontend/.env` is silently ignored.
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // Dev only: the client calls `/api/...` when VITE_API_URL is unset.
        '/api': {
          target: env.VITE_API_PROXY || 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  }
})
