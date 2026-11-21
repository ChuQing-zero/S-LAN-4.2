const mongoose = require('mongoose');

/**
 * 豆包 API 钥匙 — 统一管理（后台管理页维护，管理员统一管）
 *
 * 钥匙与 URL 可随时更换，但共享同一个模型（model 默认统一，可单把覆盖）。
 * ownerIds 绑定账号 id 列表（User.id，'001' 风格，可多选），用于费用归因。
 * 响应中 apiKey 一律掩码返回，明文仅存后端，不再进前端包。
 */
const apiKeySchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    apiKey: { type: String, required: true },
    apiUrl: {
      type: String,
      default: 'https://ark.cn-beijing.volces.com/api/v3/responses',
    },
    model: { type: String, default: 'doubao-seed-2-0-mini-260428' },
    unitPricePerK: { type: Number, default: 0.008 }, // 元/千token，估算费用用
    ownerIds: { type: [String], default: [] }, // 绑定账号 id 列表（可多选）
    enabled: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    lastTestedAt: { type: Date, default: null },
    lastTestOk: { type: Boolean, default: false },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

apiKeySchema.index({ isDefault: 1 });

module.exports = mongoose.model('ApiKey', apiKeySchema);
