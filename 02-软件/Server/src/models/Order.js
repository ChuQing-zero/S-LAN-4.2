const mongoose = require('mongoose');

// 订单通过操作人记录（回溯是谁处理通过）
const passOperatorSchema = new mongoose.Schema({
  userId:   { type: String, default: '' },   // 操作人ID
  nickname: { type: String, default: '' },   // 操作人昵称
  at:       { type: Date, default: null },   // 操作时间
}, { _id: false });

/**
 * 订单信息 (orders)
 * 订单编号: 18位 = 交易时间(14位 YYYYMMDDHHMMSS) + 4位随机数
 * 例: 202607212056434951 → 交易时间 2026-07-21 20:56:43, 简称 订单4951
 *
 * 状态流转: ''(空) → pending(待处理) → picking(待拣卡) → shipping(待发货) → done(已完成)
 */
const orderSchema = new mongoose.Schema({
  // ===== 订单标识 =====
  orderNo:   { type: String, required: true, unique: true },   // 18位订单编号
  shortName: { type: String, default: '' },                    // 简称 订单4951（后4位）

  // ===== 时间 =====
  tradeTime: { type: Date, default: null },      // 交易时间（从订单编号前14位解析）

  // ===== 状态 =====
  status: {
    type: String,
    enum: ['', 'pending', 'picking', 'shipping', 'done'],
    default: ''
  },

  // ===== 买家信息 =====
  buyerInfo: {
    name:    { type: String, default: '' },   // 买家昵称
    phone:   { type: String, default: '' },   // 联系电话
    address: { type: String, default: '' },   // 收货地址
    note:    { type: String, default: '' },   // 买家备注
  },

  // ===== 汇总 =====
  totalCards:  { type: Number, default: 0 },      // 卡牌总张数
  allPicked:   { type: Boolean, default: false }, // 是否已全部拣卡
  parsed:      { type: Boolean, default: false }, // 是否执行过凑库解析（重新进入清空后回到 false）

  // ===== 通过操作人记录（通过时写入，回溯是谁处理） =====
  passPicked:   { type: passOperatorSchema, default: null },  // 待处理→待拣卡 操作人
  passShipping: { type: passOperatorSchema, default: null },  // 待拣卡→待发货 操作人
  passDone:     { type: passOperatorSchema, default: null },  // 待发货→已完成 操作人

  // ===== 物流信息（进入待发货前必填） =====
  courierCode: { type: String, default: '' },  // 快递码
  pickupCode:  { type: String, default: '' },  // 取件码

  // ===== 拍照留痕 =====
  photoCount: { type: Number, default: 0 },    // 已拍照留痕张数（随上传/删除实时同步，刷新不丢）

  // ===== 所属用户 =====
  userId: { type: String, required: true },

}, { timestamps: true });   // 自动 createdAt(创建时间) / updatedAt

// 索引
orderSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Order', orderSchema, 'orders');
