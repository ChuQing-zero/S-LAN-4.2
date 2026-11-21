const mongoose = require('mongoose');

/**
 * 目录缺失编号 —— "AI 认出来了，但 cardcatalogs 里没有这张卡的资料"
 *
 * 用途：攒一份"该补哪个卡包资料"的清单。
 *   code        —— 编号，唯一索引。同一张卡重复出现只留一行（这就是"只记一次"）
 *   codePrefix  —— 第一个横杠之前的部分（DL1 / PH / EE2），按它分组补资料
 *   rarity      —— 罕贵度（识别上传页手选的，客户端识别时带上来）
 *   出现次数 / 首次 / 最近 —— 判断哪些更值得先补
 *
 * 「是否已经补上」不在这里存开关 —— 接口返回清单时实时去 CardCatalog 比一次，
 * 目录里有了就自动变绿，不会出现"标记说补好了其实没补"的假绿。
 */
const missingCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    codePrefix: { type: String, default: '' },
    versionId: { type: Number, default: null },
    versionName: { type: String, default: '' },
    rarity: { type: String, default: '' },
    seenCount: { type: Number, default: 1 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'added', 'ignored'], default: 'pending' },
    note: { type: String, default: '' },
  },
  { timestamps: true, collection: 'missingcodes' }
);

missingCodeSchema.index({ codePrefix: 1, status: 1 });
missingCodeSchema.index({ lastSeenAt: -1 });

module.exports = mongoose.model('MissingCode', missingCodeSchema);
