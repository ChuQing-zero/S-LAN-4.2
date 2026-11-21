/**
 * OCG 卡图映射表 — 卡密 → [{dir, file}]
 *
 * OCG 文件名已去掉卡密前缀（如 QCAC-JP073-SER-1.jpg），系统靠卡密定位需查此表。
 * 表由改名脚本生成（改名前文件名为 {卡密}-{包号}-{编号}-{罕贵}(-异画)），一个卡密可能
 * 对应多个文件（同卡不同罕贵/异画，可能跨包目录）。
 * 与 tcgPaths 相同模式：读文件 + 内存缓存。
 */
const fs = require('fs');
const path = require('path');

const MAP_PATH = path.join(__dirname, '../config/tcg-ocg-map.json');

let cache = null;

/** 读取卡密映射表（JSON: { extCode: [{dir, file}, ...] }），损坏/缺失时返回空对象 */
function get() {
  if (cache) return cache;
  try {
    cache = fs.existsSync(MAP_PATH)
      ? JSON.parse(fs.readFileSync(MAP_PATH, 'utf-8'))
      : {};
  } catch (_) {
    cache = {};
  }
  return cache;
}

/** 清缓存（让 get() 下次重读文件） */
function reset() { cache = null; }

module.exports = { MAP_PATH, get, reset };
