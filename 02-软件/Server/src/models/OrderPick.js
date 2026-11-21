const mongoose = require('mongoose');

/**
 * 订单位置 / 拣货清单 (order_picks)
 * 记录每张卡牌需要从哪个库存库取几张，与订单卡牌(OrderCard)关联
 * libraryCode 例: A0-000-01-0003
 */
const orderPickSchema = new mongoose.Schema({
  // ===== 关联 =====
  cardNo:     { type: String, default: '' },    // 订单内卡牌编号 orderNo-0001
  cardId:     { type: mongoose.Schema.Types.ObjectId, ref: 'OrderCard', default: null }, // 关联 order_cards 的 _id
  // 库存卡（cards 集合）自己的 _id，配库时快照下来。出库时按它删最准。
  // 用 Mixed 而**不是** ObjectId：这个值要能跟 `Card._id` 本来的类型对上 ——
  // 正式库的 _id 是 ObjectId，从 JSON 灌出来的库（如 s-lan-test）是字符串，
  // 声明成 ObjectId 会在写入时把字符串转掉，之后原生驱动就删不中。
  stockCardId: { type: mongoose.Schema.Types.Mixed, default: null },
  orderNo:    { type: String, default: '' },    // 所属订单编号

  // ===== 卡牌信息 =====
  code:       { type: String, default: '' },    // 卡牌编号
  rarity:     { type: String, default: '' },    // 罕贵度
  note:       { type: String, default: '' },    // 品相备注(凑库精确匹配, 如 78品)
  jpName:     { type: String, default: '' },    // 日文名(凑库时快照库存卡, 通过后库存卡删除仍可显示)
  cnName:     { type: String, default: '' },    // 中文名(同上)
  extCode:    { type: String, default: '' },    // 卡密(同上)
  condition:  { type: String, default: '' },    // 品相(凑库时快照库存卡, 通过后库存卡删除仍可显示)

  // ===== 位置 =====
  libraryCode: { type: String, default: '' },   // 所在库(箱子级) A0-000-01
  position:   { type: String, default: '' },    // 精确卡位(serial) A0-000-04-0005

  // ===== 数量 =====
  qty:        { type: Number, default: 1 },     // 该库取几张

  // ===== 拣卡状态 =====
  pickStatus: { type: String, enum: ['pending', 'picked'], default: 'pending' },

  // ===== 所属用户 =====
  userId: { type: String, required: true },

}, { timestamps: true });

// 索引
orderPickSchema.index({ orderNo: 1, pickStatus: 1 });
orderPickSchema.index({ cardId: 1 });
orderPickSchema.index({ stockCardId: 1 });
orderPickSchema.index({ libraryCode: 1 });

module.exports = mongoose.model('OrderPick', orderPickSchema, 'order_picks');
