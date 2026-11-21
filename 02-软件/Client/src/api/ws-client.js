/**
 * WebSocket 客户端 — 订阅一键上架实时进度
 *
 * 用法:
 *   import wsClient from '@/api/ws-client.js'
 *   wsClient.subscribe(batchId, (payload) => { ... })
 *
 * 事件 (服务端推送):
 *   queue-update    队列条目状态变化
 *   item-progress   单条执行进度
 *   execution-start 批次开始
 *   execution-end   批次结束
 */
import config from '@/config/index.js'

let socket = null
let reconnectTimer = null
let listeners = []
const subscriptions = new Set()

function connect() {
  if (!config.wsUrl) return
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return
  try {
    socket = uni.connectSocket({ url: config.wsUrl, complete: () => {} })
  } catch (e) {
    return
  }
  socket.onOpen(() => {
    subscriptions.forEach(batchId => send({ type: 'subscribe', batchId }))
  })
  socket.onMessage((res) => {
    let msg
    try { msg = JSON.parse(res.data) } catch (_) { return }
    listeners.forEach(fn => { try { fn(msg) } catch (_) {} })
  })
  socket.onClose(() => { scheduleReconnect() })
  socket.onError(() => { scheduleReconnect() })
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 3000)
}

function send(obj) {
  if (!socket || socket.readyState !== 1) return
  socket.send({ data: JSON.stringify(obj) })
}

/** 订阅某批次进度, callback 收到服务端事件 */
function subscribe(batchId, callback) {
  subscriptions.add(String(batchId))
  if (callback) listeners.push(callback)
  if (!socket || socket.readyState !== 1) connect()
  else send({ type: 'subscribe', batchId: String(batchId) })
}

/** 取消订阅 */
function unsubscribe(batchId) {
  subscriptions.delete(String(batchId))
  send({ type: 'unsubscribe', batchId: String(batchId) })
}

export default { subscribe, unsubscribe, connect }
