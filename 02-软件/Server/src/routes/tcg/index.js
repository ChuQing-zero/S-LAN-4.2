/**
 * TCG 卡牌目录路由 (v2 — MongoDB CardCatalog + _index.json 元数据)
 * 卡牌元数据查 MongoDB，卡图从本地 TCG_Image_Database 服务
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const multer = require('multer');
const XLSX = require('xlsx');
const { execSync, execFile } = require('child_process');
const router = express.Router();
const CardCatalog = require('../../models/CardCatalog');
const Card = require('../../models/Card');
const CardMark = require('../../models/CardMark');
const CardUnique = require('../../models/CardUnique');
const auth = require('../../middleware/auth');
const authAdmin = require('../../middleware/authAdmin');

// TCG 图源路径配置（5 个目录，可前端改，见 /api/tcg/paths）
const tcgPaths = require('../../services/tcgPaths');
const tcgOcgMap = require('../../services/tcgOcgMap');
// 卡密的形态规则全仓唯一一份（`/card-image`、`/card-thumbnail`、`buildCatalogDoc` 三处都吃它）
const { 卡密合法, 卡密说明 } = require('../../services/cardPassword');
// 罕贵度串 ↔ 行的唯一一份拆合规则（见 services/catalogRarity.js 顶上那段）。
// `cardcatalogs` 是「一行 = 编号 × 罕贵度 × 后缀序号」，而磁盘 JSON / Excel / 数据包
// 一直是「一个编号一行、多个罕贵度用「、」连起来」，两边来回换全靠它。
const { 拆, 合, 展开 } = require('../../services/catalogRarity');
// 卡名的唯一读口。`cardcatalogs` 自从不存卡名之后，凡是要用名字的地方都得来这里换
// （见 services/cardNames.js 顶上那段）。**新增读 cardcatalogs 的地方都要接。**
const 卡名 = require('../../services/cardNames');
// 「卡牌资料核对」的版本号。services/cardReview.js 顶上写着：**任何写 cardcatalogs 的路径
// 之后都必须调 `bumpReviewVersion()`**，否则后台那几个派生数字刷新了还是旧的。
const cardReview = require('../../services/cardReview');

// _index.json 缓存
let _indexCache = null;
let _indexCacheTime = 0;
const INDEX_CACHE_TTL = 60 * 1000; // 1分钟

// 目录文件清单缓存 (packCode → { time, files, stems }), 避免每次请求同步 readdirSync
//   files = readdirSync 原始结果（listOcgFiles 自己按扩展名过滤，保持原语义）
//   stems = 「主名 → 真实文件名」，供精准定位用；与 files 同一次 readdir 产出，不多花 IO
const dirListCache = new Map();
const DIR_CACHE_TTL = 30 * 1000; // 30秒

// 「图源里有、卡牌目录里没有」的包清单缓存。一级页每次进来都要问一遍这个数，
// 而算它要 readdir 整个图源（1552 个包目录）。只取计数那次很便宜（一次 readdir + 索引），
// 带文件数的那份贵，所以两种粒度分开缓存、只给 `?detail=1` 用。
let uncatCache = { time: 0, data: null };

const IMG_EXT_RE = /\.(jpg|jpeg|png|webp)$/i;

// 包目录名的白名单。目标是**挡路径穿越**，不是限制命名风格 —— 实测真实图源里就有
// `BETB(+1)`（还是 cardcatalogs.packCode 和 _index.json 的正经条目）、`TDGS-JP`、`TLM-JP`
// 这种带括号/连字符的目录，按「只允许字母数字」卡会把它们一起挡在门外。
// `.` `/` `\` 都不在白名单里，所以 `..`、`a/b` 这类构造天然过不了。
const PACK_CODE_RE = /^[A-Za-z0-9()+-]{1,20}$/;

/**
 * 把包名解析成图源下的绝对目录，并**再验一次**结果确实落在 ocgDir 里。
 * 正则已经挡掉了穿越，这里是第二道闸：以后有人放宽正则，这道还在。
 * 返回 null 表示包名非法。
 */
function resolvePackDir(packCode) {
  if (!PACK_CODE_RE.test(packCode || '')) return null;
  const ocgDir = tcgPaths.get().ocgDir;
  const dir = path.join(ocgDir, packCode);
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  if (!norm(dir).startsWith(norm(ocgDir) + path.sep)) return null;
  return dir;
}

// 把字符串转义成能安全塞进 `$regex` 的字面量。包名前缀会进正则，而真实包名里就有
// `BETB(+1)` 这种带元的字符 —— 不转义的话 `(+1)` 会被当成分组，匹配到完全无关的编号。
// 跟 card-marks / card-uniques 那两个路由里的 `escRe` 是同一个实现。
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readDirIndex(dir) {
  const now = Date.now();
  const hit = dirListCache.get(dir);
  if (hit && (now - hit.time) < DIR_CACHE_TTL) return hit;
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { dirListCache.delete(dir); return null; }
  const stems = new Map();
  for (const f of files) if (IMG_EXT_RE.test(f)) stems.set(f.replace(IMG_EXT_RE, ''), f);
  const entry = { time: now, files, stems };
  dirListCache.set(dir, entry);
  return entry;
}

function cachedReaddir(dir) {
  const e = readDirIndex(dir);
  return e ? e.files : null;
}

function loadIndex() {
  const now = Date.now();
  if (_indexCache && (now - _indexCacheTime) < INDEX_CACHE_TTL) return _indexCache;
  const fp = path.join(tcgPaths.get().dataDir, '_index.json');
  if (!fs.existsSync(fp)) return { packs: [] };
  _indexCache = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  _indexCacheTime = now;
  return _indexCache;
}

// ==================== 图源缓存失效 / 回写（所有写路径的唯一收口） ====================
// 图源目录（V1.1\Storage\tcg-data）现在会被本服务写入。全项目只有这几处写它：
// 本文件的重命名/上传/删图接口 + writePackJson。改完文件或目录后**必须**调
// invalidateTcgCaches()，否则三处 TTL 缓存（30s/60s/60s）会让用户以为"改了没反应"。
/**
 * 时间戳 `YYYYMMDD-HHmmss`，给审计文件名 / 备份目录名用。
 *
 * **不要用 `new Date().toISOString().slice(0,15)` 那类切片**：ISO 串到第 15 个字符
 * 正好停在秒后面那个「.」上，切出来是 `20260929121248.`；而这个值要当目录名用，
 * Windows 建目录时会把结尾的点吃掉，于是审计 JSON 里记的路径和磁盘上实际的名字
 * 就对不上，事后按审计找备份会找不到。自己拼没这个问题。
 */
