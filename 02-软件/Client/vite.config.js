import { defineConfig, loadEnv } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const devPort = Number(env.VITE_DEV_PORT) || 6173
  const apiTarget = 'http://localhost:' + (Number(env.VITE_API_PORT) || 4002)

  return {
    plugins: [uni()],
    server: {
      port: devPort,
      host: '0.0.0.0',
      strictPort: false,
      proxy: {
        '/v1/api': { target: apiTarget, changeOrigin: true },
        '/health': { target: apiTarget, changeOrigin: true },
        '/api': { target: apiTarget, changeOrigin: true },
        '/uploads': { target: apiTarget, changeOrigin: true },
        '/ws': { target: apiTarget, changeOrigin: true, ws: true }
      }
    },
  }
})
