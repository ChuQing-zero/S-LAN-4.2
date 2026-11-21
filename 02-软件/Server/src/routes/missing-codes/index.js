/**
 * 目录缺失编号清单 API
 *
 * 数据由 POST /v1/api/vision/doubao-recognize 自动登记（AI 认出来了但目录里没有）。
 * 这里只读 + 少量维护。
 *
 * 「补上了没」不存数据库开关 —— 每次返回清单时实时去 CardCatalog 比一次：
 *   目录里还没有 → filled=false（待补，图位空白）
 *   目录里已经有了 → filled=true（自动变绿，图能显示出来）
 * 这样补完资料刷新一下就自动变了，不会出现"标记说补好了其实没补"的假绿。
 */
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const MissingCode = require('../../models/MissingCode');
const CardCatalog = require('../../models/CardCatalog');
// 卡名已不存 cardcatalogs，取名字一律走这里（见 services/cardNames.js 顶上那段）
const 卡名 = require('../../services/cardNames');

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /v1/api/missing-codes — 清单（含实时"补上了没"）
router.get('/', auth, async (req, res) => {
  try {
    const { codePrefix, status, keyword, page = 1, pageSize = 50, sort = '-lastSeenAt' } = req.query;
    const query = {};
    if (codePrefix) query.codePrefix = codePrefix;
    if (status) query.status = status;
    if (keyword) query.code = { $regex: escRe(keyword), $options: 'i' };

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 500);

    const [total, rows] = await Promise.all([
      MissingCode.countDocuments(query),
      MissingCode.find(query).sort(sort).skip((pageNum - 1) * size).limit(size).lean(),
    ]);

    // 实时比目录：一次性查完，避免 N 次往返
    const codes = rows.map((r) => r.code).filter(Boolean);
    const hits = codes.length
      ? await CardCatalog.find({ code: { $in: codes } }).select('code extCode').lean()
      : [];
    await 卡名.回填(hits);        // 名字从唯一目录换回来（见 services/cardNames.js）
    const hitMap = new Map(hits.map((h) => [h.code, h]));

    const list = rows.map((r) => {
      const hit = hitMap.get(r.code) || null;
      return {
        code: r.code,
        codePrefix: r.codePrefix || (r.code || '').split('-')[0] || '',
        rarity: r.rarity || '',
        versionId: r.versionId,
        versionName: r.versionName || '',
        seenCount: r.seenCount || 1,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
        status: r.status,
        note: r.note || '',
        filled: !!hit,                                   // 目录里已经有了 → 变绿
        jpName: hit ? hit.jpName : '',
        cnName: hit ? hit.cnName : '',
        extCode: hit ? hit.extCode : '',                 // 有卡密才拿得到图
      };
    });

    // 汇总（整个筛选结果，不只是当前页）
    const allCodes = await MissingCode.find(query).select('code').lean();
    const allHits = allCodes.length
      ? await CardCatalog.find({ code: { $in: allCodes.map((c) => c.code) } }).select('code').lean()
      : [];
    const hitSet = new Set(allHits.map((h) => h.code));

    res.json({
      list,
      total,
      page: pageNum,
      pageSize: size,
      summary: {
        total: allCodes.length,
        filled: allCodes.filter((c) => hitSet.has(c.code)).length,
        pending: allCodes.filter((c) => !hitSet.has(c.code)).length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/missing-codes/prefixes — 有哪些卡包缺编号 + 各缺多少（补资料按这个排优先级）
router.get('/prefixes', auth, async (req, res) => {
  try {
    const rows = await MissingCode.aggregate([
      { $group: { _id: '$codePrefix', count: { $sum: 1 }, lastSeenAt: { $max: '$lastSeenAt' } } },
      { $sort: { count: -1 } },
    ]);
    res.json({ list: rows.map((r) => ({ codePrefix: r._id || '(无前缀)', count: r.count, lastSeenAt: r.lastSeenAt })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /v1/api/missing-codes/:code — 改备注 / 状态
router.put('/:code', auth, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const { note, status } = req.body || {};
    const upd = {};
    if (note !== undefined) upd.note = String(note);
    if (status !== undefined) upd.status = status;
    if (!Object.keys(upd).length) return res.status(400).json({ error: '没有要改的字段' });
    const r = await MissingCode.updateOne({ code }, { $set: upd });
    if (!r.matchedCount) return res.status(404).json({ error: '清单里没有这个编号' });
    res.json({ ok: true, code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /v1/api/missing-codes/:code — 从清单移除（删错了、或不想补了）
router.delete('/:code', auth, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const r = await MissingCode.deleteOne({ code });
    res.json({ ok: true, deleted: r.deletedCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
