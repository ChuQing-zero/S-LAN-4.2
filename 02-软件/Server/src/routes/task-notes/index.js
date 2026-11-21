/**
 * 任务清单 API
 *
 * 纯人工维护的待办表：有些问题机器判断不了、必须人工逐个核对（比如老卡包的编号可能跟官方对不上），
 * 先在这里记一条，人工改完把 status 标成 done。
 *
 * 「改到哪一步了」不靠人工记 —— 挂在卡包上的任务（packCode 非空）返回时会实时去 CardCatalog 数一下，
 * 看这个包的编号是否已经全部是三位补零格式。全三位 = 大概率已经改好了。
 * 这样标记和目录现状对不上时，一眼能看出来，不会出现"标了已完成其实没改"的假绿。
 *
 * 注意：实时状态只是参考值，不会自动把 status 改成 done —— 是否算完成由人工判断。
 */
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const TaskNote = require('../../models/TaskNote');
const CardCatalog = require('../../models/CardCatalog');

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /v1/api/task-notes — 清单（含实时卡包编号状态）
router.get('/', auth, async (req, res) => {
  try {
    const { status, category, keyword, packCode, page = 1, pageSize = 100 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (category) query.category = category;
    if (packCode) query.packCode = String(packCode).toUpperCase();
    if (keyword) {
      const re = { $regex: escRe(keyword), $options: 'i' };
      query.$or = [{ title: re }, { detail: re }, { note: re }, { packCode: re }];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(pageSize, 10) || 100, 1), 500);

    const [list, total, summary] = await Promise.all([
      TaskNote.find(query)
        .sort({ status: 1, sortOrder: 1, createdAt: 1 })
        .skip((pageNum - 1) * size)
        .limit(size)
        .lean(),
      TaskNote.countDocuments(query),
      TaskNote.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);

    // 本页任务关联的卡包，现在的编号长什么样（一次聚合，不逐条查）
    const packs = [...new Set(list.map((r) => r.packCode).filter(Boolean))];
    const statMap = {};
    if (packs.length) {
      const stat = await CardCatalog.aggregate([
        { $match: { packCode: { $in: packs } } },
        {
          $group: {
            _id: '$packCode',
            total: { $sum: 1 },
            // 三位补零的条数（如 DL1-001）
            padded: { $sum: { $cond: [{ $regexMatch: { input: '$code', regex: /-\d{3}$/ } }, 1, 0] } },
          },
        },
      ]);
      for (const s of stat) {
        statMap[s._id] = { total: s.total, padded: s.padded, fixed: s.padded === s.total };
      }
    }
    for (const r of list) r.packState = (r.packCode && statMap[r.packCode]) || null;

    const counts = { pending: 0, doing: 0, done: 0 };
    for (const s of summary) if (s._id in counts) counts[s._id] = s.n;
    counts.total = counts.pending + counts.doing + counts.done;

    res.json({ list, total, page: pageNum, pageSize: size, counts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/task-notes — 新建任务
router.post('/', auth, async (req, res) => {
  try {
    const { title, detail = '', category = '编号问题', packCode = '', sortOrder = 0 } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: '标题不能为空' });
    const doc = await TaskNote.create({
      title: String(title).trim(),
      detail,
      category,
      packCode: String(packCode || '').trim().toUpperCase(),
      sortOrder,
    });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /v1/api/task-notes/:id — 改状态 / 备注 / 内容
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, detail, category, packCode, status, note, sortOrder } = req.body || {};
    const upd = {};
    if (title !== undefined) upd.title = title;
    if (detail !== undefined) upd.detail = detail;
    if (category !== undefined) upd.category = category;
    if (packCode !== undefined) upd.packCode = String(packCode || '').trim().toUpperCase();
    if (note !== undefined) upd.note = note;
    if (sortOrder !== undefined) upd.sortOrder = sortOrder;
    if (status !== undefined) {
      upd.status = status;
      // 完成时间跟着状态走；只改备注时不传 status，时间不动
      upd.doneAt = status === 'done' ? new Date() : null;
    }
    const doc = await TaskNote.findByIdAndUpdate(req.params.id, { $set: upd }, { new: true });
    if (!doc) return res.status(404).json({ error: '任务不存在' });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /v1/api/task-notes/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const r = await TaskNote.findByIdAndDelete(req.params.id);
    if (!r) return res.status(404).json({ error: '任务不存在' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
