const mongoose = require('mongoose');

/**
 * 订单卡牌信息 (order_cards)
 * 每张卡牌一行，卡牌编号 = 所属订单编号 + '-' + 4位行号
 * 例: 202607212056434951-0001, -0002 ...
 *
 * code 可能带括号（异画），如 QCAC-JP019(初版)
 * parsedCode 自动剥离括号 → QCAC-JP019；altLabel 提取括号内容 → 初版
 */
const orderCardSchema = new mongoose.Schema({
  // ===== 卡牌标识 =====
  cardNo:     { type: String, required: true, unique: true },  // 订单内卡牌编号 orderNo-0001
  orderNo:    { type: String, required: true },                 // 所属订单编号
  lineNo:     { type: Number, default: 1 },                     // 行号 1,2,3...

  // ===== 卡牌信息 =====
  code:       { type: String, default: '' },   // 卡牌编号（可能带括号异画） QCAC-JP019(初版)
  parsedCode: { type: String, default: '' },   // 解析后编号 QCAC-JP019（自动剥括号）
  altLabel:   { type: String, default: '' },   // 异画名（从括号解析） 初版
  rarity:     { type: String, default: '' },   // 罕贵度 N/R/SR/UR/SER...
  qty:        { type: Number, default: 1 },    // 数量
  condition:  { type: String, default: '流通品相' }, // 品相 流通品相/有瑕疵/有损伤（解析时从匹配库存卡回填）
  note:       { type: String, default: '' },   // 备注
  // img：**恒为空**，字段留着只为不动已有文档与响应形状。
  // 原先想装「凑库匹配到的库存卡的 YGO 图」，但取的 Card.img / Card.extCode 都是死字段
  // （0.00% / 0.11% 填充，建卡时就被写死成 ''），永远拼不出东西。
  // 官方图现在由前端按 {编号}+{罕贵} 现拼、卡密问目录要（Client/src/api/cardDb.js）——
  // 不落库，因为卡密是目录的属性，存下来会随目录更新而过期。
  img:        { type: String, default: '' },
  origImg:    { type: String, default: '' },   // 原图(库存卡拍照原图) 优先显示；清库前 99.88% 有值
  matched:    { type: Boolean, default: false }, // 凑库是否匹配到库存(true=已匹配/false=缺货)，解析时回填
  missing:    { type: Number, default: 0 },    // 缺货张数(解析时回填剩余未匹配数量，0=已配齐)

  // ===== 所属用户 =====
  userId: { type: String, required: true },

}, { timestamps: true });

// 索引
orderCardSchema.index({ orderNo: 1, lineNo: 1 });
orderCardSchema.index({ parsedCode: 1 });

module.exports = mongoose.model('OrderCard', orderCardSchema, 'order_cards');
