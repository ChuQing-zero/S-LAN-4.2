const mongoose = require('mongoose');

/**
 * 已上架卡牌 — 记录每一次上架操作
 */
const listedCardSchema = new mongoose.Schema({
  code: { type: String, required: true },               // 卡牌编号 QCAC-JP001
  jpName: { type: String, default: '' },
  cnName: { type: String, default: '' },
  rarity: { type: String, default: '' },                  // 上架时的罕贵度
  condition: { type: String, default: '' },               // 品相
  note: { type: String, default: '' },                    // 品相备注
  altArt: { type: String, default: '' },                  // 异画
  price: { type: Number, default: 0 },                    // 上架价格
  quantity: { type: Number, default: 1 },                 // 上架数量
  serial: { type: String, default: '' },                  // 卡牌流水号
  extCode: { type: String, default: '' },                 // 卡密
  altArtIndex: { type: Number, default: null },
  altLabel: { type: String, default: '' },
  img: { type: String, default: '' },
  versionName: { type: String, default: '' },             // 游戏版本
  isJiHuan: { type: Boolean, default: false },            // 是否集换价
  sourceLibraryCode: { type: String, default: '' },       // 来源库
  userId: { type: String, required: true },               // 所属用户
}, { timestamps: true });

listedCardSchema.index({ code: 1 });
listedCardSchema.index({ userId: 1 });
listedCardSchema.index({ rarity: 1 });
listedCardSchema.index({ condition: 1 });
listedCardSchema.index({ createdAt: -1 });
listedCardSchema.index({ userId: 1, code: 1 });

module.exports = mongoose.model('ListedCard', listedCardSchema);
