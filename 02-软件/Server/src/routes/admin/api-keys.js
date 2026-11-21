/**
 * 豆包 API 钥匙管理 — 后台管理（/v1/api/admin/api-keys，authAdmin）
 *
 * GET    /              列表（apiKey 掩码 + 每把聚合用量）
 * POST   /              新增（isDefault 互斥，全局唯一）
 * PUT    /:id           修改（apiKey 留空=保持不变）
 * DELETE /:id           删除（用量日志保留；删默认则自动顶替第一把可用钥匙）
 * POST   /:id/test      测试钥匙连通性（最小图，写 source='test' 日志）
 * POST   /:id/default   设为默认（互斥）
 * GET    /stats         总览：总量 + 近30天按日
 * GET    /users         绑定账号选人列表（id / nickname / role）
 */
const express = require('express');
const router = express.Router();
const authAdmin = require('../../middleware/authAdmin');
const User = require('../../models/User');
const ApiKey = require('../../models/ApiKey');
const VisionUsageLog = require('../../models/VisionUsageLog');
const { callArkVision } = require('../../services/arkVisionService');

const round = (n) => Math.round(n * 10000) / 10000;

/** 掩码 apiKey：前4 + **** + 后4（太短则整段 ****） */
const maskKey = (k) => {
  if (!k) return '';
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '****' + k.slice(-4);
};

/** 16x16 白色 JPEG（测试用最小图，Ark 要求最小 14px，base64） */
const TEST_IMAGE_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKAP/2Q==';

/** isDefault 互斥：把其他钥匙的 default 全部取消 */
const unsetOtherDefault = async (exceptId) => {
  await ApiKey.updateMany({ _id: { $ne: exceptId } }, { $set: { isDefault: false } });
};

/** 若当前没有 enabled 的默认钥匙，自动把第一把 enabled 设为默认 */
const ensureDefault = async () => {
  const def = await ApiKey.findOne({ isDefault: true, enabled: true });
  if (def) return;
  const first = await ApiKey.findOne({ enabled: true }).sort({ createdAt: 1 });
  if (first) {
    await ApiKey.updateMany({ _id: { $ne: first._id } }, { $set: { isDefault: false } });
    await ApiKey.updateOne({ _id: first._id }, { $set: { isDefault: true } });
  }
};

