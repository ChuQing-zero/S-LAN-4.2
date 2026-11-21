const mongoose = require('mongoose');

/**
 * 订单拍照留痕 (order_photos)
 * 发货前拍照记录，图片文件存 uploads/order-photos/，文件名 = 订单编号-序号.jpg
 * index 与订单编号唯一绑定（{orderNo, index} 唯一索引）
 */
const orderPhotoSchema = new mongoose.Schema({
  orderNo:  { type: String, required: true },     // 绑定订单编号
  index:    { type: Number, default: 1 },         // 序号 1,2,3...
  filename: { type: String, default: '' },        // 文件名 订单号-序号.jpg
  path:     { type: String, default: '' },        // 可访问路径 /uploads/order-photos/订单号-序号.jpg

  // ===== 上传人 =====
  userId: { type: String, required: true },

}, { timestamps: true });

// 图片地址与订单编号绑定（同一订单内序号唯一）
orderPhotoSchema.index({ orderNo: 1, index: 1 }, { unique: true });

module.exports = mongoose.model('OrderPhoto', orderPhotoSchema, 'order_photos');
