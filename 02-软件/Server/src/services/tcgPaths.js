/**
 * TCG 图源路径配置 — 4 个图源目录可配置，存 backend/src/config/tcg-paths.json
 *
 * 默认值从 .env 的 TCG_DATABASE_PATH 推导（未设则用 D:\Project\TCG_Database）。
 * 配置文件不存在/损坏时兜底默认值。save() 写文件并刷内存缓存 → 立即生效。
 */
const fs = require('fs');
const path = require('path');

// 配置文件路径可用环境变量顶掉，与 altLabels.js / recognitionPrompt.js 同一个写法。
// 存在的意义是**让测试能把图源指向临时目录**：批次 6 起本服务会往图源里建目录、写
// `_index.json`，而这些接口的测试如果只能打真图源，就得在用户的真实数据上做实验。
// 生产运行不设这个变量，走原来的路径。
const CONFIG_PATH = process.env.TCG_PATHS_PATH || path.join(__dirname, '../config/tcg-paths.json');

// 4 个图源目录键（详细图源/保底图源/缩略图/ID数据）
const KEYS = ['ocgDir', 'ygoproDir', 'thumbDir', 'dataDir'];

/** 默认值：从 TCG_DATABASE_PATH 推导（当前 .env 已设为实际代码目录） */
function defaults() {
  const base = process.env.TCG_DATABASE_PATH || 'D:\\Project\\TCG_Database';
  return {
    ocgDir: path.join(base, 'images', 'OCG'),
    ygoproDir: path.join(base, 'images', 'YGOPro'),
    thumbDir: path.join(base, 'images', 'Thumbnails'),
    dataDir: path.join(base, 'id-data', 'JP-YuGiOh'),
  };
}

let cache = null;

/** 读取当前配置（合并默认值，只保留 4 个合法键），带内存缓存 */
function get() {
  if (cache) return cache;
  let stored = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      stored = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (_) { /* 损坏配置 → 用默认值 */ }
  cache = { ...defaults(), ...stored };
  return cache;
}

/** 保存配置：合并默认值、清洗非法键、写文件、刷缓存 → 立即生效 */
function save(input) {
  const merged = { ...defaults(), ...(input || {}) };
  const clean = {};
  for (const k of KEYS) {
    clean[k] = (typeof merged[k] === 'string' && merged[k].trim())
      ? merged[k].trim()
      : defaults()[k];
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(clean, null, 2), 'utf-8');
  cache = clean;
  return clean;
}

/** 各路径是否存在（前端用于绿/红提示） */
function exists() {
  const p = get();
  const out = {};
  for (const k of KEYS) out[k] = fs.existsSync(p[k]);
  return out;
}

/** 清缓存（让 get() 下次重读文件） */
function reset() { cache = null; }

module.exports = { KEYS, CONFIG_PATH, get, save, exists, reset, defaults };
