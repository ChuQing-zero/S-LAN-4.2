const mongoose = require('mongoose');

/**
 * 库存编号池
 * 格式: A0-000-00(15)
 *   A = 版本前缀
 *   0 = 分区
 *   000 = 序号
 *   00 = 子序号
 *   (15) = 当前卡牌数, 显示用
 */
const stockCodeSchema = new mongoose.Schema({
  code: { type: String, unique: true, sparse: true },           // A0-000 (auto-generated)
  fullCode: { type: String, default: '' },                     // A0-000-00
  displayCode: { type: String, default: '' },                  // A0-000-00(15) 带卡牌数
  prefix: { type: String, default: 'A' },
  zone: { type: Number, default: 0 },
  seq: { type: Number, default: 1 },
  subSeq: { type: Number, default: 0 },                        // 子序号
  versionName: { type: String, default: '游戏王日文' },
  note: { type: String, default: '' },
  tags: { type: [String], default: [] },                    // 自定义关键词标签
  maxCards: { type: Number, default: 30 },
  currentCards: { type: Number, default: 0 },
  status: { type: String, enum: ['available', 'in_use', 'full', 'locked', 'pending', 'archived'], default: 'available' },
  assignedTo: { type: String, default: null },       // 分配给哪个用户ID
  libraryType: { type: String, default: '' },         // 在本地库还是云端库
  assignedAt: { type: Date, default: null },
  listingBatchId: { type: String, default: null },       // 被哪个上架批次使用（溯源）
}, { timestamps: true });

stockCodeSchema.index({ prefix: 1, zone: 1, seq: 1, subSeq: 1 });
stockCodeSchema.index({ status: 1 });
stockCodeSchema.index({ fullCode: 1 });
stockCodeSchema.index({ libraryType: 1, assignedTo: 1, status: 1 });

stockCodeSchema.pre('save', function(next) {
  const pz = `${this.prefix}${this.zone}`;
  const seqStr = String(this.seq).padStart(3,'0');
  const subStr = String(this.subSeq).padStart(2,'0');
  this.code = `${pz}-${seqStr}-${subStr}`;
  this.fullCode = this.code;
  this.displayCode = this.code;
  // archived/locked/pending 不自动改状态
  if (this.status !== 'archived' && this.status !== 'locked' && this.status !== 'pending') {
    if (this.currentCards >= this.maxCards) this.status = 'full';
    else if (this.currentCards > 0) this.status = 'in_use';
  }
  next();
});

module.exports = mongoose.model('StockCode', stockCodeSchema);
