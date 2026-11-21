/**
 * 订单编号工具
 * 18位 = 交易时间(YYYYMMDDHHMMSS 14位) + 4位随机数
 * 例: 202607212056434951 → 交易时间 2026-07-21 20:56:43, 简称 订单4951
 */

const pad = (n) => String(n).padStart(2, '0');

// 生成18位订单编号（默认当前时间）
function generateOrderNo(now = new Date()) {
  const ts = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
  const rand = String(Math.floor(1000 + Math.random() * 9000)); // 4位随机 1000-9999
  return ts + rand;
}

// 从订单编号解析交易时间（前14位），失败返回 null
function parseTradeTime(orderNo) {
  if (!orderNo || orderNo.length < 14) return null;
  const s = orderNo.slice(0, 14);
  return new Date(
    +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
    +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)
  );
}

// 订单简称（后4位） 订单4951
function shortName(orderNo) {
  return '订单' + String(orderNo || '').slice(-4);
}

// 生成订单内卡牌编号 orderNo-0001
function cardNo(orderNo, lineNo) {
  return orderNo + '-' + String(lineNo).padStart(4, '0');
}

module.exports = { generateOrderNo, parseTradeTime, shortName, cardNo };
