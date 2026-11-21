/**
 * 本地卡牌目录 — JSON 数据源
 * 读取 ../data/card-catalog/ 下的 JSON 文件替代 MongoDB CardCatalog
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = process.env.CARD_CATALOG_PATH || path.join(__dirname, '../../data/card-catalog');

let _catalogCache = null;
let _cacheTime = 0;

function loadAll() {
  if (_catalogCache && Date.now() - _cacheTime < 30000) return _catalogCache;

  const cards = [];
  const packs = [];

  if (!fs.existsSync(CATALOG_DIR)) {
    _catalogCache = { cards: [], packs: [], index: { packs: [] } };
    _cacheTime = Date.now();
    return _catalogCache;
  }

  const indexFile = path.join(CATALOG_DIR, '_index.json');
  let index = { packs: [] };
  if (fs.existsSync(indexFile)) {
    try { index = JSON.parse(fs.readFileSync(indexFile, 'utf-8')); } catch (_) {}
  }

  for (const entry of index.packs) {
    const file = entry.file || (entry.code + '.json');
    const fp = path.join(CATALOG_DIR, file);
    if (!fs.existsSync(fp)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      packs.push({
        code: data.code,
        full_name: data.full_name || data.code,
        date: data.date || '',
        total_cards: (data.cards || []).length,
        status: 'local',
        image_count: 0,
        has_data: true,
      });
      for (const c of (data.cards || [])) {
        cards.push({
          code: c.code,
          packCode: data.code,
          jpName: c.jpName || c.jp_name || '',
          cnName: c.cnName || c.cn_name || '',
          enName: c.enName || c.en_name || '',
          extCode: c.extCode || c.ext_code || '',
          rarity: c.rarity || '',
          hasAltArt: c.hasAltArt || c.has_alt_art || false,
          altArtIndex: c.altArtIndex || c.alt_art_index || 0,
          altLabels: c.altLabels || c.alt_labels || {},
          cnSource: c.cnSource || c.cn_source || '',
          versionId: c.versionId || 1,
        });
      }
    } catch (_) {}
  }

  _catalogCache = { cards, packs, index };
  _cacheTime = Date.now();
  return _catalogCache;
}

/** 模拟 Mongoose lean() 返回的数组 */
function leanArray(arr) { return arr; }

module.exports = {
  loadAll,
  leanArray,
  CATALOG_DIR,
};
