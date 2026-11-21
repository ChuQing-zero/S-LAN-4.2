/**
 * 卡名的**唯一读口** —— 卡牌编号目录（`cardcatalogs`）不再自己存卡名，要用时来这里按卡密换。
 *
 * 为什么要这么绕：`cardcatalogs` 是**商品行**（一行 = 一个卡包里的一个位置），
 * 同一个卡密可能在几十个卡包里各出现一次（`89631139` 有 60 行）。
 * 卡名是**卡**的属性，不是商品行的属性 —— 以前每行各存一份，于是同一张卡
 * 在几十行里叫几十个名字（半角/全角连接号、HTML 实体没解码、英文引号被截断…）。
 * 名字只留在 `carduniques` 一份，这里负责把它接回去。
 *
 * ---------- 用法（**新增读 `cardcatalogs` 的地方都必须接**） ----------
 *   const 卡名 = require('../services/cardNames');
 *
 *   const rows = await CardCatalog.find(filter).lean();
 *   await 卡名.回填(rows);            // 原地补上 jpName / cnName / enName，返回值还是那个数组
 *
 * ⚠️ **`回填` 是异步的，别漏 `await`** —— 漏了不会报错，只会拿到一片空名字。
 *
 * ---------- 两条容易踩的线 ----------
 *
 * 1. **`$regex` 查名字的 filter 换不成 `回填`**：回填发生在查询之后，改不了已经筛出来的集合。
 *    按名字搜的地方要先用 `按名字找卡密()` 把关键词换成卡密清单，再用 `{ extCode: { $in } }` 去筛。
 *    同理 `countDocuments` 和 `find` **必须用同一个 filter**，否则 total 和页数对不上。
 *
 * 2. **写路径读名字也要接**（`card-marks/index.js` 的登记快照就是）：
 *    那里读到的名字会被**永久写进另一张表**，漏接就是把空串存进去，
 *    而且 `$setOnInsert` 只在首次建档写、写坏了不可逆。
 *
 * ---------- 缓存 ----------
 * 照 `services/cardReview.js` 的先例：10 分钟缓存 + 版本号失效。
 * **任何写 `carduniques` 的路径之后都要调 `失效()`**，否则用户改完名字刷新还是旧的，
 * 表现成「改了没反应」。
 *
 * ⚠️ 缓存里存的是 `official` 子对象（**合并后**的那一份，官方优先、官方没有才取编号目录）。
 *    别拿它当「纯官方」用 —— `models/CardUnique.js` 顶上那段有详细说明。
 */
const CardUnique = require('../models/CardUnique');

const 缓存毫秒 = 10 * 60 * 1000;

let _缓存 = null;      // { at, version, 按卡密: Map, 按编号: Map }
let _版本 = 0;
let _预热中 = null;

/** 写 carduniques 之后必须调它：让下一次取值重建映射 */
function 失效() {
  _版本++;
  _缓存 = null;
  return _版本;
}

const 版本 = () => _版本;

async function 建缓存() {
  // 只取要用的几列。13,883 条实测约 2 MB，一次读完全放内存，之后取值是 0 次往返。
  const rows = await CardUnique.find({})
    .select('keyType key official')
    .lean();

  const 按卡密 = new Map();
  const 按编号 = new Map();
  for (const r of rows) {
    if (!r.key) continue;
    const o = r.official || {};
    const 名 = { jp: o.jp || '', ruby: o.ruby || '', cn: o.cn || '', en: o.en || '' };
    if (r.keyType === 'extCode') 按卡密.set(String(r.key), 名);
    else if (r.keyType === 'code') 按编号.set(String(r.key), 名);
  }
  return { at: Date.now(), version: _版本, 按卡密, 按编号 };
}

