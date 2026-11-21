/**
 * 「卡牌资料核对」的**唯一现算入口** —— 表1（唯一目录）的状态、表2（待处理）的清单、
 * `/stats` 的汇总、`/verify` 的验收数字，全部出自这里这**一次**全库扫描。
 *
 * 为什么现算不落库：改完一行就该立刻反映出来。落表就得写同步逻辑，改完不同步反而是 bug
 * （`missing-codes/index.js` 顶上那段注释已经踩过同一个坑）。
 *
 * 为什么在 Node 里算、不下推 Mongo：判定要 ruby 参数、还要带回溯对齐，
 * `$replaceAll` 链写不出来。量级实测：31969 行全表投影 + 约 16 万次比对 ≈ 300–600 ms，
 * 之后 60 秒内命中缓存是 0 ms。后台管理页完全够用。
 *
 * ⚠️ **任何写 `cardcatalogs` 的路径之后都必须调 `bumpReviewVersion()`**，
 * 否则用户改完一行刷新还是旧数字，表现就是「改了没反应」。
 */
const CardCatalog = require('../models/CardCatalog');
const official = require('./cardOfficial');
// 卡名已不存 cardcatalogs，取名字一律走这里（见 services/cardNames.js 顶上那段）
const 卡名 = require('./cardNames');

const 缓存毫秒 = 60 * 1000;

let _缓存 = null;      // { at, version, data }
let _版本 = 0;

/** 写操作之后必须调它：让下一次 computeReview 重算 */
function bumpReviewVersion() {
  _版本++;
  _缓存 = null;
  return _版本;
}

const reviewVersion = () => _版本;

/**
 * 全库扫一遍，返回所有派生数字。带 60 秒缓存 + 版本号失效。
 * @param {{ force?: boolean }} opts force=true 时无视缓存重算
 */
async function computeReview({ force = false } = {}) {
  if (!force && _缓存 && _缓存.version === _版本 && Date.now() - _缓存.at < 缓存毫秒) {
    return _缓存.data;
  }

  const rows = await CardCatalog.find({})
    .select('code packCode extCode rarity altArtIndex')
    .lean();
  // 卡名不在 cardcatalogs 里了，从唯一目录换回来再算 —— 下面全是纯函数，吃的是这里补好的行
  await 卡名.回填(rows);

  const map = official.loadOfficialMap();
  const pending = official.computePending(rows);   // 纯函数，含 verboseName

  // ---------- 名字核对的分档 ----------
  const 按类 = { wrongExtCode: 0, shortName: 0, emptyName: 0, verboseName: 0 };
  for (const p of pending) 按类[p.kind] = (按类[p.kind] || 0) + 1;

  const 错 = pending.filter((p) => p.kind === 'wrongExtCode');
  const 错拆 = {
    能自证: 错.filter((p) => p.suggestion.extCode).length,
    多候选: 错.filter((p) => !p.suggestion.extCode && (p.suggestion.candidates || []).length).length,
    零命中: 错.filter((p) => !p.suggestion.extCode && !(p.suggestion.candidates || []).length).length,
  };

  const verbose = pending.filter((p) => p.kind === 'verboseName');
  const 待处理 = pending.filter((p) => p.kind !== 'verboseName');   // 231 行：真要去改的
  const 缺卡密行 = rows.filter((r) => !r.extCode);

  // ---------- 中文名 ----------
  let 可比 = 0;
  let 要照换 = 0;
  let 官方无简中 = 0;
  for (const r of rows) {
    if (!r.extCode) continue;
    const o = map.get(String(r.extCode));
    if (!o || o.status !== '有') continue;
    if (!o.cn) { 官方无简中++; continue; }
    可比++;
    if (official.normalize(r.cnName) !== official.normalize(o.cn)) 要照换++;
  }

  // ---------- 官方数据自身 ----------
  let 官方有 = 0;
  for (const o of map.values()) if (o.status === '有') 官方有++;

  // ---------- 身份聚合（表1 的「库里现有写法」和状态徽章都从这来）----------
  // key → { keyType, kinds:Set, rows:[{code,packCode,jpName,cnName}] }
  const 身份 = new Map();
  const 归位 = (keyType, key) => {
    if (!身份.has(key)) 身份.set(key, { keyType, kinds: new Set(), rows: [] });
    return 身份.get(key);
  };
  // 先铺一层：所有有卡密的行的 kind 由 computePending 给出，但 ok 的行不会出现在 pending 里，
  // 所以这里对**每一行**都判一次，才能区分「一致」和「写法差异」。
  const kindOf = new Map(pending.map((p) => [String(p._id), p.kind]));
  for (const r of rows) {
    const { keyType, key } = official.identityOf(r);
    const g = 归位(keyType, key);
    const k = kindOf.get(String(r._id));
    // 没进 pending 的三种：名字没问题 / 官方查不到 / 无卡密
    let kind = k || 'ok';
    if (!k) {
      if (!r.extCode) kind = 'noExtCode';
      else {
        const o = map.get(String(r.extCode));
        if (!o || o.status !== '有') kind = 'noOfficial';
      }
    }
    g.kinds.add(kind);
    g.rows.push({ code: r.code, packCode: r.packCode, jpName: r.jpName || '', cnName: r.cnName || '' });
  }

  const data = {
    at: Date.now(),
    version: _版本,
    rows,
    total: rows.length,
    有卡密: rows.filter((r) => !!r.extCode).length,
    无卡密: 缺卡密行.length,
    零卡密行: rows.filter((r) => String(r.extCode) === '0').length,   // 34 行，合法地共用一个身份

    identity: 身份,

    official: { 总数: map.size, 有: 官方有, 查不到: map.size - 官方有 },

    name: {
      不对上: pending.length,          // 392（含 verbose）
      写法啰嗦: 按类.verboseName,      // 161
      真要处理: 待处理.length,         // 231
      byKind: 按类,
      错拆,
    },

    cn: { 可比, 要照换, 官方无简中, 无卡密: 缺卡密行.length },

    pending: 待处理,
    verbose,
    缺卡密行,
  };

  _缓存 = { at: Date.now(), version: _版本, data };
  return data;
}

/**
 * 一个身份的展示徽章。表1 的状态列用它。
 *   查不到  官方源没这个卡密
 *   未使用  库里已经没有任何一行挂在这个身份上（批次4 清空卡密之后会出现）
 *   名字不符 有行的名字是别的卡 / 短一截 / 空的
 *   写法差异 名字都对，只是有行写得啰嗦（内联读音）
 *   一致    全对上
 */
function 徽章(官方状态, group) {
  if (官方状态 !== '有') return '查不到';
  if (!group || !group.rows.length) return '未使用';
  for (const k of ['wrongExtCode', 'shortName', 'emptyName']) {
    if (group.kinds.has(k)) return '名字不符';
  }
  if (group.kinds.has('verboseName')) return '写法差异';
  return '一致';
}

module.exports = { computeReview, bumpReviewVersion, reviewVersion, 徽章 };
