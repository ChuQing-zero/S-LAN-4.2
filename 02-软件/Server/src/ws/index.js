/**
 * WebSocket 状态同步中心
 *
 * 作用: 一键上架执行进度实时推送到各端 (PC网页/手机网页/APP/小程序)
 * 端口: 与 HTTP 同端口 (见 Server\.env SERVER_PORT), 路径 /ws
 *
 * 用法:
 *   const wss = require('./ws');          // 获取单例
 *   app.get('/health', ...);              // 原有路由
 *   ...
 *   const server = app.listen(...);
 *   wss.attach(server);                   // 挂到同一 http server
 *
 * 广播:
 *   wss.emit('queue-update', payload);    // 发给所有订阅该 batchId 的客户端
 */
const { WebSocketServer } = require('ws');

let wss = null;
const clients = new Map(); // ws -> { batchIds:Set }

function getWss() {
  return wss;
}

function attach(server) {
  if (wss) return wss;
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    clients.set(ws, { batchIds: new Set() });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      const ctx = clients.get(ws);
      if (!ctx) return;

      if (msg.type === 'subscribe' && msg.batchId) {
        ctx.batchIds.add(String(msg.batchId));
      } else if (msg.type === 'unsubscribe' && msg.batchId) {
        ctx.batchIds.delete(String(msg.batchId));
      }
    });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  return wss;
}

/**
 * 广播事件
 * @param {string} event 事件名 (见 events.js SERVER_EVENTS)
 * @param {object} payload 数据, 可含 batchId 用于订阅过滤
 * @param {string|null} batchId 可选: 指定批次则只发给订阅该批次的客户端; 不传则全员广播
 */
function emit(event, payload, batchId = null) {
  if (!wss) return 0;
  const data = JSON.stringify({ event, ...payload });
  let sent = 0;
  for (const [ws, ctx] of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (batchId !== null) {
      const bid = String(batchId);
      // 订阅了该批次, 或订阅了通配符 __all__ (主机面板/全局日志)
      if (!ctx.batchIds.has(bid) && !ctx.batchIds.has('__all__')) continue;
    }
    try { ws.send(data); sent++; } catch (_) { /* 忽略单个连接错误 */ }
  }
  return sent;
}

/** 客户端连接数 (在线状态检测用) */
function clientCount() {
  return wss ? clients.size : 0;
}

module.exports = { attach, emit, getWss, clientCount };