/** 取（必要时重建）映射。带缓存 + 版本号失效。 */
async function 预热({ force = false } = {}) {
  if (!force && _缓存 && _缓存.version === _版本 && Date.now() - _缓存.at < 缓存毫秒) {
    return _缓存;
  }
  // 并发调用只建一次：否则启动时几个请求会同时全表扫
  if (_预热中) return _预热中;
  _预热中 = 建缓存()
    .then((c) => { _缓存 = c; _预热中 = null; return c; })
    .catch((e) => { _预热中 = null; throw e; });
  return _预热中;
}

/** 启动预热用。`startServer` 里 `await` 它，免得第一个请求撞上全表扫。 */
const 就绪 = () => 预热();

/**
 * 查一个目录行对应的名字。
 * **有卡密用卡密、没卡密用编号** —— 和 `carduniques` 的身份规则一致
 * （`services/cardUniques.js` 的 `identityOf`），**不要加任何聪明回退**。
 */
function 查一条(缓存, doc) {
  if (!doc) return null;
  const 卡密 = String(doc.extCode || '').trim();
  if (卡密) {
    const h = 缓存.按卡密.get(卡密);
    if (h) return h;
  }
  const 编号 = String(doc.code || '').trim();
  return 编号 ? 缓存.按编号.get(编号) || null : null;
}

/**
 * 给目录行补上 `jpName / cnName / enName`。
 *
 * **原地改写并返回同一个对象**（数组进、数组出），shape 和以前一模一样 ——
 * 这样下游那一大串 `c.jpName` 一个字都不用改。
 * 唯一目录里查不到的，三个字段一律给**空串**（不是 `undefined`）：
 * 页面、导出、对拍拿到的形状永远一致，前端不用到处写 `|| ''`。
 *
 * @param {object|object[]} docs 单个 lean 对象或数组
 * @param {{ ruby?: boolean }} opts ruby=true 时顺带补 `rubyName`（日文读音）
 */
async function 回填(docs, { ruby = false } = {}) {
  if (!docs) return docs;
  const 缓存 = await 预热();
  const 数组 = Array.isArray(docs);
  const list = 数组 ? docs : [docs];
  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    const h = 查一条(缓存, d);
    d.jpName = h ? h.jp : '';
    d.cnName = h ? h.cn : '';
    d.enName = h ? h.en : '';
    if (ruby) d.rubyName = h ? h.ruby : '';
  }
  return docs;
}

/**
 * 按名字找身份 —— 给「按名字搜目录」的地方用（`$regex` 改不了查询结果，只能反过来查）。
 *
 * 匹配范围必须含 `jp / ruby / cn / en` **四个**：
 * 编号目录以前存的是「啰嗦写法」（`おろかな墓(はか)荒(あら)し`），唯一目录里是干净名，
 * 只比 jp 会让按读音搜丢结果。
 *
 * @returns {{ extCodes: string[], codes: string[] }}
 *   调用方拼 `{ $or: [{ extCode: { $in: extCodes } }, { code: { $in: codes } }] }`。
 *   ⚠️ 命中的行数可能很大，调用方要设上限或者跟别的条件求交收窄
 *   （`tcg/index.js` 那个 `?q=` 就是这么用的：本来就在某个包的 filter 里）。
 */
async function 按名字找卡密(kw) {
  const 缓存 = await 预热();
  const 干 = String(kw || '').trim().toLowerCase();
  const extCodes = [];
  const codes = [];
  if (!干) return { extCodes, codes };
  for (const [目录, 出] of [[缓存.按卡密, extCodes], [缓存.按编号, codes]]) {
    for (const [k, v] of 目录) {
      if ((v.jp && v.jp.toLowerCase().includes(干))
        || (v.ruby && v.ruby.toLowerCase().includes(干))
        || (v.cn && v.cn.toLowerCase().includes(干))
        || (v.en && v.en.toLowerCase().includes(干))) {
        出.push(k);
      }
    }
  }
  return { extCodes, codes };
}