function makeStamp(d = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

function invalidateTcgCaches(packCode) {
  if (packCode) {
    try {
      dirListCache.delete(path.join(tcgPaths.get().ocgDir, packCode));
    } catch (_) { /* 路径没配好就不管，下面两项照清 */ }
  } else {
    dirListCache.clear();
  }
  // ⚠️ 这里**不要**再写 `altIdxCache.clear()` —— 那个缓存在 V1.2.39 拆行时已经连着它的
  //    使用者一起删掉了（见 commit 83136d8），只剩这一行 dangling 引用。留着的话本函数
  //    每次调用都抛 `ReferenceError: altIdxCache is not defined`，下面三行清缓存根本执行不到，
  //    所有写路径（改名 / 传图 / 改包 / import-bundle）都会 500，而且读侧永远吃到旧缓存。
  _indexCache = null;
  _indexCacheTime = 0;
  uncatCache = { time: 0, data: null };   // 新建包/上传图片会让「未收录」的清单变，一起作废
}

/**
 * 回写卡包 JSON（{dataDir}/{packCode}.json + _index.json）。
 *
 * merge 语义：包 JSON 已存在时**读出来合并**，不是整份覆盖 —— 因为 PUT /packs/:code
 * 传来的只是「这个包里被改过的卡」，整份盖下去会把 full_name / 未分页返回的卡全丢掉
 * （GET /packs/:code 的 perPage 上限是 500，大包本来就传不全）。
 *
 * @param {object} opts.fullName/date/status/reason/totalCards  只写显式给了值的字段，
 *        没给的保持 _index.json 里的原值 —— 否则一次手动编辑会把包的中文名冲成包简写。
 */
/**
 * 剥掉前端为了渲染挂上来的内部字段（`_rowKey` 这类下划线开头的）。
 * 这份 JSON 是共享的原始数据文件，V1.1 也读它，里面不该出现我们前端的实现细节 ——
 * 而 PUT /packs/:code 是**原样**把收到的 card 塞进 accepted 的，不剥就会写进去。
 */
function stripInternal(c) {
  if (!c || typeof c !== 'object') return c;
  const out = {};
  for (const [k, v] of Object.entries(c)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

/**
 * 把一行卡（前端的 camelCase 或包 JSON 的 snake_case 都认）转成 cardcatalogs 的文档。
 * PUT /packs/:code 与 Excel 导入共用它 —— 各写一份的话，「卡密形态」这类校验
 * 迟早会在其中一处漏掉，而漏掉的那次会往库里插一个带路径字符的卡密，
 * 让所有拼卡图 URL 的地方一起失配（规则本身见 services/cardPassword.js）。
 *
 * 返回 `{ docs }` 或 `{ error }`（error 是给用户看的中文原话，调用方直接往外抛）。
 *
 * ⚠️ **一条进来可能是几行出去**：`rarity` 里写了「、」的按 `展开()` 拆成 (罕贵度, 后缀序号)
 * 若干行。界面上现在是一行一个罕贵度，所以通常只出一行；但 Excel / 老数据包里
 * `"UR、SER、SER(1)"` 这种写法必须照样认。
 *
 * 注意**不写 versionId**：人手改这几张卡不是「重建一版目录」，硬写 1 会抹掉别的版本信息
 * （import-pack 里写 1 是因为它本来就是全量重建，性质不同）。
 */
function buildCatalogDoc(packCode, card) {
  const pick = (snake, camel) => (card[snake] !== undefined ? card[snake] : card[camel]);
  const code = String(pick('code', 'code') || '').trim().toUpperCase();
  if (!code) return { error: '跳过 1 条：缺少卡牌编号' };

  const extCode = String(pick('ext_code', 'extCode') || '').trim();
  if (extCode && !卡密合法(extCode)) {
    return { error: `${code}：卡密「${extCode}」含非法字符（${卡密说明}），已跳过` };
  }

  const 条目序号 = parseInt(pick('alt_art_index', 'altArtIndex')) || 0;
  const hasAltArt = !!(pick('has_alt_art', 'hasAltArt'));
  const cnSource = String(pick('cn_source', 'cnSource') || '').trim() || 'manual';
  const 标签 = pick('alt_label', 'altLabel');

  // ⚠️ `doc` 里**不再有** jpName / cnName / enName —— 卡名归 `carduniques` 管，
  // 这里只把名字单独挑出来放在 `names` 里，由调用方交给 `services/cardNames.收下()`。
  // 两个调用点（PUT /packs/:code、Excel 导入）都必须收下，否则用户填的名字就白填了。
  const docs = 展开(pick('rarity', 'rarity'), 条目序号).map(行 => ({
    code,
    packCode,
    extCode,
    rarity: 行.rarity,
    hasAltArt,
    altArtIndex: 行.altArtIndex,
    // 只在这一条明确带了标签时才写。**没有这个键就别碰** —— 界面上一行一个罕贵度，
    // 「只改卡密」的那次提交里不带标签，跟着写空串会把人工填的标签抹掉。
    ...(标签 !== undefined ? { altLabel: String(标签 == null ? '' : 标签).trim() } : {}),
    cnSource,
  }));

  return {
    docs,
    names: {
      jpName: String(pick('jp_name', 'jpName') || '').trim(),
      cnName: String(pick('cn_name', 'cnName') || '').trim(),
      enName: String(pick('en_name', 'enName') || '').trim(),
    },
  };
}

/**
 * 只改 `_index.json` 里这一条的元数据，**不碰包 JSON**。
 * 上传图片之后刷新 `image_count` 用它 —— 走 writePackJson 会把包 JSON 整份重写一遍，
 * 而上传图片这件事跟 cards 数组没有关系，没必要动那个文件（V1.1 也在读它）。
 * 返回 false 表示索引里没有这个包（那就什么都不做，交给写包路径去建）。
 */
function patchIndexEntry(packCode, patch) {
  const { dataDir: DATA_DIR } = tcgPaths.get();
  const index = loadIndex();
  const packs = index.packs || (index.packs = []);
  const i = packs.findIndex(p => p.code === packCode);
  if (i < 0) return false;
  packs[i] = { ...packs[i], ...patch };
  fs.writeFileSync(path.join(DATA_DIR, '_index.json'), JSON.stringify(index, null, 2), 'utf-8');
  _indexCache = index;
  _indexCacheTime = Date.now();
  return true;
}

/**
 * 把某个包从 `_index.json` 的 packs 里摘掉（patchIndexEntry 的反操作）。
 * 返回被摘掉的那一条（没有就返回 null）—— 调用方要把它写进审计，供人工恢复。
 * 只改这个文件，不碰 `{packCode}.json`。
 */
function removeIndexEntry(packCode) {
  const { dataDir: DATA_DIR } = tcgPaths.get();
  const index = loadIndex();
  const packs = index.packs || (index.packs = []);
  const i = packs.findIndex(p => p.code === packCode);
  if (i < 0) return null;
  const [removed] = packs.splice(i, 1);
  fs.writeFileSync(path.join(DATA_DIR, '_index.json'), JSON.stringify(index, null, 2), 'utf-8');
  _indexCache = index;
  _indexCacheTime = Date.now();
  return removed;
}

function writePackJson(packCode, incomingCards, opts = {}) {
  const { dataDir: DATA_DIR } = tcgPaths.get();
  const filePath = path.join(DATA_DIR, `${packCode}.json`);

  // 1) 合并包 JSON 的 cards
  let packData = { code: packCode, cards: [] };
  if (fs.existsSync(filePath)) {
    try { packData = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (_) { /* 坏了就重写一份 */ }
    if (!Array.isArray(packData.cards)) packData.cards = [];
  } else {
    packData.code = packCode;
  }
  // ⚠️ **按「编号」归并，一条编号只写一条记录**，罕贵度用「、」串起来。
  // 这是包 JSON 的原生写法（V1.1 也在读这个文件，格式不能动）：磁盘上 32,124 条里
  // 没有一条的 `alt_art_index` 大于 0，异画是写成 `SER(1)` 这种**带序号后缀的罕贵度**的。
  // 库里的行拆开之后，同一个编号会有好几行 —— 若还按 `编号|后缀序号` 当键，
  // UR / SER / QCSER 三行会轮流覆盖同一个键，最后只剩最后一行，**把另外两个罕贵度丢掉**。
  // 归并了才不会丢，而且 `展开()` 能把「、」串原样拆回那几行（两边互逆）。
  //
  // 代价：`incomingCards` 必须是它提到的每个编号的**完整**行集合（不然会把没提到的罕贵度
  // 从串里抹掉）。调用方都满足：PUT /packs/:code 写完库后按编号回读，
  // import-pack / Excel 传的是文件/表里那一整份。
  const 按编号 = new Map();
  for (const c of incomingCards) {
    const k = (c.code || '').trim().toUpperCase();
    if (!k) continue;
    if (!按编号.has(k)) 按编号.set(k, []);
    按编号.get(k).push(c);
  }
  const pos = new Map(packData.cards.map((c, i) => [(c.code || '').trim().toUpperCase(), i]));
  for (const [k, 组] of 按编号) {
    // 罕贵度串按文件里原来的顺序拼：组内先按后缀序号、再按原罕贵度名排，
    // 免得同一个编号每次保存都把罕贵度顺序洗一遍（那种 diff 没法看）
    const 行 = 展开(组[0].rarity, 组[0].alt_art_index);
    for (const c of 组.slice(1)) 行.push(...展开(c.rarity, c.alt_art_index));
    行.sort((a, b) => (a.altArtIndex - b.altArtIndex) || String(a.rarity).localeCompare(String(b.rarity)));
    const 条目 = {
      ...(pos.has(k) ? packData.cards[pos.get(k)] : {}),
      ...stripInternal(组[0]),
      code: k,
      rarity: 合(行),
      alt_art_index: 0,     // 后缀序号已经写进「、」串里了，这个字段在磁盘上恒为 0
    };
    if (pos.has(k)) packData.cards[pos.get(k)] = 条目;
    else { pos.set(k, packData.cards.length); packData.cards.push(条目); }
  }
  // 显式要求摘掉的编号。上面那个循环**只会更新、从不删除**（这是老规矩，
  // import-pack / Excel 那条路靠它：传进来的是整份，没提到的编号不该被抹掉）。
  // 但「只删不增」时 incomingCards 是空的，循环一次都不跑，被删的那条就会永远留在磁盘上
  // —— 库里已经没了、`totalCards` 也减了，文件里还在，两边对不上。
  // 所以删除必须单独说一声，只有调用方刚删过行时才会传这个参数。
  if (Array.isArray(opts.removeCodes) && opts.removeCodes.length) {
    const 去 = new Set(opts.removeCodes.map(c => String(c).trim().toUpperCase()));
    packData.cards = packData.cards.filter(c => !去.has(String(c.code || '').trim().toUpperCase()));
  }
  if (opts.fullName !== undefined) packData.full_name = opts.fullName;
  if (opts.date !== undefined) packData.date = opts.date;
  // 整份导入时把 body 上的其它顶层字段（full_name / date / _guide…）一并带上，
  // 否则「导出 → 导入 → 导出」会丢掉这些字段
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) {
      if (k !== 'cards' && k !== 'code') packData[k] = v;
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(packData, null, 2), 'utf-8');

  // 2) 更新 _index.json 里这一条的元数据
  const index = loadIndex();
  const packs = index.packs || (index.packs = []);
  const i = packs.findIndex(p => p.code === packCode);
  const patch = { code: packCode, file: `${packCode}.json` };
  if (opts.fullName !== undefined) patch.full_name = opts.fullName;
  if (opts.enName !== undefined) patch.en_name = opts.enName;
  if (opts.date !== undefined) patch.date = opts.date;
  if (opts.status !== undefined) patch.status = opts.status;
  if (opts.reason !== undefined) patch.reason = opts.reason;
  if (opts.imageCount !== undefined) patch.image_count = opts.imageCount;
  if (opts.totalCards !== undefined) patch.total_cards = opts.totalCards;
  if (opts.hasData !== undefined) patch.has_data = opts.hasData;
  if (i >= 0) {
    packs[i] = { ...packs[i], ...patch };
  } else {
    // 新条目：把 _index.json 要求的字段补齐，否则目录页一级列表读不全
    packs.push({
      full_name: opts.fullName || packCode,
      en_name: opts.enName || '',
      date: opts.date || new Date().toISOString().split('T')[0],
      total_cards: opts.totalCards || 0,
      status: opts.status || 'pending',
      reason: opts.reason || '',
      image_count: opts.imageCount || 0,
      missing_rarity: 0,
      has_data: opts.hasData !== false,
      ...patch,
    });
  }
  fs.writeFileSync(path.join(DATA_DIR, '_index.json'), JSON.stringify(index, null, 2), 'utf-8');
  _indexCache = index;
  _indexCacheTime = Date.now();
  return { filePath, packData };
}

// ==================== OCG 卡图动态定位 ====================
/**
 * 动态列出某卡在其包目录下的实际 OCG 图文件（不依赖静态映射表 tcg-ocg-map.json）。
 * 命名规则：{编号}-{罕贵}.jpg / {编号}-{罕贵}-{异画序号}.jpg
 * 返回 { dir, files }；卡无效或目录无匹配文件时返回 null。
 * 按目录实扫而非猜文件名，新包/新罕贵/异画变体全部自动覆盖，无需维护映射表。
 */
function listOcgFiles(card, ocgDir) {
  if (!card || !card.packCode || !card.code) return null;
  const dir = path.join(ocgDir, card.packCode);
  const names = cachedReaddir(dir);
  if (!names) return null;
  const files = names.filter(f => IMG_EXT_RE.test(f) && f.startsWith(card.code + '-'));
  return files.length ? { dir: card.packCode, files } : null;
}

/**
 * 精准定位某张卡的 OCG 图源文件 —— 只认两条路，不做任何模糊兜底：
 *   altIndex = 0 → {编号}-{罕贵}.{ext}
 *   altIndex > 0 → {编号}-{罕贵}-{异画序号}.{ext}
 *
 * 2026-09-29 起取代原来的 pickBest。旧 pickBest 有两个静默兜底
 * （只有一张图就直接返回、罕贵度对不上就退回原画），导致「改了罕贵度看不出变化」
 * 且永远不会失败 —— 实测库里 82.8% 的编号在包目录里只有一张图，罕贵度根本不参与挑图。
 *
 * 返回绝对路径；落空返回 null，由调用方决定是 404 还是继续走兜底链。
 */
function findOcgExact(ocgDir, packCode, code, rarity, altIndex) {
  if (!ocgDir || !packCode || !code || !rarity) return null;
  const e = readDirIndex(path.join(ocgDir, packCode));
  if (!e) return null;
  const key = altIndex > 0 ? `${code}-${rarity}-${altIndex}` : `${code}-${rarity}`;
  const file = e.stems.get(key);
  if (!file) return null;
  const abs = path.join(ocgDir, packCode, file);
  return fs.existsSync(abs) ? abs : null;
}

/**
 * 兜底模式的挑图函数 —— 只在「没给 code，或没给 rarity」时被调用。
 * 这是改造前 card-image / card-thumbnail 各自那份的合并版（两份逐字重复），语义完全保留：
 *   1) 只有一张图 → 直接返回（**正是"改罕贵度看不出变化"的老根因**，故仅限兜底模式）
 *   2) 有 rarity → 先按 {-罕贵[-异画号]} 后缀匹配，再退一步只按罕贵匹配
 *   3) 全不中 → 优先原画（无 -数字 后缀），再退到第一张
 * 注意它**永不返回 null 之外的"失败"信号**，也就是会静默降级。想要失败可见的调用方走 findOcgExact。
 */
function pickBest(files, rarity, altIndex) {
  if (!files || files.length === 0) return null;
  if (files.length === 1) return files[0];

  if (rarity) {
    const exact = files.find(f => {
      const name = f.replace(/\.\w+$/, '');
      const suffix = altIndex > 0 ? '-' + altIndex : '';
      return name.endsWith('-' + rarity + suffix);
    });
    if (exact) return exact;
    // 退一步：匹配该罕贵度（不限异画序号）
    const rarityMatch = files.find(f => {
      const name = f.replace(/\.\w+$/, '');
      const lastPart = name.split('-').pop();
      const r = lastPart.replace(/\d+$/, '');
      return r === rarity;
    });
    if (rarityMatch) return rarityMatch;
  }
  // 默认：优先原画（无 -数字 后缀）
  const original = files.find(f => !/-[0-9]+\.[a-z]+$/i.test(f));
  return original || files[0];
}

/**
 * 列出某编号在图源里**真实存在**的罕贵度（扫包目录主名，不看 CardCatalog.rarity 字段）。
 * 返回 [{ rarity, altCount }]，altCount = 1 表示只有原画、> 1 表示有异画变体。
 * 按主名分组：{编号}-{罕贵} → 原画；{编号}-{罕贵}-{N} → 该罕贵的第 N 张。
 */
function listOcgRarities(ocgDir, packCode, code) {
  if (!ocgDir || !packCode || !code) return [];
  const e = readDirIndex(path.join(ocgDir, packCode));
  if (!e) return [];
  const prefix = code + '-';
  const out = new Map(); // rarity → 最大异画序号（原画记 0）
  for (const stem of e.stems.keys()) {
    if (!stem.startsWith(prefix)) continue;
    const rest = stem.slice(prefix.length);
    // 罕贵度这一段的实际取值比想象中野：除 UR/SER/QCSER 这类，还有
    // `UR-OF`（含横杠）、`Normal Monster` / `Quick-Play Spell`（含空格）。
    // 原来写成 ^([A-Za-z0-9]+)(?:-(\d+))?$ 会把它们整条丢掉，
    // 表现为这些卡在「真实罕贵度」列表里一个都看不到。
    // 放宽成「任意字符 + 可选的 -数字 尾巴」；非贪婪让 -数字 优先当异画序号。
    const m = rest.match(/^(.+?)(?:-(\d+))?$/);
    if (!m) continue;
    const [, rarity, num] = m;
    const idx = num ? parseInt(num, 10) : 0;
    if (!out.has(rarity) || idx > out.get(rarity)) out.set(rarity, idx);
  }
  return [...out.entries()]
    .map(([rarity, maxIdx]) => ({ rarity, altCount: maxIdx + 1 }))
    .sort((a, b) => a.rarity.localeCompare(b.rarity));
}

// ==================== 罕贵度异画解析 ====================
/** 解析 rarity 字符串: "SER(0,初版)、SER(1,异画)" → {SER:1} */
function parseRarityMap(rarityStr) {
  if (!rarityStr) return {}
  const map = {}
  const parts = rarityStr.split(/[、]/).map(s => s.trim()).filter(Boolean)
  parts.forEach(p => {
    // 新格式: SER(0,初版) 或 旧格式: SER(1) 或 无格式: SER
    const m = p.match(/^([A-Za-z0-9]+)(?:\((\d+)(?:,.*?)?\))?$/)
    if (m) {
      const r = m[1]
      const idx = m[2] ? parseInt(m[2]) : 0
      if (!map[r] || idx > map[r]) map[r] = idx
    }
  })
  return map
}

// GET /api/tcg/rarity-info/:code — 这个编号在图源里**真实存在**的罕贵度
//
// 2026-09-29 改：以前读目录字段 `cat.rarity`，而那个字段本身就常和图源对不上
// （PC5-JP001 目录写 N、NPR，图源只有 C）—— 拿它去填「罕贵度」等于把错的那套抄一遍。
// 现在扫包目录文件名，和挑图逻辑**用同一个数据源**，不会再出现「下拉里选得到、图却挑不出」。
//
// 返回保留旧的 rarities 字段（万一还有我没找到的调用方），新增的：
//   rarityList      [{rarity, altCount}]  altCount=1 只有原画，>1 表示另有 -1..-(n-1) 张异画
//   source          'files' = 图源实扫（权威）；'catalog' = 图源里一张图都没有，退回目录字段
//   matchesCatalog  库里写的罕贵度是否落在图源真实集合里（false = 这张卡的罕贵度是错的）
//   catalogRarities 目录字段解析结果，供对照
router.get('/rarity-info/:code', async (req, res) => {
  try {
    const code = (req.params.code || '').trim().toUpperCase()
    // 一个编号是好几个行（一行一个罕贵度），先把整组拿齐再拼回「、」串 —— 只看一行的话
    // `matchesCatalog` / `catalogRarities` 会退化成「只比了随便挑的那一个罕贵度」。
    const rows = await CardCatalog.find({ code }).sort({ rarity: 1, altArtIndex: 1 }).lean()
    const cat = rows[0]
    const { ocgDir } = tcgPaths.get()
    let rarityList = cat ? listOcgRarities(ocgDir, cat.packCode, code) : []
    let source = 'files'
    if (!rarityList.length) {
      source = 'catalog'
      rarityList = Object.entries(parseRarityMap(合(rows)))
        .map(([rarity, maxIdx]) => ({ rarity, altCount: maxIdx + 1 }))
        .sort((a, b) => a.rarity.localeCompare(b.rarity))
    }
    const catalogRarities = parseRarityMap(合(rows))
    res.json({
      code,
      packCode: (cat && cat.packCode) || '',
      extCode: (cat && cat.extCode) || '',
      source,
      rarityList,
      catalogRarities,
      matchesCatalog: rarityList.some(r => r.rarity in catalogRarities),
      rarities: catalogRarities,             // 旧字段，保持兼容
      hasAltArt: rows.some(r => r.hasAltArt),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ==================== 卡包列表 ====================
router.get('/packs', async (req, res) => {
  try {
    const { q, page, perPage } = req.query;
    const pg = parseInt(page) || 1;
    const pp = Math.min(parseInt(perPage) || 823, 2000);

    // 1. 从 _index.json 获取所有包的元数据
    const index = loadIndex();
    let allPacks = (index.packs || []).map(p => ({
      code: p.code,
      full_name: p.full_name || '',
      en_name: p.en_name || '',
      date: p.date || '',
      total_cards: p.total_cards || 0,
      status: p.status || 'pending',
      reason: p.reason || '',
      image_count: p.image_count || 0,
      missing_rarity: p.missing_rarity || 0,
      has_data: p.has_data !== false,
      category: p.category || '',
    }));

    // 2. 从 MongoDB 获取实际卡牌计数（覆盖 total_cards）
    //    两个口径都要：`total_cards` = 行数（同一编号有几个罕贵度就算几行），
    //    `unique_codes` = 不同编号数（这个包有多少**种**卡）。拆行之后这两个数不再相等，
    //    页面上显示成「80（120）」——80 种、120 行。
    const mongoCounts = await CardCatalog.aggregate([
      { $group: { _id: '$packCode', mongoTotal: { $sum: 1 }, codes: { $addToSet: '$code' } } }
    ]);
    const countMap = {};
    const codeCountMap = {};
    mongoCounts.forEach(c => {
      countMap[c._id] = c.mongoTotal;
      codeCountMap[c._id] = (c.codes || []).length;
    });

    // 合并：用 MongoDB 实际计数，同时保留 _index.json 的所有元数据
    allPacks = allPacks.map(p => ({
      ...p,
      total_cards: countMap[p.code] || p.total_cards || 0,
      unique_codes: codeCountMap[p.code] || 0,
    }));

    // 3. 搜索过滤 + 优先级排序
    if (q) {
      const kw = q.toLowerCase();
      // 先过滤
      allPacks = allPacks.filter(p =>
        p.code.toLowerCase().includes(kw) ||
        p.full_name.toLowerCase().includes(kw)
      );
      // 按优先级排序：精确code > code开头 > full_name开头 > 包含
      allPacks.sort((a, b) => {
        const aCode = a.code.toLowerCase();
        const bCode = b.code.toLowerCase();
        const aName = (a.full_name || '').toLowerCase();
        const bName = (b.full_name || '').toLowerCase();

        const scoreA = aCode === kw ? 0 : aCode.startsWith(kw) ? 1 : aName.startsWith(kw) ? 2 : 3;
        const scoreB = bCode === kw ? 0 : bCode.startsWith(kw) ? 1 : bName.startsWith(kw) ? 2 : 3;

        return scoreA - scoreB || aCode.localeCompare(bCode);
      });
    }

    // 4. 分页
    const total = allPacks.length;
    const skip = (pg - 1) * pp;
    const paged = allPacks.slice(skip, skip + pp);

    res.json({
      ok: true,
      packs: paged,
      total,
      page: pg,
      totalPages: Math.ceil(total / pp) || 1
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== 卡包详情 ====================
router.get('/packs/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { q, page, perPage } = req.query;

    // 从 _index.json 获取包元数据
    const index = loadIndex();
    const packMeta = (index.packs || []).find(p => p.code === code.toUpperCase());

    const filter = { packCode: code.toUpperCase() };
    if (q) {
      const kw = q.toLowerCase();
      // 卡名不在 cardcatalogs 里了，`$regex` 筛不下去 —— 反过来先按名字查出身份，
      // 再用 extCode / code 去筛。**大小写不敏感由 `按名字找卡密` 内部统一小写化负责**，
      // 所以这里不再重复写 `$options: 'i'`（只保留 code 那一路，那还是原来的子串匹配）。
      const 命中 = await 卡名.按名字找卡密(kw);
      filter.$or = [
        { extCode: { $in: 命中.extCodes } },
        { code: { $in: 命中.codes } },
        { code: { $regex: kw, $options: 'i' } }
      ];
    }

    const pg = parseInt(page) || 1;
    // 上限从 500 提到 1000：拆行之后行数变多了（4,339 个多罕贵度编号 → 多出 7,700 行），
    // 而目录页要一屏把整包的「行」拿全才好编辑（少拿的那部分前端看不见，也没法删）。
    const pp = Math.min(parseInt(perPage) || 1000, 1000);
    // countDocuments 和 find **必须用同一个 filter**，否则 total 和页数对不上
    const total = await CardCatalog.countDocuments(filter);
    const cards = await CardCatalog.find(filter)
      .sort({ code: 1 })
      .skip((pg - 1) * pp)
      .limit(pp)
      .lean();
    await 卡名.回填(cards);

    if (total === 0 && !packMeta && !q) {
      return res.status(404).json({ ok: false, error: `${code} 不存在` });
    }

    res.json({
      ok: true,
      code: code.toUpperCase(),
      full_name: packMeta?.full_name || '',
      date: packMeta?.date || '',
      status: packMeta?.status || 'pending',
      total_cards: total,
      // 每行是一个 (编号, 罕贵度, 后缀序号)。`total_cards` 是**行数**（同一个编号有几个
      // 罕贵度就算几行），跟「这个包有多少种卡」不是一回事 —— 页面上按「种（行）」显示。
      cards: cards.map(c => ({
        code: c.code,
        jp_name: c.jpName,
        cn_name: c.cnName,
        en_name: c.enName,
        ext_code: c.extCode,
        rarity: c.rarity,
        has_alt_art: c.hasAltArt,
        alt_art_index: c.altArtIndex || 0,
        alt_label: c.altLabel || '',
        cn_source: c.cnSource || ''
      })),
      page: pg,
      totalPages: Math.ceil(total / pp) || 1
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== 保存卡包编辑（卡牌目录页的「💾 保存」） ====================
// 前端 catalog.vue 的「✏️ 修改 → 💾 保存」原本 POST 到这个路径，但服务端从来没有这条
// 路由 —— 也就是说卡密/日文名/中文名/英文名/罕贵度这五个字段**此前根本存不进去**，
// 点保存必然弹 ❌失败。这条补上，用户要的「改卡牌编号」也才有地方落。
//
// 语义：**只 upsert + 显式删。** 前端发的是它页面上的那份数组，而 GET /packs/:code 是
// 分页的（上限 1000），大包本来就传不全 —— 把「数组里没有的」当成「要删掉的」会误删
// 目录行，连带撕掉它和 cards 集合的对应关系。所以：
//   · `cards` 里的，逐行 upsert（三元组 {code, rarity, altArtIndex}）
//   · 真要删的行，前端单独放进 `deleted`（界面上是「🗑 删掉这一行」），只有它会被删
router.put('/packs/:code', authAdmin, async (req, res) => {
  try {
    const packCode = String(req.params.code || '').trim().toUpperCase();
    if (!PACK_CODE_RE.test(packCode)) {
      return res.status(400).json({ ok: false, error: `卡包编号不合法：${packCode}` });
    }

    const incoming = req.body && req.body.cards;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ ok: false, error: '格式错误：需要 cards 数组' });
    }

    const errors = [];      // 被跳过的行（卡密不是纯数字之类）+ 名字/磁盘回写失败
    const incoming2 = [];  // 展开后的行（一条进来可能拆成几行）
    for (const card of incoming) {
      // 字段映射与校验都在 buildCatalogDoc 里，Excel 导入走的是同一个函数 ——
      // 校验规则只有一份，不会出现「界面存不进去、Excel 却存进去了」
      const built = buildCatalogDoc(packCode, card);
      if (built.error) { errors.push(built.error); continue; }
      for (const doc of built.docs) incoming2.push({ doc, names: built.names });
    }

    let removed = 0;
    const 待删 = Array.isArray(req.body && req.body.deleted) ? req.body.deleted : [];
    // 声明在 if 外面 —— 下面回写包 JSON 时要把这些编号也并进「受影响」，
    // 否则「只删不增」时那个编号根本不会被归并到，磁盘文件里会留下一条库里已经没有的卡。
    const 删 = 待删.map(d => ({
      code: String((d && d.code) || '').trim().toUpperCase(),
      rarity: String((d && (d.rarity)) || '').trim(),
      altArtIndex: parseInt(d && (d.altArtIndex != null ? d.altArtIndex : d.alt_art_index)) || 0,
    })).filter(d => d.code);
    for (const d of 删) {
      // 显式删除。**只有这里会删行** —— 上面那条「数组里没有的当成要删的」的规矩依旧不作数
      // （GET 的分页上限摆着，前端本来就可能没传全）。
      //
      // 库存里还有这个编号的实物卡就不删 —— 跟「删卡包」同一个口径（用户定的：直接禁止，
      // 先清空库存）。删了目录行、实物卡还在，那张卡就变成查不到编号的孤儿。
      // 这里只拦 `deleted` 里的行，不影响同一次请求里对其它行的 upsert。
      const 实物卡数 = await Card.countDocuments({ code: d.code });
      if (实物卡数 > 0) {
        errors.push(`${d.code}：库存里还有 ${实物卡数} 张实物卡，先清库存再删这一行`);
        continue;
      }
      const r = await CardCatalog.deleteOne({ code: d.code, rarity: d.rarity, altArtIndex: d.altArtIndex });
      removed += r.deletedCount || 0;
    }

    let inserted = 0;
    let updated = 0;
    const accepted = [];   // 展开后的行，等下合并回包 JSON（写出去时按编号归并成「、」串）
    const 待收名 = [];     // 名字不落 cardcatalogs 了，交给唯一目录（见循环后的 卡名.收下）

    for (const { doc, names } of incoming2) {
      // 唯一键是三元组：同一个编号的 UR / SER / QCSER 是三行，各存各的
      const r = await CardCatalog.updateOne(
        { code: doc.code, rarity: doc.rarity, altArtIndex: doc.altArtIndex },
        { $set: doc },
        { upsert: true }
      );
      if (r.upsertedCount > 0) inserted++;
      else if (r.matchedCount > 0) updated++;
      待收名.push({ code: doc.code, extCode: doc.extCode, ...names });
    }

    // 名字交给唯一目录（只补空位、不覆盖 —— 页面上照抄回来的值是同一个，等于没写）
    try {
      await 卡名.收下(待收名);
    } catch (e) {
      // 名字收不下不算保存失败：卡片行本身已经写好了
      errors.push(`卡名写入唯一目录失败（卡片已保存）：${e.message}`);
    }

    // 回写 {dataDir}/{packCode}.json + _index.json，让「前端改了 → 原始 JSON 也跟上」
    let totalCards = null;
    try {
      totalCards = await CardCatalog.countDocuments({ packCode });
      // ⚠️ 传的必须是**库里现存的**这一批编号的全部行，不能直接用 incoming2 ——
      // writePackJson 是拿这批行重新拼「、」串的，少一行就会把那个罕贵度从磁盘上抹掉。
      // 上面刚删过行，所以这里按受影响编号回读一遍，删掉的自然就不在里头了。
      // 「受影响」要连**被删掉的编号**一起算上。只 upsert 的话这里没问题，但「只删不增」
      // （cards 传空数组、deleted 传一行）时 incoming2 是空的 —— 那个编号就不会进归并循环，
      // writePackJson 又只会更新、从不删除，结果磁盘上那条记录原样留着，跟库里对不上。
      const 受影响 = [...new Set([...incoming2.map(x => x.doc.code), ...删.map(d => d.code)])];
      // `packCode` 过滤是必须的：同一个编号理论上可能出现在别的包的行里，
      // 不按包过滤就会把别包的行一起拼进这个包头的「、」串，还会让本包该摘的条目摘不掉。
      const 权威 = 受影响.length
        ? await CardCatalog.find({ packCode, code: { $in: 受影响 } }).select('code rarity altArtIndex extCode hasAltArt cnSource').lean()
        : [];
      // 回读完一行都不剩的编号 —— 这些要让 writePackJson 把条目整个从包里摘掉。
      // （还有别的罕贵度剩着的编号不会进这里：它们会被上面那段归并重写成剩下的那几档。）
      const 剩 = new Set(权威.map(x => String(x.code || '').trim().toUpperCase()));
      const removeCodes = 受影响.filter(c => !剩.has(String(c).trim().toUpperCase()));
      writePackJson(packCode, 权威, { totalCards, hasData: true, removeCodes });
      accepted.push(...权威);
    } catch (e) {
      // 磁盘回写失败不算失败：Mongo 已经改好了，前端刷新就能看到。只回报一句
      errors.push(`包 JSON 回写失败（数据库已保存）：${e.message}`);
    }

    // 这条路口子本来就一直缺这两句：services/cardReview.js 顶上写着「任何写 cardcatalogs
    // 的路径之后都必须调 bumpReviewVersion()」，本文件 :30-32 也把这条约定抄了一遍，
    // 但 PUT 从来没引过 cardReview。以前它只是批量保存的一个出口、又靠 60 秒 TTL 遮着；
    // 现在卡牌详情弹窗的每一次改动都走这里，不补的话「卡牌资料核对」的数字会一直不动。
    cardReview.bumpReviewVersion();
    // 下面 writePackJson 只刷了 _indexCache，未收录清单(dirListCache)那几份还是旧的
    invalidateTcgCaches(packCode);

    res.json({
      ok: true,
      packCode,
      total: incoming.length,
      inserted,
      updated,
      removed,
      saved: incoming2.length,
      totalCards,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== 卡牌查询（按 code 精确查） ====================

/**
 * 把一个编号的那几行（一个罕贵度一行）拼成接口吐出去的那张 `card`。
 *
 * ★ `/card`（单查）与 `/cards`（批量查，V1.2.83）**必须共用这一份**。
 *   两处各写一份的话形状必然慢慢漂移 —— 而前端是照这个形状读的
 *   （`拉目录` 认 `jp_name`，卡片库认 `rarity` / `alt_labels` 拼 `cataKey`），
 *   漂一格就是"全变未找到"或者"异画全错"。这是本次改动最大的回归风险。
 *
 * @param {object[]} rows     同一个编号的全部行，已按 (rarity, altArtIndex) 排好序
 * @param {string}   qRarity  调用方点名的罕贵度（大写，可空）
 * @param {string}   ocgDir   图源 OCG 目录
 * @returns {Promise<object>} 接口形状里的那个 `card`
 */
async function buildCardPayload(rows, qRarity, ocgDir) {
  const card = rows[0];
  await 卡名.回填(card);

  const 全部罕贵 = rows.map(r => ({ rarity: r.rarity, altArtIndex: r.altArtIndex || 0 }));
  const alt_labels = {};
  for (const r of rows) {
    const v = (r.altLabel || '').trim();
    if (v) alt_labels[`${r.rarity}|${r.altArtIndex || 0}`] = v;
  }

  // 统计该卡各罕贵度的异画版本 —— 一律以**图源文件**为准。
  // 命名规则 {编号}-{罕贵}.jpg（原画）/ {编号}-{罕贵}-{N}.jpg（异画N）。
  //
  // 2026-09-29 换掉原来的模糊统计。旧写法有两个坑：
  //   ① `name.includes('-' + qRarity)` 是**子串**匹配 —— 传 SER 会同时命中
  //      `-QCSER`、`-DSER`、`-20SER`，alt_count 被放大成根本不存在的张数；
  //   ② 兜底那段是"整包找异画序号最大的那个罕贵"，跟 listOcgRarities 的口径不一致。
  // 现在的 alt_rarity 会被客户端拿去拼卡图 URL（异画切换、下拉框都靠它），
  // 报错了就是一片 404 → 卡背，所以必须是图源里逐字真实的那个罕贵。
  const realRarities = listOcgRarities(ocgDir, card.packCode, card.code); // [{rarity, altCount}]
  // 传入的罕贵在图源里存在就用它；否则退到「有异画的那一个」；再没有就是没异画
  const picked = realRarities.find(r => r.rarity === qRarity)
    || realRarities.find(r => r.altCount > 1)
    || null;
  const hasAltArt = card.hasAltArt || realRarities.some(r => r.altCount > 1);

  return {
    code: card.code,
    pack: card.packCode,
    jp_name: card.jpName,
    cn_name: card.cnName,
    en_name: card.enName,
    rarity: 合(全部罕贵),
    password: card.extCode,
    has_alt_art: hasAltArt,
    alt_count: picked ? picked.altCount : 1,
    alt_rarity: picked ? picked.rarity : '',
    alt_art_index: 0,
    alt_labels
  };
}

router.get('/card', async (req, res) => {
  try {
    const { ocgDir: IMG_OCG } = tcgPaths.get();
    const { code } = req.query;
    if (!code) return res.status(400).json({ found: false, error: '需要 code 参数' });

    // 一个编号现在是好几行（一行一个罕贵度）。这里**保持接口形状不变** ——
    // `rarity` 还是那个「、」串、`alt_labels` 还是 `{"SER|1": "异画"}` 那份映射，
    // 因为库存页 / 自动上架页 / 上传页三个消费者都是照老形状读的（见卡片库里的
    // `cataKey = rarity + '|' + altArtIndex`）。拆行是库里的存储方式，不外泄。
    const rows = await CardCatalog.find({ code: code.trim().toUpperCase() })
      .sort({ rarity: 1, altArtIndex: 1 }).lean();
    if (!rows.length) return res.json({ found: false });

    res.json({
      found: true,
      card: await buildCardPayload(rows, (req.query.rarity || '').trim().toUpperCase(), IMG_OCG),
    });
  } catch(e) {
    res.status(500).json({ found: false, error: e.message });
  }
});

// ★ 单次能带的编号数上限。前端 `拉目录` 按这个数分块（V1.2.83）。
const 批量查上限 = 200;

/**
 * ==================== 卡牌批量查（V1.2.83） ====================
 *
 * 为什么要有这一支
 * ----------------
 * 自动上架页进一次要按编号拉目录。真库实测一批 **8562 个编号** ——
 * 原来是一编号一次 `GET /card`，也就是**同时压 8562 个 HTTP 上去**。
 * 浏览器同域只开 6~10 条连接，其余全排队，整页的图片和别的接口一起被饿死，
 * 表现就是"点什么都卡"。`GET /card` 单次本身很便宜（1 次索引查 + 内存缓存的卡名
 * + 按包目录缓存 30s 的 readdir），**问题是请求数，不是单次成本** ——
 * 所以解法是"一次多带几个编号"，不是"把单查做快"。8562 → 43 次。
 *
 * 为什么是 POST
 * -------------
 * 200 个编号拼进 query string 会撞 URL 长度上限；CSV 还会让请求数翻倍。
 *
 * 为什么**不带 auth**
 * ------------------
 * 跟它替代的 `GET /card` 保持一致 —— `拉目录` 的 fetch 本来就不带 token。
 * 这里读的是图源目录的目录数据（本来就公开在卡图/目录页上），不涉用户数据。
 *
 * ★ 返回的键必须是**请求里那个原样字符串**
 * ---------------------------------------
 * 前端 `名称表` 的键是 `item.code` 原值（可能有小写、可能有前后空格），
 * 拿归一化后的大写当键会让它**一条都命中不上** → 整批变"未找到" → 红边 +
 * `blocked` → 归档被判据拦死。归一化只用来查库，不改键。
 *
 * ★ `missing` 只在**成功**时出现
 * -----------------------------
 * 前端据"有没有 `missing`"决定要不要把编号记进 `未找到`。失败响应里带上它，
 * 一次网络抖动就会被读成"这些编号在目录里真没有"，把整包标成不可上架、卡死归档。
 * 所以失败分支只有 `{ ok:false, error }`，一个 `missing` 都不带。
 */
router.post('/cards', async (req, res) => {
  try {
    const { ocgDir: IMG_OCG } = tcgPaths.get();
    const codes = req.body && req.body.codes;
    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ ok: false, error: '需要 codes 数组（非空）' });
    }
    if (codes.length > 批量查上限) {
      return res.status(400).json({ ok: false, error: `一次最多查 ${批量查上限} 个编号，分几批发` });
    }

    // 原样串：**一个字都不改**（不 trim、不大写），前端是拿 `item.code` 原值来
    // `cards[code]` 取的 —— 键只要跟它差一个字符，这条就永远命中不上，而且
    // `missing` 里也找不到它，于是什么都不写、每次刷新重来一遍。
    // 只把"空 / 全空白"的挑掉：那种编号本来也查不到，留着当键只会多一条假 missing。
    const 原样们 = [...new Set(codes.map(c => String(c == null ? '' : c)).filter(c => c.trim()))];
    if (原样们.length === 0) return res.status(400).json({ ok: false, error: 'codes 里没有有效编号' });
    // （小写、前后空格）只用来查库；回给前端的键仍是上面那份原样串
    const 归一化 = [...new Set(原样们.map(c => c.trim().toUpperCase()))];

    // **一次 `$in` 把全部编号查出来**，绝不能按编号循环 find ——
    // 那只是把 43 次请求换成了 8562 次数据库查询，白白把瓶颈从网络搬到库上。
    const rows = await CardCatalog.find({ code: { $in: 归一化 } })
      .sort({ rarity: 1, altArtIndex: 1 }).lean();

    // 卡名也**一次回填全部行**（内存 Map、10 分钟 TTL，见 services/cardNames.js）。
    // 下面 buildCardPayload 里那次 `回填` 会命中同一份缓存，不会各查一次库。
    await 卡名.回填(rows);

    // 按编号分组（rows 已经排好序，组内顺序就是单查时的顺序）
    const 按编号 = new Map();
    for (const r of rows) {
      if (!按编号.has(r.code)) 按编号.set(r.code, []);
      按编号.get(r.code).push(r);
    }

    const cards = {};
    const missing = [];
    for (const 原样 of 原样们) {
      const 组 = 按编号.get(原样.trim().toUpperCase());
      // 批量查不带 rarity 参数：`拉目录` 只要名字，异画统计走"有异画的那一个"这个默认。
      // 要按指名罕贵度取异画的调用方仍走单查 `GET /card?rarity=`。
      if (组) cards[原样] = await buildCardPayload(组, '', IMG_OCG);
      else missing.push(原样);
    }

    res.json({ ok: true, cards, missing });
  } catch(e) {
    // 失败里**故意不带 missing**（前端据它决定要不要写 `未找到`）—— 见上面那段注释
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== 卡名实时预览（目录页弹窗用） ====================
// 「卡牌详情」弹窗里改「卡密」时，右边那三个只读卡名要跟着换 —— 卡密是**取名字的钥匙**
// （见 services/cardNames.js 顶上那段），换一把钥匙就该看到另一组名字。
// 前端防抖 300ms 打一次这里，只读、不写任何东西。
//
// ⚠️ 必须走 `卡名.按输入取`，**不能**用 `卡名.回填()` —— 后者内部是 `查一条`，
//    卡密查不到时会**回退到编号**，于是敲一个查不到的卡密会把这一行旧编号的名字顶上来，
//    看着像"查到了"，用户会以为「改了卡密名字没变」。
//
// 查不到不是错误：三个名字一律回**空串**（和 `卡名.回填` 给目录行的形状一致），
// 前端 `|| '—'` 自然显示破折号。所以这里没有 404 分支 —— 多一层分叉，
// 调用方就要多写一段「是查不到还是请求失败」的判断。
router.get('/card-names', async (req, res) => {
  try {
    const 卡密 = String(req.query.ext_code || '').trim();
    // 编号统一大写：carduniques 里 `code` 那类身份的键都是大写写进去的
    // （buildCatalogDoc / rename-code 都 toUpperCase 过），而缓存取名字这一步不做归一 ——
    // 漏了大写，小写编号会查不到、白白显示「—」。
    const 编号 = String(req.query.code || '').trim().toUpperCase();
    const n = await 卡名.按输入取(卡密, 编号);
    res.json({
      ok: true,
      jp_name: n ? n.jp : '',
      cn_name: n ? n.cn : '',
      en_name: n ? n.en : '',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== 异画标签 ====================
// 这里原来有一对 `/alt-labels` 接口 + `alt-labels.json` 那份独立文件，V1.2.39 撤掉了：
// 标签现在是**行上的一个字符串**（`cardcatalogs.altLabel`），跟 (编号, 罕贵度, 后缀序号)
// 一一对应，不再需要按编号拼 `SER|1` 这种键。编辑入口在卡牌编号目录页那一列。
// 要点：
//   · 读 — `GET /card` 仍然按老形状吐出 `alt_labels: {"SER|1": "异画"}`，
//     库存页 / 自动上架页 / 上传页三个消费者一个字不用改。
//   · 写 — 走 `PUT /packs/:code`（那一行带 `alt_label` 字段），不再有独立写口。
// `alt-labels.json`、`services/altLabels.js`、前端那个「异画标签」页已一并删除。

// ==================== 卡图服务 ====================
// 两种模式，由请求参数决定：
//   ① 精准模式 —— 同时带 code 和 rarity：只认 {编号}-{罕贵}[-{异画号}] 整段命中，落空直接 404。
//      不查映射表、不退 YGOPro。「改错罕贵度就该看得见」靠的就是这条。
//   ② 兜底模式 —— 其它情况（只带 password，或缺 rarity）：保留原有的逐级降级链。
//      想要"保证有图"的调用方自己走这条（如 admin/catalog.vue 的两级候选链）。
router.get('/card-image', async (req, res) => {
  try {
    const { ocgDir: IMG_OCG, ygoproDir: IMG_YGOPRO } = tcgPaths.get();
    const { password, code } = req.query;
    const extCode = (password || '').trim();
    // 安全: 卡密只允许字母/数字/下划线/短横线, 拒绝路径遍历字符（它会被拼进 YGOPro\{卡密}.jpg）
    if (!卡密合法(extCode)) return res.status(400).json({ error: 'password 参数不合法：' + 卡密说明 });
    const rarity = (req.query.rarity || '').trim().toUpperCase();
    const altIndex = parseInt(req.query.altIndex) || 0;
    // 缓存头只挂在成功响应上。以前设在函数最开头，连 404 都带 7 天 max-age，
    // 于是一次落空会被浏览器记 7 天 —— 用户订正完数据还得清缓存才看得见。
    const sendImg = (p) => {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 天
      return res.sendFile(p);
    };

    // ① 精准模式
    if (code && rarity) {
      const c = code.trim().toUpperCase();
      const card = await CardCatalog.findOne({ code: c }).lean();
      const p = card ? findOcgExact(IMG_OCG, card.packCode, card.code, rarity, altIndex) : null;
      if (p) return sendImg(p);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: `图源里没有 ${c} 的 ${rarity}${altIndex > 0 ? '-' + altIndex : ''}` });
    }

    // ② 兜底模式 —— 以下为原有降级链，未做改动
    // P0: 日文OCG — 按 code 查 MongoDB → 包目录实扫（新包无需映射表）
    if (code) {
      const card = await CardCatalog.findOne({ code: code.trim().toUpperCase() }).lean();
      const ocg = listOcgFiles(card, IMG_OCG);
      if (ocg) {
        const best = pickBest(ocg.files, rarity, altIndex);
        // 文件必须真实存在才返回，缺失则继续走下级兜底（避免 sendFile 抛错→500）
        if (best && fs.existsSync(path.join(IMG_OCG, ocg.dir, best))) return sendImg(path.join(IMG_OCG, ocg.dir, best));
      }
    }

    // P1: 日文OCG — 卡密反查 MongoDB 定位包目录（兼容仅传卡密的调用；新包无需映射表）
    // 注意：不按 packCode 去重——同包内不同 code 的文件列表不同，去重会漏检第二条记录
    const extCards = await CardCatalog.find({ extCode }).lean();
    for (const c of extCards) {
      const ocg = listOcgFiles(c, IMG_OCG);
      if (!ocg) continue;
      const best = pickBest(ocg.files, rarity, altIndex);
      // 文件必须真实存在才返回，缺失则继续走下级兜底（避免 sendFile 抛错→500）
      if (best && fs.existsSync(path.join(IMG_OCG, ocg.dir, best))) return sendImg(path.join(IMG_OCG, ocg.dir, best));
    }
    // P1b: 历史兜底 — 映射表（旧包/特殊命名，映射表记录 卡密→包目录/新文件名）
    const ocgEntries = tcgOcgMap.get()[extCode];
    if (ocgEntries && ocgEntries.length) {
      // 同卡密可能跨包目录 → 按目录分组后各目录内 pickBest
      const byDir = {};
      for (const e of ocgEntries) (byDir[e.dir] = byDir[e.dir] || []).push(e.file);
      for (const dir of Object.keys(byDir)) {
        const best = pickBest(byDir[dir], rarity, altIndex);
        // 文件必须真实存在才返回，缺失则继续走下级兜底（避免 sendFile 抛错→500）
        if (best && fs.existsSync(path.join(IMG_OCG, dir, best))) return sendImg(path.join(IMG_OCG, dir, best));
      }
    }

    // P2: YGOPro图片源/{extCode}.jpg（兜底）
    const ygoproPath = path.join(IMG_YGOPRO, extCode + '.jpg');
    if (fs.existsSync(ygoproPath)) return sendImg(ygoproPath);

    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: '卡图不存在' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 缩略图服务 ====================
// GET /api/tcg/card-thumbnail?password=89631139[&code=QCAC-JP001&rarity=SER&altIndex=1]
// 懒加载：首次请求从原图生成 200px WebP 缩略图并缓存，后续直接返回。
// 缩略图目录分两个子文件夹：
//   thumbDir\OCG\{code}-{rarity}(-{N}).webp     ← 详细图缩略图 (文件名与原图一致)
//   thumbDir\YGOPro\{password}.webp             ← 保底图缩略图
router.get('/card-thumbnail', async (req, res) => {
  try {
    const { thumbDir: THUMB_DIR, ocgDir: IMG_OCG, ygoproDir: IMG_YGOPRO } = tcgPaths.get();
    const extCode = (req.query.password || '').trim();
    // 安全: 卡密只允许字母/数字/下划线/短横线, 拒绝路径遍历字符（它会被拼进 YGOPro\{卡密}.jpg）
    if (!卡密合法(extCode)) return res.status(400).json({ error: 'password 参数不合法：' + 卡密说明 });
    const code = (req.query.code || '').trim().toUpperCase();
    const rarity = (req.query.rarity || '').trim().toUpperCase();
    const altIndex = parseInt(req.query.altIndex) || 0;

    const sendThumb = (p) => {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 天
      return res.sendFile(p);
    };

    // 生成缩略图: 原图路径 → thumbDir 对应子文件夹 (文件名一致, .webp)
    const generateThumb = async (originalPath, subDir) => {
      const fname = path.basename(originalPath).replace(/\.(jpg|jpeg|png)$/i, '.webp');
      const thumbSub = path.join(THUMB_DIR, subDir);
      if (!fs.existsSync(thumbSub)) fs.mkdirSync(thumbSub, { recursive: true });
      const thumbPath = path.join(thumbSub, fname);
      if (fs.existsSync(thumbPath)) return thumbPath; // 已缓存
      await sharp(originalPath)
        .resize(200, null, { withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(thumbPath);
      console.log(`[Thumb] 生成缩略图: ${subDir}/${fname}`);
      return thumbPath;
    };

    // ⓪ 只认 YGOPro —— `only=ygopro` 时跳过下面全部 OCG 分支，直接拿卡密取保底图。
    // 「卡牌唯一目录」页（card-unique.vue）的人工校对专用：一行的身份就是卡密，
    // 要看的只是"这个卡密在图源里长什么样"，掺进 OCG 详细图反而校不准。
    if (req.query.only === 'ygopro') {
      const ygoproPath = path.join(IMG_YGOPRO, extCode + '.jpg');
      if (fs.existsSync(ygoproPath)) return sendThumb(await generateThumb(ygoproPath, 'YGOPro'));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: `YGOPro 图源里没有 ${extCode}.jpg` });
    }

    // ① 精准模式 —— 与 card-image 同一契约：code + rarity 同时给 → 只认整段命中，落空 404。
    if (code && rarity) {
      const card = await CardCatalog.findOne({ code }).lean();
      const p = card ? findOcgExact(IMG_OCG, card.packCode, card.code, rarity, altIndex) : null;
      if (p) {
        const tp = await generateThumb(p, 'OCG');
        return sendThumb(tp);
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: `图源里没有 ${code} 的 ${rarity}${altIndex > 0 ? '-' + altIndex : ''}` });
    }

    // ② 兜底模式 —— 原有降级链
    // P0: 日文OCG — code → 包目录实扫 (缩略图存 OCG 子文件夹)
    if (code) {
      const card = await CardCatalog.findOne({ code }).lean();
      const ocg = listOcgFiles(card, IMG_OCG);
      if (ocg) {
        const best = pickBest(ocg.files, rarity, altIndex);
        const p = best ? path.join(IMG_OCG, ocg.dir, best) : null;
        if (p && fs.existsSync(p)) {
          const tp = await generateThumb(p, 'OCG');
          return sendThumb(tp);
        }
      }
    }

    // P1: 日文OCG — 卡密反查 MongoDB 定位包目录
    const extCards = await CardCatalog.find({ extCode }).lean();
    for (const c of extCards) {
      const ocg = listOcgFiles(c, IMG_OCG);
      if (!ocg) continue;
      const best = pickBest(ocg.files, rarity, altIndex);
      const p = best ? path.join(IMG_OCG, ocg.dir, best) : null;
      if (p && fs.existsSync(p)) {
        const tp = await generateThumb(p, 'OCG');
        return sendThumb(tp);
      }
    }

    // P1b: 历史兜底映射表
    const ocgEntries = tcgOcgMap.get()[extCode];
    if (ocgEntries && ocgEntries.length) {
      const byDir = {};
      for (const e of ocgEntries) (byDir[e.dir] = byDir[e.dir] || []).push(e.file);
      for (const dir of Object.keys(byDir)) {
        const best = pickBest(byDir[dir], rarity, altIndex);
        const p = best ? path.join(IMG_OCG, dir, best) : null;
        if (p && fs.existsSync(p)) {
          const tp = await generateThumb(p, 'OCG');
          return sendThumb(tp);
        }
      }
    }

    // P2: YGOPro图片源/{password}.jpg (缩略图存 YGOPro 子文件夹)
    const ygoproPath = path.join(IMG_YGOPRO, extCode + '.jpg');
    if (fs.existsSync(ygoproPath)) {
      const tp = await generateThumb(ygoproPath, 'YGOPro');
      return sendThumb(tp);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: '原图不存在，无法生成缩略图' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 图源预览 ====================
router.get('/list-images', (req, res) => {
  try {
    const { ocgDir: IMG_OCG, ygoproDir: IMG_YGOPRO } = tcgPaths.get();
    const { source, page, per_page, search } = req.query;
    const pg = parseInt(page) || 1;
    const pp = Math.min(parseInt(per_page) || 60, 200);

    let imgDir;
    if (source === '日文OCG卡图') imgDir = IMG_OCG;
    else if (source === 'YGOPro图片源') imgDir = IMG_YGOPRO;
    else return res.status(400).json({ error: '未知图片来源: ' + source });

    if (!fs.existsSync(imgDir)) {
      return res.json({ source, path: imgDir, total: 0, page: pg, perPage: pp, totalPages: 0, images: [] });
    }

    let allImages = [];
    const imgExts = ['.jpg', '.jpeg', '.png', '.webp'];

    const walkDir = (dir, prefix = '') => {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const relPath = prefix ? prefix + '/' + entry : entry;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory() && !entry.startsWith('_')) {
            walkDir(fullPath, relPath);
          } else if (stat.isFile() && imgExts.some(ext => entry.toLowerCase().endsWith(ext))) {
            allImages.push(relPath);
          }
        } catch (_) {}
      }
    };

    walkDir(imgDir);

    if (search) {
      const kw = search.toLowerCase();
      allImages = allImages.filter(img => img.toLowerCase().includes(kw));
    }

    const total = allImages.length;
    const totalPages = Math.ceil(total / pp) || 1;
    const images = allImages.slice((pg - 1) * pp, pg * pp);

    res.json({ source, path: imgDir, total, page: pg, perPage: pp, totalPages, images });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 卡图文件服务 ====================
router.get('/images/:source/:filename', (req, res) => {
  try {
    const { ocgDir: IMG_OCG, ygoproDir: IMG_YGOPRO } = tcgPaths.get();
    const { source, filename } = req.params;
    if (filename.includes('..') || source.includes('..')) {
      return res.status(403).json({ error: '非法路径' });
    }

    let filepath;
    if (source === 'ygopro') filepath = path.join(IMG_YGOPRO, filename);
    else if (source === 'ocg') filepath = path.join(IMG_OCG, filename);
    else return res.status(400).json({ error: '未知图片来源' });

    if (!fs.existsSync(filepath)) return res.status(404).json({ error: '图片不存在' });
    res.sendFile(filepath);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 卡包图源目录（批次 3） ====================
// 「卡牌目录」页要能就地看清一个包的图源文件夹：有哪些图、这张卡对应哪几个文件、
// 直接在电脑上打开这个文件夹。**这是全项目第一处写图源文件名的接口**，所以：
//   · 包名一律过 resolvePackDir()（正则 + 落在 ocgDir 内的二次校验）
//   · 文件名一律过 PACK_FILE_RE，且拼完再验一次落在包目录内
//   · 删图走软删除（先复制到 Server\Storage\deleted-files\ 再删），用户能捞回来
//   · 改完名一律 invalidateTcgCaches()，否则 30s 内列表还是旧的

// 图源文件名白名单。禁掉的是路径分隔符和 Windows 保留字符，不是限制命名风格 ——
// 真实文件名里有 `BETB(+1)-001-R.jpg` 这种带括号的，卡太死会误伤。
const PACK_FILE_RE = /^[^\\/:*?"<>|\x00-\x1f]{1,120}\.(jpg|jpeg|png|webp)$/i;

/**
 * 把「包目录 + 文件名」解析成绝对路径，并确认结果真的在那个包目录里。
 * 返回 null 表示非法。**每个用到文件名的地方都必须过它**，不要直接 path.join。
 */
function resolvePackFile(dir, name) {
  if (!PACK_FILE_RE.test(name || '')) return null;
  if (name.startsWith('_')) return null;      // `_` 开头是约定的忽略前缀
  const full = path.join(dir, name);
  const norm = (p) => path.resolve(p).toLowerCase();
  if (path.dirname(norm(full)) !== norm(dir)) return null;
  return full;
}

/** 列出包目录里的图片。exists=false 时 files 是空数组，前端据此提示「这个包在图源里还没有目录」。 */
router.get('/pack-files/:packCode', authAdmin, (req, res) => {
  try {
    const packCode = req.params.packCode;
    const dir = resolvePackDir(packCode);
    if (!dir) return res.status(400).json({ error: '包名不合法' });
    if (!fs.existsSync(dir)) {
      return res.json({ ok: true, packCode, dir, exists: false, count: 0, files: [], ignored: [] });
    }
    const entry = readDirIndex(dir);
    if (!entry) return res.status(500).json({ error: '读取目录失败' });

    const files = [];
    const ignored = [];
    for (const name of entry.files) {
      if (!IMG_EXT_RE.test(name)) continue;          // 非图片（_manifest.json 等）
      const full = path.join(dir, name);
      let st = null;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (!st.isFile()) continue;
      if (name.startsWith('_')) { ignored.push({ name, reason: '下划线开头，约定忽略' }); continue; }
      files.push({
        name,
        stem: name.replace(IMG_EXT_RE, ''),
        size: st.size,
        mtime: st.mtime.toISOString(),
        // 缩略图地址在这里拼好：GET /images/:source/:filename 只吃**一个**路径段，
        // 所以包名和文件名要先合并再整体 encodeURIComponent。让前端拼的话很容易踩这个坑。
        url: `/api/tcg/images/ocg/${encodeURIComponent(packCode + '/' + name)}`,
      });
    }
    files.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    res.json({ ok: true, packCode, dir, exists: true, count: files.length, files, ignored });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 包目录的绝对路径（前端展示 / 复制用） */
router.get('/pack-files/:packCode/path', authAdmin, (req, res) => {
  try {
    const dir = resolvePackDir(req.params.packCode);
    if (!dir) return res.status(400).json({ error: '包名不合法' });
    res.json({ ok: true, packCode: req.params.packCode, path: dir, exists: fs.existsSync(dir) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 在服务器本机的资源管理器里打开这个包目录（照 admin/backup.js:123 的写法）
 *
 *  body.file 可选。给了、而且这个文件**真在图源目录里**，就选中它而不是只开文件夹 ——
 *  前端「卡牌详情」那个「打开」按钮要的就是「有这张卡就精准到这张卡，没有就退到整个包」。
 *  响应里 `selected` 回带实际选中的文件名（没选中就是 null），前端拿它措辞。
 */
router.post('/pack-files/:packCode/open', authAdmin, (req, res) => {
  try {
    const dir = resolvePackDir(req.params.packCode);
    if (!dir) return res.status(400).json({ error: '包名不合法' });
    if (!fs.existsSync(dir)) return res.status(404).json({ error: '这个包在图源里没有目录' });

    // 只认「纯文件名」：带任何分隔符的一律不认，别让 body 里的东西把 explorer 指到目录外面去
    const 想要 = String((req.body && req.body.file) || '').trim();
    const 选中 = (想要 && 想要 === path.basename(想要) && fs.existsSync(path.join(dir, 想要))) ? 想要 : '';

    try {
      if (选中) {
        // `/select,<完整路径>` 这条**直接起 explorer.exe，不经过 shell**。
        // 塞进 `powershell -Command "..."` 里要连穿 cmd 和 PowerShell 两层引号转义，
        // 路径一带空格就散架；execFile 没有 shell，空格和引号全由 Node 自己转义。
        // explorer 即便成功也返回退出码 1，所以**不看退出码**（照 /backups/:name/open 的先例）。
        execFile('explorer.exe', ['/select,' + path.join(dir, 选中)], { timeout: 8000, windowsHide: true }, () => {});
      } else {
        // 没有指定文件就维持原样：用 PowerShell 打开整个目录（在正常桌面会话下可靠弹出）。
        execSync(`powershell -NoProfile -Command "Start-Process explorer -ArgumentList '${dir.replace(/'/g, "''")}'"`,
          { timeout: 8000, windowsHide: true });
      }
      res.json({ ok: true, path: dir, selected: 选中 || null });
    } catch (e) {
      res.status(500).json({ error: '打开失败（服务器可能不是本机，或不是桌面会话）' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 改一个图源文件的名字。前端「卡牌目录」里手动订正文件名用。 */
router.post('/pack-files/:packCode/rename', authAdmin, (req, res) => {
  try {
    const packCode = req.params.packCode;
    const dir = resolvePackDir(packCode);
    if (!dir) return res.status(400).json({ error: '包名不合法' });
    const { from, to } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: '缺少 from / to' });
    if (from === to) return res.status(400).json({ error: '新旧文件名相同' });

    const src = resolvePackFile(dir, from);
    const dst = resolvePackFile(dir, to);
    if (!src || !dst) return res.status(400).json({ error: '文件名不合法' });
    if (!fs.existsSync(src)) return res.status(404).json({ error: '原文件不存在：' + from });
    if (fs.existsSync(dst)) return res.status(409).json({ error: '目标文件名已存在：' + to });

    // 用临时名中转：Windows 不区分大小写，`ABC.jpg → abc.jpg` 直接改会被判成
    // 「目标已存在」；中转一次就绕开了，行为也和 Linux 一致。
    const tmp = path.join(dir, `.zz-rename-${Date.now()}-${Math.floor(Math.random() * 1e6)}.tmp`);
    try {
      fs.renameSync(src, tmp);
      fs.renameSync(tmp, dst);
    } catch (e) {
      try { if (fs.existsSync(tmp)) fs.renameSync(tmp, src); } catch (_) {}
      return res.status(500).json({ error: '改名失败：' + e.message });
    }
    invalidateTcgCaches(packCode);
    res.json({ ok: true, from, to });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 删一张图。软删除：先复制到 Server\Storage\deleted-files\{日期}\，成功了再删原文件。 */
router.delete('/pack-files/:packCode/:name', authAdmin, (req, res) => {
  try {
    const packCode = req.params.packCode;
    const dir = resolvePackDir(packCode);
    if (!dir) return res.status(400).json({ error: '包名不合法' });
    const name = req.params.name;
    const full = resolvePackFile(dir, name);
    if (!full) return res.status(400).json({ error: '文件名不合法' });
    if (!fs.existsSync(full)) return res.status(404).json({ error: '文件不存在：' + name });

    const day = new Date().toISOString().split('T')[0];
    const backupDir = path.join(__dirname, '..', '..', '..', 'Storage', 'deleted-files', day);
    fs.mkdirSync(backupDir, { recursive: true });
    // 同名文件当天删两次的话加个后缀，别互相覆盖
    let backupPath = path.join(backupDir, `${packCode}__${name}`);
    for (let i = 1; fs.existsSync(backupPath) && i < 100; i++) {
      backupPath = path.join(backupDir, `${packCode}__${i}__${name}`);
    }
    fs.copyFileSync(full, backupPath);
    fs.unlinkSync(full);
    invalidateTcgCaches(packCode);
    res.json({ ok: true, name, backup: backupPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 改卡牌编号（批次 4） ====================
// 「卡牌目录」里把一条目录的编号改掉。这是**爆炸半径最大**的一个操作：一个编号同时
// 出现在四个地方，必须一起改：
//   ① 图源文件名   images\OCG\{包名}\{编号}-{罕贵}[-{异画号}].ext
//   ② cardcatalogs  目录行本身
//   ③ {包名}.json   同在 id-data 下的那份 JSON（不改的话导出/重建会把它带回去）
//   ④ cards         库存里拍到过这个编号的卡
// 外加 cardmarks：「这个编号有问题，待处理」的登记 —— 编号修好了，这条登记就该消失，
// 那批卡自己会从淡红变回白。
//
// 顺序刻意是**磁盘先、数据库后**：磁盘改名是这里唯一不可逆的动作（数据库随手能改回来），
// 所以先把它做完并在失败时整体回退，再动数据库。MongoDB 是单机、**没有多文档事务**，
// 全靠这个顺序 + 逐级补偿兜住。
const CARD_CODE_RE = /^[A-Za-z0-9()+]{1,24}-[A-Za-z0-9()+]{1,24}(-[A-Za-z0-9()+]{1,24})?$/;

/** 盘点一个编号在磁盘上涉及哪些文件。不写任何东西。 */
function planCodeFiles(dir, oldCode, newCode) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return out; }
  for (const name of names) {
    if (!IMG_EXT_RE.test(name)) continue;
    if (!name.startsWith(oldCode + '-')) continue;
    out.push({ from: name, to: newCode + name.slice(oldCode.length) });
  }
  out.sort((a, b) => a.from.localeCompare(b.from, 'en', { numeric: true }));
  return out;
}

/**
 * 把 {dataDir}/{packCode}.json 里那一条卡的编号换掉。
 * 整份 JSON 是「导出目录」的数据源之一，漏改会让导出/重建把旧编号带回来。
 * 返回 true 表示真的改了一条。
 */
// ⚠️ 磁盘包 JSON 里是**一个编号一条**（罕贵度用「、」串着，见 writePackJson 的注释），
// 所以这里按编号匹配就行，不看 altArtIndex —— 库里那个编号的每一行都要跟着改，
// 按序号匹配只会改到其中一条，剩下的还挂在旧编号上（同一张卡被劈成两半）。
// 保留第四个形参只为不动两个调用点的签名。
function renameCodeInPackJson(packCode, oldCode, newCode) {
  const fp = path.join(tcgPaths.get().dataDir, `${packCode}.json`);
  if (!fs.existsSync(fp)) return false;
  let data;
  try { data = JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (_) { return false; }
  if (!Array.isArray(data.cards)) return false;
  let hit = false;
  for (const c of data.cards) {
    if ((c.code || '').trim().toUpperCase() === oldCode) { c.code = newCode; hit = true; }
  }
  if (hit) fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
  return hit;
}

/**
 * 改卡牌编号。dryRun:true 只盘点不落盘，供前端弹二次确认。
 * body: { oldCode, newCode, packCode, altArtIndex? }
 */
router.post('/rename-code', authAdmin, async (req, res) => {
  const { oldCode: rawOld, newCode: rawNew, packCode: rawPack } = req.body || {};
  const oldCode = String(rawOld || '').trim().toUpperCase();
  const newCode = String(rawNew || '').trim().toUpperCase();
  const packCode = String(rawPack || '').trim().toUpperCase();
  const altArtIndex = parseInt(req.body && req.body.altArtIndex) || 0;
  const dryRun = !!(req.body && req.body.dryRun);

  try {
    // ---------- 前置校验：任一不过就直接拒，一个字节都不动 ----------
    if (!oldCode || !newCode) return res.status(400).json({ error: '缺少 oldCode / newCode' });
    if (oldCode === newCode) return res.status(400).json({ error: '新旧编号相同' });
    if (!CARD_CODE_RE.test(newCode)) {
      return res.status(400).json({ error: '新编号形状不合法：' + newCode + '（应为「前缀-数字」）' });
    }
    const dir = resolvePackDir(packCode);
    if (!dir) return res.status(400).json({ error: '包名不合法：' + rawPack });
    if (!fs.existsSync(dir)) return res.status(404).json({ error: '这个包在图源里没有目录：' + packCode });

    // ⚠️ 认的是**编号**，不是「编号 + 后缀序号」那一行 —— 一个编号下的每一行（UR / SER / …）
    // 都是同一张卡的不同罕贵度，改编号必须整组一起挪。只挪一行的话，剩下的行还挂在旧编号上，
    // 图源文件名和目录当场就对不上了。
    const oldRow = await CardCatalog.findOne({ code: oldCode }).lean();
    if (!oldRow) return res.status(404).json({ error: '目录里没有这个编号：' + oldCode });
    const 目录行数 = await CardCatalog.countDocuments({ code: oldCode });

    // 撞已存在的编号：语义不明（用户到底想改名还是想合并？），而且会撞 {code, rarity, altArtIndex} 唯一索引
    const clash = await CardCatalog.findOne({ code: newCode }).select('_id').lean();
    if (clash) {
      return res.status(409).json({ error: '新编号在目录里已经存在（' + newCode + '），请先处理冲突' });
    }

    const files = planCodeFiles(dir, oldCode, newCode);
    const cardsCount = await Card.countDocuments({ code: oldCode });
    // 一个编号现在可能有多条登记（N 一条、NPR 一条），所以是 find 不是 findOne ——
    // 改名要把它们**整组**一起带走，留一条下来就变成孤儿记录了。
    const markDocs = await CardMark.find({ code: oldCode }).lean();
    const packJsonHasIt = (() => {
      try {
        const fp = path.join(tcgPaths.get().dataDir, `${packCode}.json`);
        if (!fs.existsSync(fp)) return false;
        const d = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        return Array.isArray(d.cards) && d.cards.some(c =>
          (c.code || '').trim().toUpperCase() === oldCode);
      } catch (_) { return false; }
    })();

    const plan = {
      oldCode, newCode, packCode, dir,
      files, filesCount: files.length,
      catalogCount: 目录行数,
      packJsonHasIt,
      cardsCount,
      markCount: markDocs.length,
      // 图源里没有这个编号的文件是允许的（只改数据库和库存卡），但必须让用户知道
      warnings: files.length === 0 ? ['图源目录里没有 ' + oldCode + '-* 的文件，只会改数据库和库存卡'] : [],
    };
    if (dryRun) return res.json({ ok: true, dryRun: true, plan });

    // ---------- 第 0 步：审计 + 文件快照（不可跳过） ----------
    const stamp = makeStamp();
    const auditDir = path.join(__dirname, '..', '..', '..', 'Storage', 'rename-audit');
    const backupDir = path.join(__dirname, '..', '..', '..', 'Storage', 'rename-backup', stamp);
    fs.mkdirSync(auditDir, { recursive: true });
    if (files.length) {
      fs.mkdirSync(backupDir, { recursive: true });
      for (const f of files) {
        try { fs.copyFileSync(path.join(dir, f.from), path.join(backupDir, f.from)); }
        catch (e) { return res.status(500).json({ error: '备份原文件失败，已中止（什么都没改）：' + f.from + ' ' + e.message }); }
      }
    }
    const audit = {
      at: new Date().toISOString(), by: req.user && req.user.id,
      oldCode, newCode, packCode, altArtIndex,
      files, catalogDoc: oldRow, markDocs,
      cardsCount, packJsonHasIt, backupDir: files.length ? backupDir : null,
      steps: [],
    };
    const auditId = `${stamp}-${oldCode}-${newCode}`.replace(/[^A-Za-z0-9._-]/g, '_');
    const auditPath = path.join(auditDir, auditId + '.json');
    const saveAudit = () => fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');
    saveAudit();

    // ---------- 第 1 步：磁盘改名（逐文件，记 map） ----------
    const doneFiles = [];
    try {
      for (const f of files) {
        fs.renameSync(path.join(dir, f.from), path.join(dir, f.to));
        doneFiles.push(f);
      }
    } catch (e) {
      for (const f of doneFiles.reverse()) {
        try { fs.renameSync(path.join(dir, f.to), path.join(dir, f.from)); } catch (_) {}
      }
      audit.steps.push({ step: 'disk', ok: false, error: e.message, rolledBack: true });
      saveAudit();
      return res.status(500).json({ error: '改文件名失败，已全部改回：' + e.message, auditId });
    }
    audit.steps.push({ step: 'disk', ok: true, renamed: doneFiles.length });
    saveAudit();

    // ---------- 第 2 步：cardcatalogs + {包名}.json ----------
    let jsonChanged = false;
    try {
      await CardCatalog.updateMany({ code: oldCode }, { $set: { code: newCode } });
      jsonChanged = renameCodeInPackJson(packCode, oldCode, newCode);
    } catch (e) {
      for (const f of [...doneFiles].reverse()) {
        try { fs.renameSync(path.join(dir, f.to), path.join(dir, f.from)); } catch (_) {}
      }
      audit.steps.push({ step: 'catalog', ok: false, error: e.message, rolledBack: true });
      saveAudit();
      return res.status(500).json({ error: '改目录失败，文件已改回：' + e.message, auditId });
    }
    audit.steps.push({ step: 'catalog', ok: true, packJsonChanged: jsonChanged });
    saveAudit();

    // ---------- 第 3 步：cards（库存里拍到过这个编号的卡） ----------
    // 只改 code 一个字段：cards.img 全表是空串，origImg 是上传时存的压缩原图路径，
    // 跟图源目录无关。以后若引入带编号的 URL 快照，这里要跟着一起改。
    let cardsUpdated = 0;
    try {
      const r = await Card.updateMany({ code: oldCode }, { $set: { code: newCode } });
      cardsUpdated = r.modifiedCount || 0;
    } catch (e) {
      // 磁盘和目录都成功了，这里失败 —— 逆序把前两步也退回去，别留个半拉子
      try { await CardCatalog.updateMany({ code: newCode }, { $set: { code: oldCode } }); } catch (_) {}
      if (jsonChanged) { try { renameCodeInPackJson(packCode, newCode, oldCode); } catch (_) {} }
      for (const f of [...doneFiles].reverse()) {
        try { fs.renameSync(path.join(dir, f.to), path.join(dir, f.from)); } catch (_) {}
      }
      audit.steps.push({ step: 'cards', ok: false, error: e.message, rolledBack: true });
      saveAudit();
      return res.status(500).json({ error: '改库存卡失败，前面几处已改回：' + e.message, auditId });
    }
    audit.steps.push({ step: 'cards', ok: true, cardsUpdated });
    saveAudit();

    // ---------- 第 4 步：cardmarks ----------
    // 编号修好了 ⇒「这个编号有问题」的登记就该消失，那张卡自己会从红变回白。
    // 原文已经在上面的 audit 里，要人工恢复也有据可查。此步失败不回滚前面 ——
    // 那几处已经一致了，为几条备注把整体退回去反而更糟。
    // ⚠️ 必须 deleteMany：一个编号可能有多条登记（N 一条、NPR 一条），
    //    用 deleteOne 只会删掉其中一条，剩下的还挂在旧编号上、永远没人再看到。
    let markDeleted = 0;
    const warnings = [...plan.warnings];
    if (markDocs.length) {
      try {
        const r = await CardMark.deleteMany({ code: oldCode });
        markDeleted = r.deletedCount || 0;
        audit.steps.push({ step: 'mark', ok: true, deleted: markDeleted });
      } catch (e) {
        audit.steps.push({ step: 'mark', ok: false, error: e.message });
        warnings.push('信息登记记录没删掉（' + e.message + '），请到后台手工处理：' + oldCode);
      }
      saveAudit();
    }

    invalidateTcgCaches(packCode);
    cardReview.bumpReviewVersion();   // 上面动过 cardcatalogs，核对页的数字要跟着重算
    res.json({
      ok: true, auditId, auditPath,
      renamed: doneFiles.length, catalogUpdated: 目录行数, packJsonChanged: jsonChanged,
      cardsUpdated, markDeleted, warnings,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 删除卡包 ====================
/**
 * 删掉一个卡包：图源（图片目录 + 包 JSON + `_index.json` 条目）+ 数据库里的目录行。
 * dryRun:true 只盘点不落盘，供前端弹二次确认。body: { code, dryRun? }
 *
 * 三条用户定死的口径（别改）：
 *   · 包里有**实物卡**（`cards` 里还挂着这个包的卡）→ **直接拒**，让用户先去清库存。
 *   · 图片**只搬不删** —— 整个目录 rename 进 `{ocgDir}/_deleted-packs/{stamp}/{code}`。
 *     同盘 rename 不跨卷；而 `_` 开头的目录会被 /uncataloged-packs 过滤掉
 *     （见那个 `.filter(d => !d.name.startsWith('_'))`），用户不会在「未收录包」里
 *     又看见自己刚删的包。
 *   · `cardmarks` **一条都不删** —— 人工攒的，删了不可逆。删完这些登记会落进一级页
 *     「有 N 条登记不属于任何卡包」的提示里，正是期望的可发现路径。
 *
 * 盘点**每个请求都重做一遍**（dryRun 只决定要不要提前返回），所以真跑那次的禁止条件是
 * 现算的 —— 干跑到真跑之间库存变了也拦得住。
 */
router.post('/delete-pack', authAdmin, async (req, res) => {
  const packCode = String((req.body && req.body.code) || '').trim().toUpperCase();
  const dryRun = !!(req.body && req.body.dryRun);

  try {
    if (!packCode) return res.status(400).json({ error: '缺少 code' });
    const dir = resolvePackDir(packCode);
    if (!dir) return res.status(400).json({ error: '包名不合法：' + (req.body && req.body.code) });

    // ---------- 盘点 ----------
    // ⚠️ 删除范围按 `packCode`（照抄 cardcatalogs 里存的），**但禁止条件必须同时看编号前缀**。
    // 这两个不是一回事：`BETB(+1)` 是 packCode 而它下面编号的前缀是 `BETB`；
    // `packCode:"2006"` 的编号前缀却是 `WC6`。只看 packCode 会漏掉别处的同前缀实物卡。
    // （实测 cardcatalogs.packCode 与 cards.code 全是大写，所以精确匹配是安全的。）
    const ownedCodes = (await CardCatalog.distinct('code', { packCode }))
      .map(c => String(c || '').trim().toUpperCase()).filter(Boolean);

    const prefixes = new Set(ownedCodes.map(c => c.split('-')[0]).filter(Boolean));
    prefixes.add(packCode);        // 空包兜底：目录行也是空的时，至少拿包名当前缀

    const 挡条件 = [];
    if (ownedCodes.length) 挡条件.push({ code: { $in: ownedCodes } });
    // `BETB(+1)` 里的括号是真元字符，必须 escRe 之后再进正则
    挡条件.push({ code: { $regex: '^(' + [...prefixes].map(escRe).join('|') + ')-' } });
    const 挡 = { $or: 挡条件 };

    const 目录行数 = await CardCatalog.countDocuments({ packCode });
    const 实物卡数 = await Card.countDocuments(挡);
    // 登记表上没有 packCode（只有 code），所以用同一套并集去数
    const 登记条数 = await CardMark.countDocuments(挡);

    const indexEntry = (loadIndex().packs || []).find(p => p.code === packCode) || null;
    const packJsonPath = path.join(tcgPaths.get().dataDir, `${packCode}.json`);
    const hasDir = fs.existsSync(dir);
    let 图片文件数 = 0;
    if (hasDir) {
      try { 图片文件数 = (cachedReaddir(dir) || []).filter(f => IMG_EXT_RE.test(f)).length; } catch (_) {}
    }
    const 被拦编号 = 实物卡数 ? (await Card.distinct('code', 挡)).slice(0, 10) : [];

    const plan = {
      code: packCode,
      有图源目录: hasDir,
      有索引条目: !!indexEntry,
      有包JSON: fs.existsSync(packJsonPath),
      目录行数, 实物卡数, 登记条数, 图片文件数, 被拦编号,
      禁止原因: 实物卡数
        ? `这个包还有 ${实物卡数} 张实物卡在库存里（例如 ${被拦编号.join('、')}）。`
          + '先把它们从库存里清掉（或改掉编号），再回来删包。'
        : '',
    };
    if (dryRun) return res.json({ ok: true, dryRun: true, plan });

    // ---------- 第 0 步：最后一道闸 ----------
    // 上面的盘点是本次请求现算的，不过就一个字节都不动。
    if (实物卡数) {
      return res.status(409).json({ error: plan.禁止原因, 实物卡数, 被拦编号 });
    }

    // ---------- 第 1 步：审计 + 备份目录 ----------
    const stamp = makeStamp();
    const auditDir = path.join(__dirname, '..', '..', '..', 'Storage', 'delete-pack-audit');
    const backupDir = path.join(__dirname, '..', '..', '..', 'Storage', 'delete-pack-backup', stamp);
    fs.mkdirSync(auditDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });

    // ---------- 第 2 步：快照（写不成 → 中止，什么都没改）----------
    const 快照行 = await CardCatalog.find({ packCode }).lean();
    const indexPath = path.join(tcgPaths.get().dataDir, '_index.json');
    const audit = {
      at: new Date().toISOString(), by: req.user && req.user.id,
      packCode, plan, backupDir,
      catalogRows: 快照行,
      indexEntry,
      图片去向: null,
      steps: [],
    };
    const auditId = `${stamp}-${packCode}`.replace(/[^A-Za-z0-9._-]/g, '_');
    const auditPath = path.join(auditDir, auditId + '.json');
    const saveAudit = () => fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');
    try {
      if (fs.existsSync(indexPath)) fs.copyFileSync(indexPath, path.join(backupDir, '_index.json'));
      if (fs.existsSync(packJsonPath)) fs.copyFileSync(packJsonPath, path.join(backupDir, `${packCode}.json`));
      fs.writeFileSync(path.join(backupDir, 'cardcatalogs.json'), JSON.stringify(快照行, null, 2), 'utf-8');
      saveAudit();
    } catch (e) {
      return res.status(500).json({ error: '备份失败，已中止（什么都没改）：' + e.message });
    }

    const warnings = [];

    // ---------- 第 3 步：删数据库目录行 ----------
    // 此步之后每一步失败都**不回滚前面的** —— 跟 rename-code 一个道理：已经删掉的行
    // 有备份可查，为后面某一步把整包数据再造回来反而更糟。失败都记进 warnings。
    let deletedRows = 0;
    try {
      const r = await CardCatalog.deleteMany({ packCode });
      deletedRows = r.deletedCount || 0;
      audit.steps.push({ step: 'catalogs', ok: true, deleted: deletedRows });
    } catch (e) {
      audit.steps.push({ step: 'catalogs', ok: false, error: e.message });
      saveAudit();
      return res.status(500).json({ error: '删目录行失败：' + e.message, auditId });
    }
    saveAudit();

    // ---------- 第 4 步：摘掉 _index.json 里的条目 ----------
    let indexRemoved = false;
    try {
      indexRemoved = !!removeIndexEntry(packCode);
      audit.steps.push({ step: 'index', ok: true, removed: indexRemoved });
    } catch (e) {
      audit.steps.push({ step: 'index', ok: false, error: e.message });
      warnings.push('_index.json 没改成功（' + e.message + '），条目还在，请按审计手工删：' + auditId);
    }
    saveAudit();

    // ---------- 第 5 步：删包 JSON（副本已在第 2 步）----------
    let packJsonRemoved = false;
    try {
      if (fs.existsSync(packJsonPath)) { fs.unlinkSync(packJsonPath); packJsonRemoved = true; }
      audit.steps.push({ step: 'packJson', ok: true, removed: packJsonRemoved });
    } catch (e) {
      audit.steps.push({ step: 'packJson', ok: false, error: e.message });
      warnings.push('包 JSON 没删掉（' + e.message + '）：' + `${packCode}.json`);
    }
    saveAudit();

    // ---------- 第 6 步：图片目录挪进回收目录（放最后，最贵最不可逆）----------
    let imagesMoved = false;
    if (hasDir) {
      const 回收处 = path.join(tcgPaths.get().ocgDir, '_deleted-packs', stamp, packCode);
      try {
        fs.mkdirSync(path.dirname(回收处), { recursive: true });
        fs.renameSync(dir, 回收处);
        imagesMoved = true;
        audit.图片去向 = 回收处;
        audit.steps.push({ step: 'images', ok: true, movedTo: 回收处, files: 图片文件数 });
      } catch (e) {
        audit.steps.push({ step: 'images', ok: false, error: e.message });
        warnings.push('图片目录没搬走（' + e.message + '），原目录还在：' + dir);
      }
    } else {
      audit.steps.push({ step: 'images', ok: true, skipped: '图源里本来就没有这个目录' });
    }
    saveAudit();

    // ---------- 第 7 步：让读缓存作废 ----------
    invalidateTcgCaches(packCode);
    cardReview.bumpReviewVersion();   // 一整个包的目录行没了，核对页的数字必须重算

    saveAudit();
    res.json({
      ok: true, auditId, auditPath,
      deletedRows, indexRemoved, packJsonRemoved, imagesMoved,
      图片去向: audit.图片去向, 保留登记: 登记条数, warnings,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 统计 ====================
router.get('/stats', async (req, res) => {
  try {
    const index = loadIndex();
    const totalCards = await CardCatalog.countDocuments();
    const totalPacks = (index.packs || []).length;
    res.json({ ok: true, totalPacks, totalCards });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== 导入卡包 ====================
router.post('/import-pack', authAdmin, async (req, res) => {
  try {
    const data = req.body;

    // 验证基本格式
    if (!data.code || !data.cards || !Array.isArray(data.cards)) {
      return res.status(400).json({ ok: false, error: 'JSON格式错误：需要 code 和 cards 数组' });
    }

    const packCode = data.code.trim().toUpperCase();
    const cards = data.cards;
    let inserted = 0;
    let updated = 0;
    const errors = [];

    // 文件里带的名字收进来给唯一目录 —— 字段删掉之后，不接这一手名字就没了
    const 待收名 = [];

    for (const card of cards) {
      // 跳过 _ 开头的注释字段
      const cardCode = (card.code || '').trim();
      if (!cardCode) {
        // 检查是否全是注释字段
        if (Object.keys(card).every(k => k.startsWith('_'))) continue;
        errors.push('跳过：缺少卡牌编号');
        continue;
      }

      const extCode = String(card.ext_code || '').trim();

      // ⚠️ 这里**不再写** jpName / cnName / enName —— 卡名不归 cardcatalogs 管了。
      // 文件里的名字往下交给唯一目录（见循环后面的 卡名.收下）
      待收名.push({
        code: cardCode.toUpperCase(), extCode,
        jpName: (card.jp_name || '').trim(),
        cnName: (card.cn_name || '').trim(),
        enName: (card.en_name || '').trim(),
      });

      // 文件里一条可能拆成好几行：`"UR、SER、SER(1)"` → UR|0、SER|0、SER|1。
      // 后缀序号写在罕见度串里（`SER(1)`）或写在 `alt_art_index` 字段上，两种都认，
      // `(N)` 优先（见 services/catalogRarity.js 的 `展开`）。
      for (const 行 of 展开(card.rarity, card.alt_art_index)) {
        const doc = {
          code: cardCode.toUpperCase(),
          packCode,
          extCode,
          rarity: 行.rarity,
          hasAltArt: !!card.has_alt_art,
          altArtIndex: 行.altArtIndex,
          cnSource: (card.cn_source || '').trim(),
          versionId: 1,
        };
        if (typeof card.alt_label === 'string') doc.altLabel = card.alt_label.trim();

        // 唯一键：编号 + 罕贵度 + 后缀序号（同一个编号的几个罕贵度是三行）
        const result = await CardCatalog.updateOne(
          { code: doc.code, rarity: doc.rarity, altArtIndex: doc.altArtIndex },
          { $set: doc },
          { upsert: true }
        );

        if (result.upsertedCount > 0) inserted++;
        else if (result.modifiedCount > 0) updated++;
      }
    }

    // 文件里带的名字交给唯一目录（只补空位，不覆盖已有的 —— 所以重复导入是幂等的）
    let 补了名字 = 0;
    try {
      补了名字 = (await 卡名.收下(待收名)).补了;
    } catch (e) {
      console.error('名字收进唯一目录失败:', e.message);
    }

    // 同时保存 JSON 到 DATA_DIR（走统一收口，见 writePackJson）
    try {
      writePackJson(packCode, cards, {
        fullName: data.full_name || packCode,
        date: data.date || new Date().toISOString().split('T')[0],
        totalCards: cards.length,
        status: 'data_only',
        reason: '手动导入',
        imageCount: 0,
        extra: data,
      });
    } catch (e) {
      console.error('保存JSON文件失败:', e.message);
    }

    res.json({
      ok: true,
      packCode,
      total: cards.length,
      inserted,
      updated,
      补了名字,     // 文件里的名字补进唯一目录条数（只补空位；已有的不动，所以通常是 0）
      errors: errors.length > 0 ? errors : undefined
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== 目录数据包：导出 / 导入 ====================
// 「卡牌目录」(cardcatalogs) 和「信息登记」(cardmarks) 都是人工订正出来的数据，
// 同性质的还有 alt-labels.json。三者打成一个文件，方便换机器 / 备份 / 及时同步。
//
// 为什么不复用 POST /import-pack：
//   那个是**按包**的，面向「这个包的卡牌数据」；这里是**整库**的，面向「人的劳动成果」。
//   按包导入会漏掉没有包的卡、漏掉登记表，也没法表达 altLabels 这份独立文件。
//   （原来还有个配对的 GET /export-pack，V1.2.55 连同 GET /template 一起删了 ——
//   两个都是纯手工通道，前端一个入口都没有，而 export-pack 还**没有鉴权**。）

const BUNDLE_APP = 'S-LAN';
// 卡牌目录里要带出去的字段。**必须含 faceCode** —— 它是人工补的，丢了 DL1~DL5 那批就查不回来。
// **`altLabel` 也必须在**：异画标签以前住在 `alt-labels.json` 那份独立文件里、走顶层单带，
// V1.2.39 起改成行上的字段了（旧文件已删），不带就等于换机器丢标签。
// **卡名三列不在这里**：名字归唯一目录，见下面的 carduniques。以前带过，
// 换机器时靠它把中文名带回来；现在那份数据在唯一目录里，带这里也没人读了。
const BUNDLE_CATALOG_FIELDS = [
  'code', 'faceCode', 'packCode',
  'extCode', 'rarity', 'hasAltArt', 'altArtIndex', 'altLabel', 'cnSource', 'versionId',
];
const BUNDLE_MARK_FIELDS = ['code', 'rarity', 'libraryCode', 'jpName', 'cnName', 'img', 'note', 'markedBy', 'source', 'markedAt'];
// 唯一目录也必须进数据包 —— **不带它就会丢中文名**：
// 官方源只覆盖不到一半的简中，其余是本地补进去的，换台机器 / 重装之后官方源里
// 根本没有那几千个名字，少了这一份就补不回来（唯一目录 rebuild 只喂纯官方资料）。
const BUNDLE_UNIQUE_FIELDS = ['keyType', 'key', 'extCode', 'code', 'official'];

/** 只留白名单字段，其余（_id / createdAt / updatedAt / __v）一概不出去 */
function pickFields(doc, fields) {
  const out = {};
  for (const f of fields) if (doc[f] !== undefined && doc[f] !== null) out[f] = doc[f];
  return out;
}

// 数据包里的字段 → 库里的字段，以及各自的归一化。**顺序就是写库的顺序**，没有别的用途。
const CATALOG_CANON = {
  packCode: v => String(v || '').toUpperCase(),
  faceCode: v => String(v || '').toUpperCase(),
  extCode: v => String(v || ''),
  rarity: v => String(v || ''),
  hasAltArt: v => !!v,
  altLabel: v => String(v || ''),
  cnSource: v => String(v || ''),
  versionId: v => v || 1,
};
// 唯一目录那一档的归一化。**四个名字一个都不能少**，没有值也要给空串 ——
// 前端和导出都靠「字段一定存在」这个形状（见 models/CardUnique.js 顶上那段）。
const UNIQUE_CANON = {
  extCode: v => String(v || ''),
  code: v => String(v || ''),
  official: v => ({
    jp: String((v && v.jp) || ''),
    ruby: String((v && v.ruby) || ''),
    cn: String((v && v.cn) || ''),
    en: String((v && v.en) || ''),
  }),
};
const MARK_CANON = {
  // 归一化必须跟 models/CardMark.js 的 norm 一致（去空格 + 转大写）。
  // 老数据包（V1.2.46 以前导的）里没有这一列 → buildSet 的 onlyPresent 会整个跳过它，
  // 已入库的记录保持原值（迁移后是 ''），新插入的走 schema 默认值 '' —— 都是"不限罕贵度"。
  rarity: v => String(v || '').trim().toUpperCase(),
  libraryCode: v => String(v || ''),
  jpName: v => String(v || ''),
  cnName: v => String(v || ''),
  img: v => String(v || ''),
  note: v => String(v || ''),
  markedBy: v => String(v || ''),
  source: v => (v === 'auto' ? 'auto' : 'manual'),
  markedAt: v => (v ? new Date(v) : new Date()),
};

/**
 * 造 `$set` 的内容。
 *
 * `onlyPresent=true`（合并导入）时**文件里没有这一列就不写**，这是「导出 → 导入」
 * 能是一次空操作的关键：库里老记录缺 `source` / `faceCode` 这类后来才加的列，
 * 导出时自然不带，导入时如果拿默认值补全，就等于偷偷改写了用户的库
 * （踩过：94 条登记全被加上 source='manual'）。
 * 注意判据是「键在不在」，不是「值空不空」—— 用户特意清空的字段要能被导入覆盖。
 *
 * `onlyPresent=false`（覆盖导入）时补全默认值，因为那是新建文档，本来就该写全。
 */
function buildSet(canon, src, onlyPresent) {
  const set = {};
  for (const [field, norm] of Object.entries(canon)) {
    if (onlyPresent && !(field in src)) continue;
    set[field] = norm(src[field]);
  }
  return set;
}

/** 把整库读成一个数据包对象（导出和「覆盖导入」前的自动备份都用它） */
async function buildBundle() {
  const [catalogs, marks, uniques] = await Promise.all([
    CardCatalog.find({}).sort({ packCode: 1, code: 1, altArtIndex: 1 }).lean(),
    CardMark.find({}).sort({ code: 1 }).lean(),
    CardUnique.find({}).sort({ keyType: 1, key: 1 }).lean(),
  ]);
  return {
    _meta: {
      app: BUNDLE_APP,
      version: require('../../../package.json').version,
      exportedAt: new Date().toISOString(),
      counts: {
        cardcatalogs: catalogs.length,
        cardmarks: marks.length,
        carduniques: uniques.length,
        // 异画标签现在是行上的字段（以前是顶层那份 altLabels），这里报个非空条数
        altLabels: catalogs.filter(d => d.altLabel && d.altLabel.trim()).length,
      },
    },
    cardcatalogs: catalogs.map(d => pickFields(d, BUNDLE_CATALOG_FIELDS)),
    cardmarks: marks.map(d => pickFields(d, BUNDLE_MARK_FIELDS)),
    carduniques: uniques.map(d => pickFields(d, BUNDLE_UNIQUE_FIELDS)),
  };
}

/**
 * 数据包只认这三个键，少一个就当文件不对 —— 免得把随便一个 JSON 导进来清库。
 * `carduniques` **故意不在这里校验**：老数据包（V1.2.31 以前导的）没有这一档，
 * 导进来不该直接判它文件错。缺了就跳过，其余照导。
 */
function validateBundle(b) {
  if (!b || typeof b !== 'object') return '文件不是 JSON 对象';
  if (!Array.isArray(b.cardcatalogs)) return '缺少 cardcatalogs 数组（这份文件不是「目录数据包」？）';
  if (!Array.isArray(b.cardmarks)) return '缺少 cardmarks 数组（这份文件不是「目录数据包」？）';
  if (!b._meta || b._meta.app !== BUNDLE_APP) return '缺少 _meta.app，或不是 ' + BUNDLE_APP + ' 导出的文件';
  return null;
}

// GET /api/tcg/export-bundle — 导出整库（目录 + 登记 + 异画标签）到下载
router.get('/export-bundle', authAdmin, async (req, res) => {
  try {
    const bundle = await buildBundle();
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="slan-catalog-${day}.json"`);
    res.json(bundle);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * 取一个还没被占用的目录名。时间戳精确到秒，用户在弹窗上连点两次「覆盖导入」
 * 有可能落在同一秒里；直接用同一个路径的话，第二份备份会盖掉第一份 ——
 * 而这份备份恰好是导错之后唯一的退路。撞名就往后顺延，保证每一份都留着。
 */
function uniqueDir(base) {
  if (!fs.existsSync(base)) return base;
  for (let i = 2; i < 100; i++) {
    const p = `${base}-${i}`;
    if (!fs.existsSync(p)) return p;
  }
  return `${base}-${Date.now()}`;
}

/**
 * 算「这份文件导进去会怎么样」，不动任何数据。
 * preview 和真导入共用它，保证**弹窗里看到的数字就是真会发生的事**。
 */
async function planImport(b) {
  const err = validateBundle(b);
  if (err) return { error: err };

  // 库里现有索引：catalog 按 code|rarity|altArtIndex（三元组），mark 按 code|rarity（二元组）
  const curCat = await CardCatalog.find({}).select('code rarity altArtIndex faceCode').lean();
  const catKeys = new Set(curCat.map(d => `${d.code}|${d.rarity}|${d.altArtIndex || 0}`));
  const curMarks = await CardMark.find({}).select('code rarity note').lean();
  const markMap = new Map(curMarks.map(d => [`${d.code}|${d.rarity || ''}`, d]));

  let catNew = 0, catOverwrite = 0;
  const catDupes = [];
  const seen = new Set();
  let catRows = 0;
  for (const c of b.cardcatalogs) {
    const code = String(c.code || '').trim().toUpperCase();
    if (!code) continue;
    // 走 `展开` 而不是直接读字段：新数据包里一条就是一行，但**老数据包**
    // （V1.2.39 以前导的）里 `rarity` 还是「UR、SER、SER(1)」那种合并串，
    // 直接按整串当键会建出一条罕贵度叫「UR、SER、SER(1)」的怪行。
    for (const 行 of 展开(c.rarity, c.altArtIndex)) {
      catRows++;
      const key = `${code}|${行.rarity}|${行.altArtIndex}`;
      if (seen.has(key)) { catDupes.push(code); continue }   // 文件自己内部就重复
      seen.add(key);
      if (catKeys.has(key)) catOverwrite++; else catNew++;
    }
  }

  let markNew = 0, markOverwrite = 0, markNoteKept = 0;
  for (const m of b.cardmarks) {
    const code = String(m.code || '').trim().toUpperCase();
    if (!code) continue;
    // 键是 (编号, 罕贵度)，跟真导入那段的 filter 必须一模一样，否则弹窗里的
    // "会新增 N 条"跟实际插入数对不上。（老数据包没有 rarity 列 → 空串 → 通配那条）
    const rarity = String(m.rarity || '').trim().toUpperCase();
    const hit = markMap.get(`${code}|${rarity}`);
    if (!hit) { markNew++; continue }
    // 合并导入不覆盖已有备注：库里写了处理说明、文件里那条是空的，就得留住
    if (String(m.note || '').trim()) markOverwrite++; else markNoteKept++;
  }

  // 异画标签现在是行上的字段，不再有独立那份文件可对账。只报个「文件里带了多少条非空标签」
  const labelsFile = (b.cardcatalogs || []).filter(c => String(c.altLabel || '').trim()).length;

  return {
    meta: b._meta,
    cardcatalogs: {
      inFile: catRows, inDb: curCat.length,
      add: catNew, overwrite: catOverwrite, duplicateInFile: catDupes.length,
    },
    cardmarks: {
      inFile: b.cardmarks.length, inDb: curMarks.length,
      add: markNew, overwrite: markOverwrite, noteKept: markNoteKept,
    },
    altLabels: { inFile: labelsFile },
    // 覆盖导入会先备份，这里把路径先算给用户看。
    // ⚠️ 这只是**预告**：真导入时如果这一秒的目录已经被占（用户连点两次），
    // 会顺延成 `...-2`。所以弹窗里说"备份到 <父目录> 下的新目录"，
    // 真正那份路径以导入返回的 backupDir 为准，别拿 preview 的这个当事实。
    replaceBackupDir: path.join(__dirname, '..', '..', '..', 'Storage', 'pre-replace-backup', makeStamp()),
  };
}

// POST /api/tcg/import-bundle/preview — 只算不写，给前端二次确认弹窗看
router.post('/import-bundle/preview', authAdmin, async (req, res) => {
  try {
    const plan = await planImport(req.body);
    if (plan.error) return res.status(400).json({ ok: false, error: plan.error });
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/tcg/import-bundle?mode=merge|replace
router.post('/import-bundle', authAdmin, async (req, res) => {
  const started = Date.now();
  try {
    const mode = (req.query.mode || 'merge').toLowerCase();
    if (mode !== 'merge' && mode !== 'replace') {
      return res.status(400).json({ ok: false, error: 'mode 只能是 merge 或 replace' });
    }
    const b = req.body;
    const err = validateBundle(b);
    if (err) return res.status(400).json({ ok: false, error: err });

    const plan = await planImport(b);
    if (plan.error) return res.status(400).json({ ok: false, error: plan.error });

    let backupDir = null;
    // 覆盖导入是**整库清空重建**，必须先留一份现状，否则导错了没法退。
    // 目录名要现取（uniqueDir），不能直接用 plan 里那个预告值 —— 理由见 planImport 的注释。
    if (mode === 'replace') {
      backupDir = uniqueDir(plan.replaceBackupDir);
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, 'before-bundle.json'), JSON.stringify(await buildBundle(), null, 2), 'utf-8');
      console.log(`[TCG] 覆盖导入前的备份：${backupDir}`);
    }

    const onlyPresent = mode === 'merge';

    // ---------- cardcatalogs ----------
    let catIns = 0, catMod = 0, catSkipped = 0;
    if (mode === 'replace') {
      await CardCatalog.deleteMany({});
    }
    const catOps = [];
    const seenCat = new Set();
    for (const c of b.cardcatalogs) {
      const code = String(c.code || '').trim().toUpperCase();
      if (!code) { catSkipped++; continue }
      // 老数据包里 `rarity` 是「UR、SER、SER(1)」那种合并串，这里展开成行。
      // 新数据包里一条本来就一行，展开是个恒等操作。
      for (const 行 of 展开(c.rarity, c.altArtIndex)) {
        const rarity = 行.rarity;
        const altArtIndex = 行.altArtIndex;
        const key = `${code}|${rarity}|${altArtIndex}`;
        if (seenCat.has(key)) { catSkipped++; continue }
        seenCat.add(key);
        // code / rarity / altArtIndex 走 filter（upsert 时 MongoDB 会把 filter 里的等值条件
        // 带进新文档），三者在上面都定死成字符串/数字了，这里不能再信文件里的原值 —— 否则
        // 「字符串 '0'」和「数字 0」会各建一条，把唯一索引撑破。
        catOps.push({
          updateOne: {
            filter: { code, rarity, altArtIndex },
            update: { $set: { ...buildSet(CATALOG_CANON, c, onlyPresent), rarity } },
            upsert: true,
          },
        });
      }
    }
    for (let i = 0; i < catOps.length; i += 500) {
      const r = await CardCatalog.bulkWrite(catOps.slice(i, i + 500), { ordered: false });
      catIns += r.upsertedCount || 0;
      catMod += r.modifiedCount || 0;
    }

    // ---------- cardmarks ----------
    let markIns = 0, markMod = 0, markSkipped = 0;
    if (mode === 'replace') {
      await CardMark.deleteMany({});
    }
    const markOps = [];
    const seenMark = new Set();
    for (const m of b.cardmarks) {
      const code = String(m.code || '').trim().toUpperCase();
      if (!code) { markSkipped++; continue }
      const rarity = String(m.rarity || '').trim().toUpperCase();
      const key = `${code}|${rarity}`;
      if (seenMark.has(key)) { markSkipped++; continue }
      seenMark.add(key);
      const set = buildSet(MARK_CANON, m, onlyPresent);
      // 备注是人工写的处理说明，合并导入时**空值不覆盖**。
      // 导出总是带着 note（哪怕是空串），所以不加这道判断的话，拿一份早先的备份
      // 导进来就会把之后新写的说明全冲掉 —— 那是人的劳动，比其它字段都金贵。
      if (onlyPresent && !String(m.note || '').trim()) delete set.note;
      // filter 是 (编号, 罕贵度)，跟 planImport 里算 markNew 用的键必须一致 ——
      // 对不上就会出现"弹窗说新增 3 条、实际插了 4 条"这种。
      markOps.push({ updateOne: { filter: { code, rarity }, update: { $set: set }, upsert: true } });
    }
    for (let i = 0; i < markOps.length; i += 500) {
      const r = await CardMark.bulkWrite(markOps.slice(i, i + 500), { ordered: false });
      markIns += r.upsertedCount || 0;
      markMod += r.modifiedCount || 0;
    }

    // ---------- carduniques（唯一目录：卡名的那一份家底）----------
    // **这一档是「不带就会丢中文名」的**：官方源只覆盖不到一半的简中，其余是本地补的，
    // 换台机器 / 重装之后官方源里没有那几千个名字，少了它补不回来。
    // ⚠️ 老数据包（V1.2.31 以前导的）没有这一档 —— **缺了就整段跳过**，
    //    绝不能因为「不是数组」就把它当成空数组把唯一目录清空。所以判据是 `Array.isArray`。
    let uniIns = 0, uniMod = 0, uniSkipped = 0, uniMissing = false;
    if (!Array.isArray(b.carduniques)) {
      uniMissing = true;
    } else {
      if (mode === 'replace') {
        await CardUnique.deleteMany({});
      }
      const uniOps = [];
      const seenUni = new Set();
      for (const u of b.carduniques) {
        const keyType = String(u.keyType || '').trim();
        const key = String(u.key || '').trim();
        if (!key || (keyType !== 'extCode' && keyType !== 'code')) { uniSkipped++; continue }
        const kk = keyType + '|' + key;
        if (seenUni.has(kk)) { uniSkipped++; continue }
        seenUni.add(kk);
        // keyType / key 走 filter（upsert 时 MongoDB 会把等值条件带进新文档）；
        // `official` 用整对象 $set，四个键一个不少 —— 前端和导出都靠这个形状。
        uniOps.push({
          updateOne: {
            filter: { keyType, key },
            update: { $set: buildSet(UNIQUE_CANON, u, onlyPresent) },
            upsert: true,
          },
        });
      }
      for (let i = 0; i < uniOps.length; i += 500) {
        const r = await CardUnique.bulkWrite(uniOps.slice(i, i + 500), { ordered: false });
        uniIns += r.upsertedCount || 0;
        uniMod += r.modifiedCount || 0;
      }
      // 名字的来源整个换了一批 → 映射缓存作废，否则后面读到的还是导入前那份
      卡名.失效();
    }

    // ---------- altLabels（老数据包才有） ----------
    // V1.2.39 起异画标签是 `cardcatalogs.altLabel` 这个行字段，跟着上面的 cardcatalogs
    // 一起导进来了，没有单独要写的东西。老数据包里那个顶层 `altLabels` 映射**只能丢**：
    // 它按编号存（`{"SER|1": "异画"}`），而新库里同一个键可能落在好几行上，
    // 硬套会把标签糊到不该有的行。真要救老包，得人工比对，代码里不猜。
    const labelsFile = Object.keys(b.altLabels || {}).length;
    if (labelsFile) {
      console.warn(`[TCG] 这份数据包里有 ${labelsFile} 条老的顶层 altLabels，已忽略 —— 异画标签现在是行上的字段，请重新在目录页里填`);
    }

    // 目录被整库改写过 → 图源相关的缓存全部作废
    invalidateTcgCaches();

    res.json({
      ok: true,
      mode,
      cardcatalogs: { inserted: catIns, updated: catMod, skipped: catSkipped },
      cardmarks: { inserted: markIns, updated: markMod, skipped: markSkipped },
      // uniMissing=true 表示这份文件里没有唯一目录那一档（老数据包），**跳过了没导**
      carduniques: { inserted: uniIns, updated: uniMod, skipped: uniSkipped, missing: uniMissing },
      // 老数据包里那层顶层 altLabels 被忽略掉的条数（新数据包恒为 0）
      altLabelsIgnored: labelsFile,
      backupDir,
      ms: Date.now() - started,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/tcg/card/:code — 批量写这个编号的异画标签 — 需登录
//
// body 还是老形状 `{ altLabels: {"SER|0": "原画", "SER|1": "异画"} }`（上传页
// batch-recognize.vue 就是一个键一个键填的），但落库方式变了：键**拆开**成
// (罕贵度, 后缀序号) 找到对应那一行，写它的 `altLabel` 字符串。
// 以前是往编号上挂一整份映射，拆行之后「罕贵度+后缀序号」本来就是一行的主键，
// 映射那层已经没有存在的理由了。
router.put('/card/:code', auth, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const { altLabels } = req.body || {};
    if (!code || !altLabels || typeof altLabels !== 'object') {
      return res.status(400).json({ ok: false, error: '需要 code 和 altLabels 对象' });
    }

    let 写了 = 0, 没对上 = [];
    for (const [key, v] of Object.entries(altLabels)) {
      const m = String(key).match(/^(.+?)\|(\d+)$/);
      if (!m) { 没对上.push(key); continue }
      const r = await CardCatalog.updateOne(
        { code, rarity: m[1], altArtIndex: parseInt(m[2], 10) },
        { $set: { altLabel: String(v == null ? '' : v).trim() } }
      );
      if (r.matchedCount > 0) 写了++;
      else 没对上.push(key);      // 这一行在库里不存在（罕贵度对不上），跳过不建新行
    }

    if (!写了 && 没对上.length) {
      return res.status(404).json({ ok: false, error: '目录里没有 ' + code + ' 这些行：' + 没对上.join('、') });
    }
    res.json({ ok: true, code, 写了, 没对上: 没对上.length ? 没对上 : undefined });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== 图源路径配置 ====================
// GET /api/tcg/paths — 当前 5 个图源路径 + 各路径存在性 + 默认值
router.get('/paths', authAdmin, (req, res) => {
  try {
    res.json({
      ok: true,
      paths: tcgPaths.get(),
      exists: tcgPaths.exists(),
      defaults: tcgPaths.defaults(),
      configFile: tcgPaths.CONFIG_PATH,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/tcg/paths — 保存图源路径（body 含 5 项中的任意项），写配置+刷缓存立即生效
router.put('/paths', authAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const paths = {};
    for (const k of tcgPaths.KEYS) {
      if (typeof body[k] === 'string') paths[k] = body[k];
    }
    if (Object.keys(paths).length === 0) {
      return res.status(400).json({ ok: false, error: '没有可保存的路径字段' });
    }
    const saved = tcgPaths.save(paths);
    _indexCache = null; // dataDir 可能变化 → 清索引缓存，下次重读
    res.json({ ok: true, paths: saved, exists: tcgPaths.exists() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== 卡库全量载入（从 dataDir JSON 重建 MongoDB CardCatalog） ====================
// POST /api/tcg/import — 从当前 dataDir 的 _index.json + 各包 JSON 全量重建卡库：
//   更新所有卡（含异画/卡密修正）→ 补新库有的新包 → 删除新库没有的残留旧包。
// 异画标签（altLabels）独立维护在 alt-labels.json，导入只在新建卡上初始化、不覆盖已有标签。
router.post('/import', authAdmin, async (req, res) => {
  try {
    const dataDir = tcgPaths.get().dataDir;
    const indexFile = path.join(dataDir, '_index.json');
    if (!fs.existsSync(indexFile)) {
      return res.status(400).json({ ok: false, error: 'ID 数据目录下没有 _index.json，请先确认 dataDir 路径正确' });
    }
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    const packs = index.packs || [];
    if (!packs.length) return res.status(400).json({ ok: false, error: '_index.json 里没有包数据' });

    const started = Date.now();
    let upserted = 0, created = 0, skipped = 0;

    // 「卡面编号」是人工/脚本补的，ID 数据 JSON 里没有 → 重建会把它抹掉。
    // 所以重建前先存一份，重建完再贴回去。凡是改动本接口，这段保护都不能删。
    // 贴回去的键跟着唯一索引一起升级成三元组 —— 只认 code|altArtIndex 的话，
    // 同一个编号的几行会互相抢同一份 faceCode。
    const faceSnap = await CardCatalog
      .find({ faceCode: { $ne: '' } })
      .select('code rarity altArtIndex faceCode')
      .lean();

    // 异画标签是**人工填的**，磁盘 JSON 里一个字都没有 → 重建会同理抹掉它。
    // 和 faceCode 一样：先存一份，重建完贴回去。这份数据以前住在 alt-labels.json、
    // 不归这个接口管，现在落在行上，不护着就会整批消失。
    const labelSnap = await CardCatalog
      .find({ altLabel: { $ne: '' } })
      .select('code rarity altArtIndex altLabel')
      .lean();

    // 先清掉所有有包旧卡（packCode 为空的卡保留），保证精确对齐新库、不留幽灵卡
    const preDel = await CardCatalog.deleteMany({ packCode: { $ne: '' } });

    // 磁盘 JSON 里带的名字，收进来交给唯一目录 —— 见 services/cardNames.js 的「收下」。
    // 磁盘格式本身**不动**（名字照旧写在包 JSON 里，V1.1 还在读它），只是不再进 cardcatalogs。
    const 待收名 = [];

    for (const entry of packs) {
      const packCode = entry.code;
      const file = entry.file || (packCode + '.json');
      const fp = path.join(dataDir, file);
      if (!fs.existsSync(fp)) { skipped++; continue; }
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      const cards = data.cards || [];
      // 磁盘上一条 = 一个编号（罕贵度是「、」串），进库要拆成一行一个罕贵度。
      // 个别包 JSON 里同一个编号有两条重复记录，拆完会出现同一个三元组两次 ——
      // 一次 bulkWrite 里对同一条 upsert 两回会撞唯一索引，所以按三元组去重（后写的赢）。
      const 三元组 = new Map();
      for (const c of cards) {
        const code = String(c.code || '').toUpperCase();
        if (!code) continue;
        待收名.push({
          code,
          extCode: String(c.extCode || c.ext_code || ''),
          jpName: c.jpName || c.jp_name || '',
          cnName: c.cnName || c.cn_name || '',
          enName: c.enName || c.en_name || '',
        });
        for (const 行 of 展开(c.rarity || '', c.altArtIndex || c.alt_art_index || 0)) {
          三元组.set(`${code}|${行.rarity}|${行.altArtIndex}`, {
            code,
            rarity: 行.rarity,
            altArtIndex: 行.altArtIndex,
            faceCode: String(c.faceCode || c.face_code || '').toUpperCase(),
            // ⚠️ 这里**不再写** jpName / cnName / enName —— 卡名归唯一目录管
            extCode: String(c.extCode || c.ext_code || ''),
            hasAltArt: !!(c.hasAltArt || c.has_alt_art),
            cnSource: c.cnSource || c.cn_source || '',
            versionId: c.versionId || 1,
          });
        }
      }
      const ops = [...三元组.values()].map(d => ({
        updateOne: {
          filter: { code: d.code, rarity: d.rarity, altArtIndex: d.altArtIndex },
          update: { $set: { packCode, ...d } },
          upsert: true,
        },
      }));
      for (let i = 0; i < ops.length; i += 500) {
        const r = await CardCatalog.bulkWrite(ops.slice(i, i + 500));
        created += r.upsertedCount || 0;
        upserted += (r.upsertedCount || 0) + (r.modifiedCount || 0);
      }
    }

    // 名字交给唯一目录（只补空位，不覆盖已有的 —— 重复重建是幂等的）
    let 补了名字 = 0;
    try {
      补了名字 = (await 卡名.收下(待收名)).补了;
    } catch (e) {
      console.error('名字收进唯一目录失败:', e.message);
    }

    // 把重建前存下的「卡面编号」贴回去（以重建后的记录为准，编号对不上的自然丢弃）
    let faceRestored = 0;
    if (faceSnap.length) {
      const ops = faceSnap.map(s => ({
        updateOne: {
          filter: { code: s.code, rarity: s.rarity, altArtIndex: s.altArtIndex || 0 },
          update: { $set: { faceCode: s.faceCode } },
        }
      }));
      for (let i = 0; i < ops.length; i += 500) {
        const r = await CardCatalog.bulkWrite(ops.slice(i, i + 500), { ordered: false });
        faceRestored += r.modifiedCount || 0;
      }
      console.log(`[TCG] 导入完成，贴回「卡面编号」 ${faceRestored} / ${faceSnap.length} 条`);
    }

    // 「异画标签」同理，而且更要紧 —— 它是人工填了几百条的劳动成果，磁盘上没有备份
    let labelRestored = 0;
    if (labelSnap.length) {
      const ops = labelSnap.map(s => ({
        updateOne: {
          filter: { code: s.code, rarity: s.rarity, altArtIndex: s.altArtIndex || 0 },
          update: { $set: { altLabel: s.altLabel } },
        }
      }));
      for (let i = 0; i < ops.length; i += 500) {
        const r = await CardCatalog.bulkWrite(ops.slice(i, i + 500), { ordered: false });
        labelRestored += r.modifiedCount || 0;
      }
      console.log(`[TCG] 导入完成，贴回「异画标签」 ${labelRestored} / ${labelSnap.length} 条`);
    }

    _indexCache = null; // dataDir 可能变化 → 清索引缓存
    res.json({
      ok: true,
      imported: upserted,
      created,
      deleted: preDel.deletedCount || 0,
      faceRestored,
      labelRestored,
      名字补进唯一目录: 补了名字,
      skipped,
      packs: packs.length,
      ms: Date.now() - started,
      dataDir,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==================== 新建卡包 / 上传图片 / 导入 Excel（批次 6） ====================
// 用户自己往图源里加新出的卡包。这三件事以前只能手工开文件夹、手工拖文件、手工写 JSON，
// 现在收进这条链路。写入点仍然全在本文件里，仍然走 invalidateTcgCaches + writePackJson。

/** multer 的错是英文错误码，翻成能看懂的中文再往外抛（否则前端只能显示一句英文） */
const MULTER_MSG = {
  LIMIT_FILE_SIZE: '有文件超过大小上限（图片 20MB / 表格 10MB）',
  LIMIT_FILE_COUNT: '一次最多传 200 个文件',
  LIMIT_UNEXPECTED_FILE: '一次最多传 200 个文件，且字段名要是 files',
  LIMIT_PART_COUNT: '表单字段太多',
};
function uploadGuard(mw) {
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    // multer 是边解析边落盘的，它自己报错时**已经写下去的文件不会自动删**
    // （超大小上限尤其典型：第 3 个文件超限，前两个已经在暂存目录里了）。
    // 而这时候 req.files 是空的、路由处理函数根本不会被调用，也就没有别的地方能清 ——
    // 只能在这里清，否则每失败一次就在暂存目录留一批 .part。
    for (const f of flattenFiles(req.files)) { try { fs.unlinkSync(f.path); } catch (_) {} }
    return res.status(400).json({ ok: false, error: MULTER_MSG[err.code] || err.message || '上传失败' });
  });
}

/** req.files 的形状随 multer 用法而变（array → 数组，fields → 对象套数组），摊平成一个数组 */
function flattenFiles(files) {
  if (!files) return [];
  if (Array.isArray(files)) return files;
  return Object.values(files).flat().filter(Boolean);
}

/**
 * 把暂存文件搬进图源。优先 rename（同盘是原子的、不复制数据）。
 *
 * 跨盘时必须退回复制：暂存目录固定在 `Server\Storage\upload-tmp`（也就是代码所在的盘），
 * 而图源是可配置的 —— 用户完全可能把它指到别的盘、甚至网络盘上，
 * 这时候 `rename` 会直接抛 `EXDEV: cross-device link not permitted`，
 * 表现是「上传永远失败」且错误信息里只有一句英文。实测本地临时图源在 C 盘就复现了。
 * `COPYFILE_EXCL` 顶住「校验和落盘之间被人抢先建了同名文件」那一瞬的竞态。
 */
function moveFile(src, dst) {
  try { fs.renameSync(src, dst); return; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  fs.unlinkSync(src);
}

// 上传先落到这里，校验通过再搬进图源。**不让 multer 直接写图源目录**有两个原因：
//   ① 「同名跳过」必须在**写之前**判，直接写就等于把用户的原图无声替换掉了
//   ② multer 的 filename 回调里没法表达「这一条跳过」，只能整单报错
const UPLOAD_TMP = path.join(__dirname, '..', '..', '..', 'Storage', 'upload-tmp');
const uploadTmp = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(UPLOAD_TMP, { recursive: true }); cb(null, UPLOAD_TMP); },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.floor(Math.random() * 1e9)}.part`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 200 },
});

/**
 * 新建一个卡包：图源里建目录 + `_index.json` 里加一条。
 *
 * **必须写 _index.json**，否则新包在目录页一级根本不出现 —— `GET /packs` 只读它。
 * 新建的空包 `has_data` 给 true（不是 false）：目录页点开一个包前会判 `has_data`，
 * 为 false 就只弹一句「待爬取」不让进 —— 而这个用户刚建的空包恰恰是**必须能进去的**，
 * 进去才有「格式提示 + 上传图片 + 导入 Excel」那三个按钮。数据有没有另看 total_cards。
 */
router.post('/packs', authAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const code = String(b.code || '').trim().toUpperCase();
    const fullName = String(b.fullName || '').trim();
    const enName = String(b.enName || '').trim();
    const date = String(b.date || '').trim() || new Date().toISOString().slice(0, 10);

    if (!code) return res.status(400).json({ ok: false, error: '请填写卡包编号' });
    if (!PACK_CODE_RE.test(code)) {
      return res.status(400).json({ ok: false, error: '卡包编号只能用字母、数字、括号、加号、连字符，1~20 位，不能有空格或路径符号' });
    }
    if (!fullName) return res.status(400).json({ ok: false, error: '请填写卡包名称' });

    const ocgDir = tcgPaths.get().ocgDir;
    if (!ocgDir || !fs.existsSync(ocgDir)) {
      return res.status(400).json({ ok: false, error: '详细图源目录不存在，请先到「图源设置」里配好' });
    }
    const dir = resolvePackDir(code);
    if (!dir) return res.status(400).json({ ok: false, error: '卡包编号不合法' });
    if (fs.existsSync(dir)) {
      return res.status(409).json({ ok: false, error: `图源里已经有「${code}」这个目录了，不用新建`, dirExists: true });
    }
    // 索引里有、目录却没有：**不放行**。放行就等于拿这一次的输入去覆盖那条已有记录 ——
    // writePackJson 会合并 full_name / en_name，而这里固定传 status:'pending'、
    // totalCards:0、imageCount:0，一个已经有几千张卡的包会被抹成「空包待处理」。
    // 触发这一条的现实场景多半是「图源指向了没挂上的盘」或「编号打错了」，
    // 两种情况都不该由「新建卡包」来处理，所以只把话说明白，不动数据。
    const index = loadIndex();
    if ((index.packs || []).some(p => String(p.code).toUpperCase() === code)) {
      return res.status(409).json({
        ok: false, inIndex: true,
        error: `「${code}」已经在卡牌编号目录里了，但图源里找不到它的文件夹 —— 请先到「图源设置」确认详细图源目录对不对（换了盘符或网络盘没挂上都会这样）`,
      });
    }

    // 不用 recursive：父目录（图源根）必须已经存在，不存在说明路径配置有问题，
    // 这时候递归建一串目录反而是灾难
    const jsonPath = path.join(tcgPaths.get().dataDir, `${code}.json`);
    const jsonExisted = fs.existsSync(jsonPath);
    fs.mkdirSync(dir);
    let wrote;
    try {
      wrote = writePackJson(code, [], {
        fullName, enName, date, status: 'pending', totalCards: 0, imageCount: 0, hasData: true,
      });
    } catch (e) {
      // JSON 没写成 → 把刚建的东西撤掉。不撤的话图源里会残留一个空目录，
      // 用户重试时撞上「目录已存在」的 409，从此再也建不了这个包。
      // writePackJson 是先写 {包名}.json 再写 _index.json，两次写入都可能失败，
      // 所以两个残留物都要清（只清目录的话会留下一个孤儿 JSON）。
      try { fs.rmdirSync(dir); } catch (_) {}
      if (!jsonExisted) { try { fs.unlinkSync(jsonPath); } catch (_) {} }
      throw e;
    }
    invalidateTcgCaches(code);
    console.log(`[TCG] 新建卡包 ${code}（${fullName}）→ ${dir}`);
    res.json({ ok: true, code, dir, fullName, enName, date, packFile: wrote.filePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 往包目录里传图片。同名文件**跳过并如实报告**，绝不覆盖。 */
router.post('/pack-files/:packCode/upload', authAdmin, uploadGuard(uploadTmp.array('files', 200)), async (req, res) => {
  // multer 在进这个函数之前就已经把文件写到暂存目录了，所以**第一件事就是全部登记下来**：
  // 下面任何一句 `return res.status(4xx)` 或循环中途抛错，都要靠这份清单才能把暂存文件删干净。
  // 曾经写成「在循环里 push」，结果是：包名不存在时直接 return → 整批文件留在暂存目录；
  // 循环里第 1 个文件抛错 → 后面几个还没登记，也一起留下。两种都实测留下了 .part 残渣。
  const files = req.files || [];
  const staged = files.map(f => f.path);
  try {
    const packCode = req.params.packCode;
    const dir = resolvePackDir(packCode);
    if (!dir) return res.status(400).json({ ok: false, error: '包名不合法' });
    if (!fs.existsSync(dir)) {
      return res.status(404).json({ ok: false, error: `图源里没有「${packCode}」这个目录，请先在「＋ 新建卡包」里建好` });
    }
    if (!files.length) return res.status(400).json({ ok: false, error: '没有收到文件' });

    const saved = [], skipped = [];
    for (const f of files) {
      // multer 1.x 的 originalname 是按 latin1 解出来的，中文/日文名会变乱码。
      // 卡图名本来都是 ASCII（编号-罕贵），所以先按原样校验，过不了再试一次 latin1→utf8。
      // 两边都试是为了不赌 multer 的版本行为 —— 赌错的那一边会让正常文件名被判非法。
      let name = f.originalname;
      if (!PACK_FILE_RE.test(name) || name.startsWith('_')) {
        const fixed = Buffer.from(f.originalname, 'latin1').toString('utf8');
        if (PACK_FILE_RE.test(fixed) && !fixed.startsWith('_')) name = fixed;
      }
      if (!PACK_FILE_RE.test(name)) { skipped.push({ name, reason: '文件名不合法（只收 .jpg/.jpeg/.png/.webp）' }); continue; }
      if (name.startsWith('_')) { skipped.push({ name, reason: '下划线开头，约定忽略' }); continue; }
      const dst = resolvePackFile(dir, name);
      if (!dst) { skipped.push({ name, reason: '文件名不合法' }); continue; }
      if (fs.existsSync(dst)) { skipped.push({ name, reason: '同名文件已存在，没覆盖' }); continue; }
      moveFile(f.path, dst);   // 同盘 rename，跨盘自动退回复制
      saved.push({ name, size: f.size });
    }

    invalidateTcgCaches(packCode);
    // 顺手把 _index.json 的 image_count 刷新，一级列表的「图源齐不齐」才跟着动
    let imageCount = null;
    try {
      imageCount = (cachedReaddir(dir) || []).filter(n => IMG_EXT_RE.test(n) && !n.startsWith('_')).length;
      patchIndexEntry(packCode, { image_count: imageCount });
    } catch (_) { /* 刷新计数失败不算上传失败 */ }

    res.json({ ok: true, packCode, saved, skipped, savedCount: saved.length, skippedCount: skipped.length, imageCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    for (const p of staged) { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} }
  }
});

/** Excel 模板下载。表头是中文，第 1 行是填写说明（导入时会自动跳过说明行找表头）。 */
router.get('/template.xlsx', authAdmin, (req, res) => {
  try {
    const guide = [
      '填写说明：卡牌编号必填（如 QCAC-JP001）；卡密必须是纯数字，填了才可能找到图；'
      + '罕贵度那一段必须和图源文件名里的一字不差，否则这张卡会显示成卡背；多个罕贵度用「、」分隔。'
      + '下面那行示例请删掉再填。',
    ];
    const head = ['卡牌编号', '卡密', '日文名', '中文名', '英文名', '罕贵度', '异画序号'];
    const sample = ['QCAC-JP001', '12345678', 'サンプルカード', '示例卡', 'Sample Card', 'SER', 0];
    const ws = XLSX.utils.aoa_to_sheet([guide, head, sample]);
    ws['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '卡牌编号目录');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // 文件名里的中文要走 RFC 5987 的 filename*：header 里直接放非 ASCII 是无效的，
    // 浏览器会乱码或干脆不认。同时留一个 ASCII 的 filename 给老浏览器兜底。
    res.setHeader('Content-Disposition',
      `attachment; filename="card-catalog-template.xlsx"; filename*=UTF-8''${encodeURIComponent('卡牌编号目录模板.xlsx')}`);
    res.end(buf);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 从 Excel 导入卡牌数据到指定包。列名认中文表头，表头行自己找（说明行可有可无）。 */
router.post('/packs/:code/import-excel', authAdmin,
  uploadGuard(multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }).single('file')),
  async (req, res) => {
    try {
      const packCode = String(req.params.code || '').trim().toUpperCase();
      if (!PACK_CODE_RE.test(packCode)) return res.status(400).json({ ok: false, error: '包名不合法' });
      const dir = resolvePackDir(packCode);
      if (!dir) return res.status(400).json({ ok: false, error: '包名不合法' });
      if (!fs.existsSync(dir)) {
        return res.status(404).json({ ok: false, error: `图源里没有「${packCode}」这个目录，请先在「＋ 新建卡包」里建好` });
      }
      if (!req.file) return res.status(400).json({ ok: false, error: '没有收到表格文件（字段名要是 file）' });

      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return res.status(400).json({ ok: false, error: '这个 Excel 里没有工作表' });
      // header:1 → 拿到二维数组，自己找表头行。比写死「第 2 行是表头」宽容：
      // 用户删掉说明行、或复制粘贴出一张没有说明行的表，都能导
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      const hi = grid.findIndex(r => r.some(c => String(c).trim() === '卡牌编号'));
      if (hi < 0) {
        return res.status(400).json({ ok: false, error: '找不到「卡牌编号」这一列。第一行要放表头（可以先下载模板照着填）' });
      }
      const head = grid[hi].map(c => String(c).trim());
      const col = (names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
      const C = {
        code: col(['卡牌编号', '编号']),
        ext: col(['卡密', '密码']),
        jp: col(['日文名', '日文名称']),
        cn: col(['中文名', '中文名称']),
        en: col(['英文名', '英文名称']),
        rarity: col(['罕贵度', '罕贵']),
        alt: col(['异画序号', '异画号']),
      };
      const cell = (r, i) => (i >= 0 && r[i] !== undefined ? r[i] : '');

      const ocgDir = tcgPaths.get().ocgDir;
      const ops = [], accepted = [], errors = [], warnings = [];
      const 待收名 = [];      // 表里带的卡名，最后交给唯一目录（cardcatalogs 不再存名字）
      let blankRows = 0, noImage = 0;
      for (let n = hi + 1; n < grid.length; n++) {
        const r = grid[n] || [];
        const rowNo = n + 1;                       // Excel 里看到的行号
        const rawCode = String(cell(r, C.code)).trim();
        if (!rawCode) { blankRows++; continue }      // 空行（模板里可能留着）
        const code = rawCode.toUpperCase();
        if (!CARD_CODE_RE.test(code)) {
          errors.push({ row: rowNo, reason: `编号「${rawCode}」形状不对（要像 QCAC-JP001 这样，包名-数字）` });
          continue;
        }
        const built = buildCatalogDoc(packCode, {
          code,
          ext_code: String(cell(r, C.ext)).trim(),
          jp_name: String(cell(r, C.jp)).trim(),
          cn_name: String(cell(r, C.cn)).trim(),
          en_name: String(cell(r, C.en)).trim(),
          rarity: String(cell(r, C.rarity)).trim(),
          alt_art_index: parseInt(cell(r, C.alt)) || 0,
        });
        if (built.error) { errors.push({ row: rowNo, reason: built.error }); continue }

        // 表里这一行可能拆成几行（罕贵度栏写了「UR、SER、SER(1)」那种），逐行处理。
        // 罕贵度和图源文件名交叉校验：对不上不拦（可能图还没传），但要明说 ——
        // 罕贵度写错不会报错，只会让这张卡安安静静显示成卡背，是最难查的一类问题。
        // 「图源里一个文件都没有」不逐行警告（新包批导时几千行会刷屏），只记个数汇总报出去。
        const real = listOcgRarities(ocgDir, packCode, code).map(x => x.rarity);
        if (!real.length) noImage++;
        for (const doc of built.docs) {
          if (real.length && doc.rarity && !real.includes(doc.rarity)) {
            warnings.push({ row: rowNo, reason: `${doc.code}：罕贵度「${doc.rarity}」在图源里没有对应文件（现有：${real.join('、')}），这张会显示卡背` });
          }
          ops.push({ updateOne: { filter: { code: doc.code, rarity: doc.rarity, altArtIndex: doc.altArtIndex }, update: { $set: doc }, upsert: true } });
          // 回写包 JSON 用 snake_case（那是包 JSON 的原生写法，V1.1 也读它）。
          // 不写 packCode：它由文件名决定，文件里多存一份只会多一个不一致的机会
          accepted.push({ code: doc.code, jp_name: built.names.jpName, cn_name: built.names.cnName, en_name: built.names.enName,
                          ext_code: doc.extCode, rarity: doc.rarity, has_alt_art: doc.hasAltArt, alt_art_index: doc.altArtIndex });
          待收名.push({ code: doc.code, extCode: doc.extCode, ...built.names });
        }
      }

      let inserted = 0, updated = 0;
      for (let i = 0; i < ops.length; i += 500) {
        const r = await CardCatalog.bulkWrite(ops.slice(i, i + 500), { ordered: false });
        inserted += r.upsertedCount || 0;
        // 用 matchedCount 而不是 modifiedCount：同一张表导第二遍时字段值一字不变，
        // modifiedCount 会报 0，界面上就变成「新增 0、更新 0」，用户会以为白导了
        // （甚至以为表没被读到），而实际上这 3 行都对上了。这里要表达的是
        // 「表里这几行在库里对上了」，matchedCount 才是这个意思。
        updated += r.matchedCount || 0;
      }

      let totalCards = null;
      try {
        totalCards = await CardCatalog.countDocuments({ packCode });
        writePackJson(packCode, accepted, { totalCards, hasData: true });
      } catch (e) {
        warnings.push({ row: 0, reason: `包 JSON 回写失败（数据库已导入）：${e.message}` });
      }
      // 表里的卡名交给唯一目录。**在 writePackJson 之后**做，这样即使收名下失败，
      // 磁盘包 JSON 里那份名字也还在（V1.1 还要读它），不会两头都丢。
      let 补了名字 = 0;
      try {
        补了名字 = (await 卡名.收下(待收名)).补了;
      } catch (e) {
        warnings.push({ row: 0, reason: `卡名写入唯一目录失败：${e.message}` });
      }
      invalidateTcgCaches(packCode);

      console.log(`[TCG] Excel 导入 ${packCode}：新增 ${inserted} 更新 ${updated}，拒 ${errors.length} 行，警告 ${warnings.length} 条，无图 ${noImage} 个，卡名补进唯一目录 ${补了名字} 条`);
      res.json({ ok: true, packCode, inserted, updated, totalCards, blankRows, noImage, 名字补进唯一目录: 补了名字,
                 errors: errors.length ? errors : undefined, warnings: warnings.length ? warnings : undefined });
    } catch (e) {
      res.status(500).json({ ok: false, error: '表格解析失败：' + e.message });
    }
  });

/**
 * 「图源里有、卡牌目录里没有」的包清单。
 *
 * 两档粒度，差别只在**文件数**：默认档返回包名清单和计数（一次 readdir 图源根 + 一次索引，
 * 很便宜），`?detail=1` 才额外对每个未收录目录做一次 readdir 去数文件 ——
 * 图源里 1500+ 个目录，这一项才是贵的那个。一级页平时只要一句「还有 N 个包未收录」，
 * 展开列表也用得上包名，所以包名清单两档都给，贵的文件数按需。
 */
router.get('/uncataloged-packs', authAdmin, (req, res) => {
  try {
    const detail = req.query.detail === '1' || req.query.detail === 'true';
    const now = Date.now();
    if (uncatCache.data && uncatCache.data.detail >= (detail ? 1 : 0) && (now - uncatCache.time) < INDEX_CACHE_TTL) {
      return res.json({ ok: true, ...uncatCache.data, cached: true });
    }
    const ocgDir = tcgPaths.get().ocgDir;
    if (!ocgDir || !fs.existsSync(ocgDir)) {
      return res.status(400).json({ ok: false, error: '详细图源目录不存在，请先到「图源设置」里配好' });
    }
    const index = loadIndex();
    const known = new Set((index.packs || []).map(p => String(p.code).toUpperCase()));
    let dirs = [];
    try {
      dirs = fs.readdirSync(ocgDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
        .map(d => d.name);
    } catch (e) {
      return res.status(500).json({ ok: false, error: '读取图源目录失败：' + e.message });
    }
    const dirUpper = new Set(dirs.map(d => d.toUpperCase()));

    // ① 图源里有文件夹，但 _index.json 里没有 → 一级列表看不到它
    const uncataloged = [];
    for (const name of dirs) {
      if (known.has(name.toUpperCase())) continue;
      const item = { code: name };
      if (detail) {
        try { item.fileCount = (cachedReaddir(path.join(ocgDir, name)) || []).filter(f => IMG_EXT_RE.test(f) && !f.startsWith('_')).length; }
        catch (_) { item.fileCount = 0; }
      }
      uncataloged.push(item);
    }
    uncataloged.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

    // ② 目录里有、图源里却没有文件夹 → 这一类才是真要去处理的（点进去是空的）
    const missingDir = [...known].filter(c => !dirUpper.has(c)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    const data = { detail, total: uncataloged.length, missingDirCount: missingDir.length, uncataloged, missingDir };
    uncatCache = { time: now, data };
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
