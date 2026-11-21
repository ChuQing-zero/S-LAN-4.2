/**
 * 项目统一配置 — S-LAN V2.0 四端 (H5/APP/微信小程序)
 *
 * baseUrl 优先级:
 *   1. 本地存储 serverUrl (APP 设置页手动改, IP 变了不用重打包) ★
 *   2. 环境变量 VITE_API_BASE_URL (构建时指定, 适用于 DDNS/HTTPS 阶段)
 *   3. H5: 自动使用当前浏览器访问的 host (局域网/DDNS 自适应, 端口 4002)
 *   4. APP/小程序: 环境变量兜底
 */

// H5 自动取当前访问地址 (http://192.168.x.x:4002 → API 同源)
// APP/小程序无 location, 必须用环境变量配置
function autoBaseUrl() {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const port = window.location.port || '4002'
    return `${window.location.protocol}//${window.location.hostname}:${port}/v1/api`
  }
  // #endif
  return ''
}

// 本地存储手动设置的服务器地址 (APP 设置页写入)
let customServerUrl = ''
try { customServerUrl = uni.getStorageSync('serverUrl') || '' } catch (_) {}

const envBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
const API_BASE_URL = customServerUrl || envBaseUrl || autoBaseUrl() || 'http://localhost:4002/v1/api'

// WebSocket 地址同理
function autoWsUrl() {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const port = window.location.port || '4002'
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:${port}/ws`
  }
  // #endif
  return ''
}

const customWsUrl = customServerUrl
  ? customServerUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://').replace(/\/v1\/api$/, '') + '/ws'
  : ''
const WS_URL = customWsUrl || import.meta.env.VITE_WS_URL || autoWsUrl() || ''

export const config = {
  // 前端开发服务器端口
  devPort: Number(import.meta.env.VITE_DEV_PORT) || 6173,

  // 后端 API 端口
  apiPort: Number(import.meta.env.VITE_API_PORT) || 4002,

  // API 基础地址
  apiBaseUrl: API_BASE_URL,

  // 认证 Token
  apiToken: import.meta.env.VITE_API_TOKEN || 'test',

  // 是否使用本地模式
  useLocal: import.meta.env.VITE_USE_LOCAL !== 'false',

  // 云端服务器（可独立配置，默认同本地）
  cloudApiBaseUrl: uni.getStorageSync('cloudApiUrl')
    || API_BASE_URL,

  // WebSocket 地址 (一键上架实时进度)
  wsUrl: WS_URL,
}

export default config