/**
 * 一行（卡密 + 编号）换三个名字 —— 给目录页那个「卡牌详情」弹窗的**实时预览**用。
 *
 * 和 `查一条` 只差一处，但是关键的一处：**卡密非空时不许回退到编号**。
 * 用户在卡密那一格敲了个查不到的卡密，就该显示「—」（这个卡密没资料），
 * 而不是把这一行旧编号的名字顶上来 —— 那样看着像"查到了"，其实钥匙是废的，
 * 用户会以为「改了卡密名字没跟着变」。
 * （目录行本身的 `回填` 仍走 `查一条` 带回退：那条路上回退是对的，几千行卡名都靠它。）
 */
async function 按输入取(卡密, 编号) {
  const 缓存 = await 预热();
  const 密 = String(卡密 || '').trim();
  if (密) return 缓存.按卡密.get(密) || null;
  const 号 = String(编号 || '').trim();
  return 号 ? 缓存.按编号.get(号) || null : null;
}

/**
 * 把「带名字的目录行」的名字**补进唯一目录** —— 导入路径专用。
 *
 * 为什么要有它：包 JSON / 备份包 / Excel 里是**带名字**的，字段删掉之后这些名字
 * 没有一个地方接着，直接就没了。这里把它们按身份收进 `carduniques`。
 *
 * 规则和整体口径一致：**只补空位，绝不覆盖已有的**。
 * 唯一目录里已经有名字的（绝大多数）一个字不动；只有官方和现有值都是空的才用导入的名字填。
 * 所以重复导入同一份文件是**幂等**的，不会来回翻。
 *
 * ⚠️ 一个字段都不变时不产生写操作 —— 不然后台点一次导入就把几千条白写一遍，
 *    和 `cardUniques.rebuild` 那个「第二次 rebuild 报改了 13883」是同一个坑。
 *
 * @param {Array<{extCode?,code?,jpName?,cnName?,enName?}>} rows
 * @returns {Promise<{补了:number}>} 真正写动的文档数
 */
async function 收下(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const 缓存 = await 预热();
  const now = new Date();
  const ops = [];
  for (const r of list) {
    if (!r) continue;
    const 卡密 = String(r.extCode || '').trim();
    const 编号 = String(r.code || '').trim();
    const keyType = 卡密 ? 'extCode' : 'code';
    const key = 卡密 || 编号;
    if (!key) continue;

    const 现 = 查一条(缓存, { extCode: 卡密, code: 编号 }) || { jp: '', ruby: '', cn: '', en: '' };
    const 补 = {
      jp: 现.jp || String(r.jpName || '').trim(),
      cn: 现.cn || String(r.cnName || '').trim(),
      en: 现.en || String(r.enName || '').trim(),
    };
    if (补.jp === 现.jp && 补.cn === 现.cn && 补.en === 现.en) continue;   // 一个都不变，不写

    ops.push({
      updateOne: {
        filter: { keyType, key },
        update: {
          $set: { 'official.jp': 补.jp, 'official.cn': 补.cn, 'official.en': 补.en },
          // 身份不存在时顺手建一条。走原生 collection 是因为 schema 的 timestamps
          // 会给更新自动补 updatedAt，把没变的文档也算成 modified（`确保身份()` 踩过）
          $setOnInsert: {
            keyType, key,
            extCode: keyType === 'extCode' ? key : '',
            code: keyType === 'code' ? key : 编号,
            'official.ruby': '',
            builtAt: now, createdAt: now, updatedAt: now,
          },
        },
        upsert: true,
      },
    });
  }
  if (!ops.length) return { 补了: 0 };

  let 补了 = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const r = await CardUnique.collection.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    补了 += (r.upsertedCount || 0) + (r.modifiedCount || 0);
  }
  if (补了) 失效();      // 映射变了，缓存得扔
  return { 补了 };
}

module.exports = { 预热, 就绪, 回填, 失效, 版本, 按名字找卡密, 按输入取, 收下 };
