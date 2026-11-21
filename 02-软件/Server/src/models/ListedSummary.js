const mongoose = require('mongoose');

/**
 * 已上架汇总 — 按 code+rarity+condition+异画 四维聚合
 * 与 ListedCard 实时同步（唯一写入方是 routes/listed-cards/index.js 的 syncSummary）
 *
 * 列名注意：`altLabel` 这一列存的是 **ListedCard.altArt（异画）**，不是 ListedCard.altLabel。
 * 名字是历史遗留，但这张表目前没有任何读取方（前端只 POST /listed-cards，GET /stats 读的是
 * ListedCard 自己），所以留着旧名、把话写在这儿，比改列名更少动干戈。
 */
const listedSummarySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },  // code|rarity|condition|异画
  code: { type: String, required: true },
  rarity: { type: String, default: '' },
  condition: { type: String, default: '' },
  altLabel: { type: String, default: '' },               // 存的是 ListedCard.altArt（异画），见文件头
  quantity: { type: Number, default: 0 },                // 当前汇总数量
}, { timestamps: true });

listedSummarySchema.index({ code: 1 });
listedSummarySchema.index({ quantity: -1 });

module.exports = mongoose.model('ListedSummary', listedSummarySchema);
