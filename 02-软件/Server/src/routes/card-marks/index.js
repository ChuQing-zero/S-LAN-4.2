/**
 * 卡牌信息记录 API —— 「这张卡要处理」的清单
 *
 * 两种进法：
 *   · 自动 —— 编号在目录里查不到，由 CardMark.autoRegister() 在写路径上记一条
 *     （识别出编号 / 新建卡 / 改编号三处，见 models/CardMark.js）。**永远是通配（rarity=''）**。
 *   · 手动 —— 前端卡片行的蓝色「信息登记」块点一下就 POST 一条。**带这张卡的罕贵度**。
 * 前端不区分这两者：登记过的卡带 marked=true → 绿色「信息已登记」+ 纯红底。
 * 只有在这里 DELETE 掉，前端才会一起变回蓝色白底 —— "处理完一条删一条"。
 *
 * 粒度：**按 (编号, 罕贵度) 唯一**。标了 N 就只有 N 变红，标了 NPR 就只有 NPR 变红。
 * `rarity: ''` 是**通配**（不限罕贵度），92 条老记录全是它，行为跟改之前一模一样。
 * 匹配口径统一在 services/cardMarks.js，别在这儿另写一套。
 */
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const CardMark = require('../../models/CardMark');
const CardCatalog = require('../../models/CardCatalog');
// 卡名已不存 cardcatalogs，取名字一律走这里（见 services/cardNames.js 顶上那段）
const 卡名 = require('../../services/cardNames');
const { norm, 键 } = require('../../services/cardMarks');

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// POST /v1/api/card-marks — 登记（单张、批量都走这里）
//
// 现在收的是 `marks: [{code, rarity}]` —— 每张卡带自己的罕贵度。
// 老调用方传的 `codes: ['DL1-045']` 仍然认，按**通配**处理（等于"这个编号整个有问题"）。
router.post('/', auth, async (req, res) => {
  try {
    const body = req.body || {};
    const 原始 = Array.isArray(body.marks)
      ? body.marks
      : Array.isArray(body.codes)
        ? body.codes.map((c) => ({ code: typeof c === 'string' ? c : c && c.code, rarity: '' }))
        : [{ code: body.code, rarity: '' }];

    // 规范化 + 去重（同一个 (编号, 罕贵度) 只处理一次）
    const seen = new Set();
    const marks = [];
    for (const m of 原始) {
      const code = norm(m && m.code);
      if (!code || code === '...' || code === '---') continue;
      const rarity = norm(m && m.rarity);
      const k = 键(code, rarity);
      if (seen.has(k)) continue;
      seen.add(k);
      marks.push({ code, rarity });
    }
    if (!marks.length) return res.status(400).json({ error: '没有有效的编号' });

    const codes = [...new Set(marks.map((m) => m.code))];
    const libraryCode = String(body.libraryCode || '');

    // 编号当前显示的卡名/卡图：优先按目录实时取（跟列表接口口径一致），
    // 取不到就退回调用方传上来的（那说明目录里还没有这张卡）。
    //
    // ⚠️ 这里是**写路径**：下面取到的名字会被 `$setOnInsert` 永久写进 `cardmarks`，
    // 而 `$setOnInsert` 只在首次建档写一次、写坏了不可逆。卡名已经不存 `cardcatalogs` 了，
    // **必须 `回填`，漏了就是把空串永久存进登记快照。**
    //
    // 快照按**编号**取就够了：同一个编号的名字不会因为罕贵度不同而不同。
    const hits = await CardCatalog.find({ code: { $in: codes } }).select('code extCode').lean();
    await 卡名.回填(hits);
    const hitMap = new Map(hits.map((h) => [norm(h.code), h]));
    const sent = body.snapshots && typeof body.snapshots === 'object' ? body.snapshots : {};

    let added = 0;
    for (const { code, rarity } of marks) {
      const hit = hitMap.get(code);
      const snap = sent[code] || {};
      const r = await CardMark.updateOne(
        { code, rarity },
        {
          // 已登记过的不覆盖快照（保留最早那次看到的问题），只补空的库
          $setOnInsert: {
            code,
            rarity,
            libraryCode,
            jpName: (hit && hit.jpName) || snap.jpName || '',
            cnName: (hit && hit.cnName) || snap.cnName || '',
            img: snap.img || '',
            note: '',
            markedBy: req.user?.id || '',
            source: 'manual',
            markedAt: new Date(),
          },
        },
        { upsert: true }
      );
      if (r.upsertedCount) added++;
    }

    const total = await CardMark.countDocuments();
    res.json({ ok: true, marks, codes, added, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 排序白名单。以前是把 query 里的 sort 原样丢给 mongoose 的 .sort()，
// 等于让调用方随便指定排序字段（还能拿它试探集合里有哪些键）。
// 后台页只需要这四种，认不出就用默认值。
const SORTS = {
  '-markedAt': { markedAt: -1 },   // 默认：最近登记的在前
  markedAt: { markedAt: 1 },
  code: { code: 1 },               // 二级页（某个包内）用：按编号升序
  '-code': { code: -1 },
};

// 「这个编号属于哪个包」= 第一个 '-' 之前那一段。跟 /prefixes 的 $group 用同一个表达式，
// 保证「包里显示的条数」和「点进去看到的条数」必然一致 —— 两边只要有一边算错就会对不上。
const PREFIX_OF = { $arrayElemAt: [{ $split: ['$code', '-'] }, 0] };

// GET /v1/api/card-marks/codes — 上传页兜底用
//
// 上传页把这份全集缓存在内存里，用来判断"刚识别出来的那张卡是不是已经登记过"。
// 列表接口虽然每条都带 marked，但那是给**已经在列表里**的卡用的；
// 刚拍出来的卡是本地 new 的，没走过接口 —— 以前是靠"在本页找有没有同编号的绿卡"猜的，
// 换个库就猜不中，得刷新才变绿。有了这个全集，判断口径就跟服务端一致了。
//
// `items` 是**权威**的一份：[{code, rarity, source}]。(code, rarity) 才能唯一定位一条记录，
// 但 `codes`（去重编号表）和 `sources` 保留着 —— 老调用方只关心编号时还能用。
// `sources` 的键是 `CODE|RARITY`（通配那条是 `CODE|`），跟 items 一一对应。
//
// sources 是给「取消登记」那个弹窗用的（前端绿块再点一下就想反悔）：
// 自动记的（编号在目录里查不到，见 CardMark.autoRegister）删掉之后**会自己回来** ——
// 只要那张卡再被写一次就重新登记（编辑框保存永远带编号 → PUT /cards/:id 里触发）。
// 所以弹窗要如实说明这条是自动的，不能跟手动点出来的说一样的话。
// 老记录没有 source 字段，按"手动"兜底（那批都是人点出来的）。
router.get('/codes', auth, async (req, res) => {
  try {
    const rows = await CardMark.find({}).select('code rarity source').lean();
    const items = rows.map((r) => ({
      code: r.code,
      rarity: r.rarity || '',
      source: r.source === 'auto' ? 'auto' : 'manual',
    }));
    const sources = {};
    items.forEach((it) => { sources[键(it.code, it.rarity)] = it.source; });
    res.json({
      items,
      codes: [...new Set(items.map((it) => it.code))],
      sources,
      total: items.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/card-marks/prefixes — 有记录的卡包 + 各包几条（后台一级页）
//
// 包不是一张表里的实体，是每次从记录里现聚出来的，所以「包里一条记录都没有 → 这个包不存在」
// 是天然的，不用写任何判断。不落库、不加字段。
// count 直接就是记录条数 —— 表上 (code, rarity) 有唯一索引，一条记录就是一个"要修的点"，
// 所以「DL1-045 的 N 和 NPR 各一条 = 2 个」是白来的，也正是用户要的「精准查到错误点」。
router.get('/prefixes', auth, async (req, res) => {
  try {
    const rows = await CardMark.aggregate([
      { $group: { _id: PREFIX_OF, count: { $sum: 1 }, lastMarkedAt: { $max: '$markedAt' } } },
      { $sort: { lastMarkedAt: -1 } },   // 最近登记过的包在最上面，好接着处理
    ]);
    res.json({
      list: rows.map((r) => ({
        codePrefix: r._id || '(无前缀)',
        count: r.count,
        lastMarkedAt: r.lastMarkedAt,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/card-marks — 后台列表（二级页：某个包里的记录）
router.get('/', auth, async (req, res) => {
  try {
    const { keyword, libraryCode, prefix, rarity, page = 1, pageSize = 50, sort = '-markedAt' } = req.query;
    const query = {};
    if (libraryCode) query.libraryCode = libraryCode;
    // rarity 用「传了就精确筛、不传就全都要」——**不能用 norm() 后的空串当"不筛"**，
    // 因为空串本身是个合法值（通配记录），`?rarity=` 就是"只看通配那条"。
    if (rarity !== undefined && rarity !== null) query.rarity = norm(rarity);
    if (prefix) {
      // 用 $expr 按「现算出来的前缀」精确匹配，而不是 code 上加正则：
      // 编号正好就是包名本身（没有 '-'）时，正则 ^DL1- 匹配不到，$expr 能匹配到。
      query.$expr = { $eq: [PREFIX_OF, String(prefix)] };
    }
    if (keyword) {
      const re = { $regex: escRe(keyword), $options: 'i' };
      query.$or = [{ code: re }, { rarity: re }, { jpName: re }, { cnName: re }, { note: re }];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 500);

    const [total, rows] = await Promise.all([
      CardMark.countDocuments(query),
      CardMark.find(query).sort(SORTS[sort] || SORTS['-markedAt']).skip((pageNum - 1) * size).limit(size).lean(),
    ]);

    res.json({
      list: rows.map((r) => ({
        code: r.code,
        // 空串 = 不限罕贵度，前端据此显示「(不限)」
        rarity: r.rarity || '',
        codePrefix: (r.code || '').split('-')[0] || '',
        libraryCode: r.libraryCode || '',
        jpName: r.jpName || '',
        cnName: r.cnName || '',
        img: r.img || '',
        note: r.note || '',
        markedBy: r.markedBy || '',
        // 老记录没有 source 字段，按"手动"兜底（这批都是人点出来的）
        source: r.source === 'auto' ? 'auto' : 'manual',
        markedAt: r.markedAt,
      })),
      total,
      page: pageNum,
      pageSize: size,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /v1/api/card-marks/:code?rarity=N — 改这条记录（备注、罕贵度）
//
// **两个 rarity 是两个不同的东西，别混**：
//   · **query** 里的 `?rarity=`  = 要改**哪一条**（定位用）。通配那条是 `?rarity=`（空串）。
//   · **body**  里的 `rarity`    = 要把它**改成什么**（新值）。不传 = 不动这个字段。
// 所以「把 N 改成 NPR」= `?rarity=N` + body `{rarity:'NPR'}`。
//
// ⚠️ 写路径一律用**精确**的 {code, rarity}，绝不带通配分支 —— 带上的话 filter 会一口气
// 匹配到 {code,''} 和 {code,'N'} 两条，而 updateOne 只会改到其中一条，改的是哪条还不确定。
// 静默无痕，最坏的那种 bug。
//
// 一个编号可能有多条记录（N 一条、NPR 一条）。query 里没给 rarity 而编号又有多条时
// **必须 409**，不能瞎猜改哪条 —— 猜错了就是把备注写到另一档上去。
router.put('/:code', auth, async (req, res) => {
  try {
    const code = norm(req.params.code);
    const body = req.body || {};
    const { note } = body;
    const 给了目标 = 'rarity' in req.query;          // 定位
    const 给了新值 = 'rarity' in body;                 // 改值
    const 目标罕贵 = norm(req.query.rarity);
    const 新罕贵 = norm(body.rarity);

    if (note === undefined && !给了新值) return res.status(400).json({ error: '没有要改的字段' });

    if (!给了目标) {
      const 同编号几条 = await CardMark.countDocuments({ code });
      if (同编号几条 > 1) {
        return res.status(409).json({
          error: `${code} 有 ${同编号几条} 条登记（不同罕贵度），请指明要改哪一条`,
          code,
        });
      }
    }

    const $set = {};
    if (note !== undefined) $set.note = String(note);
    if (给了新值) $set.rarity = 新罕贵;

    // 改罕贵度可能撞上 (编号, 罕贵度) 的唯一索引 —— 比如把 N 改成 NPR 而这个编号
    // 已经有一条 NPR 了。那是**语义冲突**（两条记录会合并成一条），不是服务器故障，
    // 所以给 409 加一句人话，别把 E11000 原样吐给用户。
    let r;
    try {
      r = await CardMark.updateOne({ code, rarity: 给了目标 ? 目标罕贵 : 新罕贵 }, { $set });
    } catch (e) {
      if (e && e.code === 11000) {
        return res.status(409).json({
          error: `${code} 已经有一条 ${新罕贵 || '(不限)'} 的登记了，不能把这条改成它（两条会撞在一起）`,
          code, rarity: 新罕贵,
        });
      }
      throw e;
    }
    if (!r.matchedCount) {
      const 在哪条 = 给了目标 ? (目标罕贵 || '(不限)') : (新罕贵 || '(不限)');
      return res.status(404).json({ error: `记录里没有 ${code} 的 ${在哪条} 这一条` });
    }
    res.json({ ok: true, code, rarity: 给了新值 ? 新罕贵 : 目标罕贵, changed: Object.keys($set) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /v1/api/card-marks/:code?rarity=N — 移除（人工处理完了）→ 前端刷新即变回蓝色
//
// 罕贵度走 query 不走路径段，因为**空值在路径里表达不了**（`/:code/` 会被路由规范化掉），
// 而空串是这里的合法值（通配那条）。仓库里 `?type=` 已有同样的先例。
// 不传 rarity = 删通配那条（老记录都是它）—— 不是"删这个编号的全部"，
// 要按编号删干净请用 deleteMany，见 routes/tcg 的改名路径。
router.delete('/:code', auth, async (req, res) => {
  try {
    const code = norm(req.params.code);
    const rarity = norm(req.query.rarity);
    const r = await CardMark.deleteOne({ code, rarity });
    res.json({ ok: true, code, rarity, deleted: r.deletedCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
