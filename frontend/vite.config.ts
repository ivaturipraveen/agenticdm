import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_API_URL || 'http://localhost:8000'
  const backendWs  = backendUrl.replace(/^http/, 'ws')

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
        '/ws':  { target: backendWs,  ws: true, changeOrigin: true },
      },
    },
    preview: {
      port: 3000,
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
        '/ws':  { target: backendWs,  ws: true, changeOrigin: true },
      },
    },
  }
})
