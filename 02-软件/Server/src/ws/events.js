/**
 * WS 事件定义 — 后端/前端约定的事件名与数据结构
 *
 * 服务端推送事件 (server → client):
 *   queue-update     { batchId, index, itemStatus, code, outputStatus, ... }
 *   item-progress    { batchId, index, step, stepName, detail }
 *   execution-start  { batchId, total }
 *   execution-end    { batchId, success, failed }
 *   error            { message, batchId?, index? }
 *
 * 客户端可发事件 (client → server):
 *   subscribe   { batchId }   订阅某批次进度
 *   unsubscribe { batchId }   取消订阅
 */
module.exports = {
  SERVER_EVENTS: ['queue-update', 'item-progress', 'execution-start', 'execution-end', 'error'],
  CLIENT_EVENTS: ['subscribe', 'unsubscribe'],
};
