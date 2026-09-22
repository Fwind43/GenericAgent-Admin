import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const readJSON = (file) => {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (error) {
    console.warn(`Failed to load ${path.basename(file)}, ignoring:`, error.message)
  }
  return null
}

// 动态读取 config.local.json，fallback 到默认值
function loadBackendConfig() {
  const config = readJSON(path.resolve(__dirname, '../config.local.json')) || {}
  // 后端默认监听随机端口，实际端口写在 runtime.local.json 里；优先用它。
  // 也可以用 `go run . --port 8787` 固定端口后走 config.local.json/默认值。
  const runtime = readJSON(path.resolve(__dirname, '../runtime.local.json'))
  return {
    backendPort: runtime?.port || config.port || 8787,
    backendProxyHost: config.backend_proxy_host || '127.0.0.1',
    viteHost: config.vite_host || '127.0.0.1',
    vitePort: config.vite_port || 5173,
    viteAllowedHosts: config.vite_allowed_hosts || []
  }
}

const config = loadBackendConfig()
// proxy target 默认用 127.0.0.1（前后端同机器），但可通过 backend_proxy_host 覆盖（特殊场景如后端在其他机器）
const proxyTarget = `http://${config.backendProxyHost}:${config.backendPort}`

console.log(`[Vite] Frontend listening on: ${config.viteHost}:${config.vitePort}`)
console.log(`[Vite] Backend proxy target: ${proxyTarget}`)

export default defineConfig({
  plugins: [react()],
  esbuild: { jsx: 'automatic' },
  server: {
    host: config.viteHost,
    port: config.vitePort,
    allowedHosts: config.viteAllowedHosts,
    proxy: {
      '/api': proxyTarget
    }
  }
})
