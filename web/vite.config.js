import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// 动态读取 config.local.json，fallback 到默认值
function loadBackendConfig() {
  const configPath = path.resolve(__dirname, '../config.local.json')
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return {
        backendPort: config.port || 8787,
        backendProxyHost: config.backend_proxy_host || '127.0.0.1',
        viteHost: config.vite_host || '127.0.0.1',
        vitePort: config.vite_port || 5173,
        viteAllowedHosts: config.vite_allowed_hosts || []
      }
    }
  } catch (error) {
    console.warn('Failed to load config.local.json, using defaults:', error.message)
  }
  // 默认值：本地开发配置
  return { 
    backendPort: 8787,
    backendProxyHost: '127.0.0.1',
    viteHost: '127.0.0.1',
    vitePort: 5173,
    viteAllowedHosts: []
  }
}

const config = loadBackendConfig()
// proxy target 默认用 127.0.0.1（前后端同机器），但可通过 backend_proxy_host 覆盖（特殊场景如后端在其他机器）
const proxyTarget = `http://${config.backendProxyHost}:${config.backendPort}`

console.log(`[Vite] Frontend listening on: ${config.viteHost}:${config.vitePort}`)
console.log(`[Vite] Backend proxy target: ${proxyTarget}`)

export default defineConfig({
  plugins: [react()],
  server: {
    host: config.viteHost,
    port: config.vitePort,
    allowedHosts: config.viteAllowedHosts,
    proxy: {
      '/api': proxyTarget
    }
  }
})
