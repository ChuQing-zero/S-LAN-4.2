const mongoose = require('mongoose');

/**
 * 豆包视觉识别用量明细 — 每次调用一条
 *
 * keyId/keyName 存钥匙快照（钥匙删除后历史仍可显示）；
 * ownerId 记使用账号 id（识别时取 req.user.id）；
 * costYuan = tokens/1000 × key.unitPricePerK（估算费用）；
 * source: single=识别上传 / batch=批量识别 / test=后台测试。
 *
 * promptKey   —— 这次用的是哪一套提示词方案（"版本key:方案id"，如 1:v2-coverage）
 * recognized  —— 这次 AI 有没有给出一个合法编号（false 就是"失败返回"）
 * catalogHit  —— AI 给出的编号在目录里查到了没（用来分辨"提示词差"还是"资料缺"）
 * 这三个字段给「提示词方案」页的成功率对比用；改造前的旧记录没有它们，
 * 对比时只统计新记录，旧记录不算进去。
 */
const visionUsageLogSchema = new mongoose.Schema(
  {
    keyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApiKey', default: null },
    keyName: { type: String, default: '' },
    ownerId: { type: String, default: '' },
    engine: { type: String, default: 'doubao' },
    tokens: { type: Number, default: 0 },
    costYuan: { type: Number, default: 0 },
    source: { type: String, enum: ['single', 'batch', 'test'], default: 'single' },
    ok: { type: Boolean, default: true },
    latencyMs: { type: Number, default: 0 },
    error: { type: String, default: '' },
    promptKey: { type: String, default: '' },
    recognized: { type: Boolean, default: false },
    catalogHit: { type: Boolean, default: false },
    // '' / 'code'（目录号直接命中）/ 'faceCode'（靠卡面编号兜到的，只有 DL1~DL5 会走到）
    codeMatchedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

visionUsageLogSchema.index({ keyId: 1, createdAt: 1 });
visionUsageLogSchema.index({ ownerId: 1, createdAt: 1 });
visionUsageLogSchema.index({ promptKey: 1, createdAt: 1 });

module.exports = mongoose.model('VisionUsageLog', visionUsageLogSchema);