// GET /v1/api/admin/api-keys — 钥匙列表 + 每把聚合用量
router.get('/', authAdmin, async (req, res) => {
  try {
    const keys = await ApiKey.find({}).sort({ isDefault: -1, createdAt: 1 }).lean();

    const agg = keys.length
      ? await VisionUsageLog.aggregate([
          { $match: { keyId: { $in: keys.map((k) => k._id) } } },
          {
            $group: {
              _id: '$keyId',
              tokens: { $sum: '$tokens' },
              calls: { $sum: 1 },
              costYuan: { $sum: '$costYuan' },
            },
          },
        ])
      : [];
    const usageMap = Object.fromEntries(agg.map((a) => [String(a._id), a]));

    // 收集所有钥匙绑定的账号 id（兼容历史单值 ownerId）
    const allOwnerIds = [
      ...new Set(
        keys
          .flatMap((k) =>
            k.ownerIds && k.ownerIds.length ? k.ownerIds : k.ownerId ? [k.ownerId] : []
          )
          .filter(Boolean)
      ),
    ];
    const users = allOwnerIds.length ? await User.find({ id: { $in: allOwnerIds } }).select('id nickname').lean() : [];
    const nickMap = Object.fromEntries(users.map((u) => [u.id, u.nickname]));

    const list = keys.map((k) => {
      const u = usageMap[String(k._id)];
      const ownerIds = k.ownerIds && k.ownerIds.length ? k.ownerIds : k.ownerId ? [k.ownerId] : [];
      return {
        _id: k._id,
        name: k.name,
        maskedKey: maskKey(k.apiKey),
        apiUrl: k.apiUrl,
        model: k.model,
        unitPricePerK: k.unitPricePerK,
        ownerIds,
        ownerNicknames: ownerIds.map((id) => nickMap[id]).filter(Boolean),
        enabled: k.enabled,
        isDefault: k.isDefault,
        lastTestedAt: k.lastTestedAt,
        lastTestOk: k.lastTestOk,
        note: k.note,
        usage: {
          tokens: u?.tokens || 0,
          calls: u?.calls || 0,
          costYuan: round(u?.costYuan || 0),
        },
      };
    });

    res.json({ list, total: list.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/admin/api-keys — 新增钥匙
router.post('/', authAdmin, async (req, res) => {
  try {
    const { name, apiKey, apiUrl, model, unitPricePerK, ownerIds, ownerId, enabled, isDefault, note } = req.body || {};
    if (!apiKey || !String(apiKey).trim()) {
      return res.status(400).json({ error: 'apiKey required' });
    }
    const doc = await ApiKey.create({
      name: name || '',
      apiKey: String(apiKey).trim(),
      apiUrl: apiUrl || undefined,
      model: model || undefined,
      unitPricePerK: unitPricePerK !== undefined ? Number(unitPricePerK) : undefined,
      ownerIds: Array.isArray(ownerIds) ? ownerIds.filter(Boolean) : ownerId ? [ownerId] : [],
      enabled: enabled !== undefined ? !!enabled : true,
      isDefault: isDefault === true,
      note: note || '',
    });
    if (doc.isDefault) await unsetOtherDefault(doc._id);
    res.json({ id: doc._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /v1/api/admin/api-keys/:id — 修改钥匙（apiKey 留空=保持不变）
router.put('/:id', authAdmin, async (req, res) => {
  try {
    const key = await ApiKey.findById(req.params.id);
    if (!key) return res.status(404).json({ error: 'ApiKey not found' });
    const { name, apiKey, apiUrl, model, unitPricePerK, ownerIds, ownerId, enabled, isDefault, note } = req.body || {};

    if (name !== undefined) key.name = name;
    if (apiKey && String(apiKey).trim()) key.apiKey = String(apiKey).trim();
    if (apiUrl !== undefined) key.apiUrl = apiUrl || undefined;
    if (model !== undefined) key.model = model || undefined;
    if (unitPricePerK !== undefined) key.unitPricePerK = Number(unitPricePerK);
    if (ownerIds !== undefined) key.ownerIds = (Array.isArray(ownerIds) ? ownerIds : []).filter(Boolean);
    else if (ownerId !== undefined) key.ownerIds = ownerId ? [ownerId] : [];
    if (enabled !== undefined) key.enabled = !!enabled;
    if (note !== undefined) key.note = note;

    await key.save();
    if (isDefault === true) await unsetOtherDefault(key._id);
    // 禁用了默认钥匙 → 自动顶替
    if (key.isDefault && !key.enabled) await ensureDefault();
    res.json({ id: key._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /v1/api/admin/api-keys/:id — 删除钥匙（用量日志保留）
router.delete('/:id', authAdmin, async (req, res) => {
  try {
    const key = await ApiKey.findByIdAndDelete(req.params.id);
    if (!key) return res.status(404).json({ error: 'ApiKey not found' });
    if (key.isDefault) await ensureDefault();
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/admin/api-keys/:id/test — 测试钥匙连通性
router.post('/:id/test', authAdmin, async (req, res) => {
  try {
    const key = await ApiKey.findById(req.params.id);
    if (!key) return res.status(404).json({ error: 'ApiKey not found' });

    const started = Date.now();
    const result = await callArkVision({
      apiKey: key.apiKey,
      apiUrl: key.apiUrl,
      model: key.model,
      imageDataUrl: TEST_IMAGE_DATA_URL,
      prompt: 'reply OK',
    });

    await ApiKey.updateOne({ _id: key._id }, { $set: { lastTestedAt: new Date(), lastTestOk: true } });
    await VisionUsageLog.create({
      keyId: key._id,
      keyName: key.name,
      ownerId: req.user.id,
      tokens: result.totalTokens,
      costYuan: round((result.totalTokens / 1000) * (key.unitPricePerK || 0)),
      source: 'test',
      ok: true,
      latencyMs: result.latencyMs,
    });
    res.json({ ok: true, status: 200, latencyMs: result.latencyMs, model: key.model, tokens: result.totalTokens });
  } catch (e) {
    const key = await ApiKey.findById(req.params.id).catch(() => null);
    if (key) {
      await ApiKey.updateOne({ _id: key._id }, { $set: { lastTestedAt: new Date(), lastTestOk: false } });
      await VisionUsageLog.create({
        keyId: key._id,
        keyName: key.name,
        ownerId: req.user.id,
        tokens: 0,
        costYuan: 0,
        source: 'test',
        ok: false,
        latencyMs: 0,
        error: String(e.message || e).slice(0, 300),
      });
    }
    res.status(502).json({
      ok: false,
      status: e.response?.status || 0,
      model: key?.model || '',
      error: String(e.message || e).slice(0, 300),
    });
  }
});

// POST /v1/api/admin/api-keys/:id/default — 设为默认
router.post('/:id/default', authAdmin, async (req, res) => {
  try {
    const key = await ApiKey.findById(req.params.id);
    if (!key) return res.status(404).json({ error: 'ApiKey not found' });
    await unsetOtherDefault(key._id);
    await ApiKey.updateOne({ _id: key._id }, { $set: { isDefault: true } });
    res.json({ default: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/admin/api-keys/stats — 总览：总量 + 近30天按日 + 按钥匙按日
router.get('/stats', authAdmin, async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 29);
    since.setHours(0, 0, 0, 0);

    const [totals, perKey, perDay, perKeyDay] = await Promise.all([
      VisionUsageLog.aggregate([
        { $group: { _id: null, tokens: { $sum: '$tokens' }, calls: { $sum: 1 }, costYuan: { $sum: '$costYuan' } } },
      ]),
      VisionUsageLog.aggregate([
        {
          $group: {
            _id: '$keyId',
            keyName: { $first: '$keyName' },
            tokens: { $sum: '$tokens' },
            calls: { $sum: 1 },
            costYuan: { $sum: '$costYuan' },
          },
        },
      ]),
      VisionUsageLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            tokens: { $sum: '$tokens' },
            calls: { $sum: 1 },
            costYuan: { $sum: '$costYuan' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // 按钥匙 × 日期 拆分，供趋势图按钥匙筛选
      VisionUsageLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { keyId: '$keyId', date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
            keyName: { $first: '$keyName' },
            tokens: { $sum: '$tokens' },
            calls: { $sum: 1 },
            costYuan: { $sum: '$costYuan' },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]),
    ]);

    res.json({
      totals: totals[0]
        ? { tokens: totals[0].tokens, calls: totals[0].calls, costYuan: round(totals[0].costYuan) }
        : { tokens: 0, calls: 0, costYuan: 0 },
      perKey: perKey.map((p) => ({
        keyId: String(p._id || ''),
        keyName: p.keyName || '已删除钥匙',
        tokens: p.tokens,
        calls: p.calls,
        costYuan: round(p.costYuan),
      })),
      perDay: perDay.map((d) => ({ date: d._id, tokens: d.tokens, calls: d.calls, costYuan: round(d.costYuan) })),
      perKeyDay: perKeyDay.map((d) => ({
        keyId: String((d._id && d._id.keyId) || ''),
        keyName: d.keyName || '已删除钥匙',
        date: d._id.date,
        tokens: d.tokens,
        calls: d.calls,
        costYuan: round(d.costYuan),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/admin/api-keys/users — 绑定账号选人列表
router.get('/users', authAdmin, async (req, res) => {
  try {
    const users = await User.find({}).select('id nickname role').sort({ id: 1 }).lean();
    res.json({ list: users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
