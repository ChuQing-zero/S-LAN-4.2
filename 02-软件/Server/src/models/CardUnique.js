const mongoose = require('mongoose');

/**
 * 卡牌唯一目录 —— 一张卡一行，名字存在这里。
 *
 * 为什么要它：`cardcatalogs` 是**商品行**（一行 = 一个卡包里的一个位置），
 * 同一个卡密可能在几十个卡包里各出现一次（`89631139` 有 60 行）；
 * 而卡名是**卡**的属性，不是商品行的属性。这张表就是那个「卡」的身份表 ——
 * 名字只在这里存一份，「编号目录 / 唯一目录」两表分离的地基。
 *
 * 身份规则（用户定的，**字面实现，不要加任何聪明处理**）：
 *   · 有卡密 → 身份 = 卡密（`keyType: 'extCode'`）
 *   · 没卡密 → 身份 = 编号（`keyType: 'code'`）
 * 特别注意**不要**给 `extCode = '0'` 那种加"无效卡密回退编号" ——
 * 那会一次性把共用同一个身份的 34 行拆成 34 个身份，属于没批准的语义变更。
 * 现在这 34 行合法地共用 `extCode: '0'` 这一个身份，`/stats` 里会显式报出来。
 *
 * ---------- 四个名字从哪来（V1.2.31 起） ----------
 * 每个字段一律 **官方优先；官方没有，就去 `cardcatalogs` 里那条顶上**：
 *   · 官方日文 / 日文读音 / 官方英文 —— 官方源（ygocdb）给的
 *   · 官方简中 —— 官方源**只覆盖了不到一半**（13,813 张里 5,897 张是空的），
 *     其余是从目录三个名字列搬过来的（同一身份有多行就取第一条，不再挑）
 *   · 日文读音目录里没有这一列，所以只可能来自官方，没有就是空
 *
 * ⚠️ 子对象名字还叫 `official`（历史包袱：改它要动接口和前端一整串），
 *    但内容其实是**官方优先合并后**的那一份，**别拿它当"纯官方"用**。
 *
 * ⚠️ 目录的名字列删掉之后，这些中文名就**只此一份**了：`rebuild` 默认只增不删、
 *    也不改已存在文档，就是为了不把用户手工订正过的名字冲掉。
 *
 * 「库里现在写的 / 状态 / 建议动作」**不落这张表**，每次现算（见 services/cardReview.js）。
 * 理由和 missing-codes 里那条注释一样：落表就得写同步逻辑，改完不同步反而是 bug。
 */
const cardUniqueSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },                                  // 卡密 或 编号
    keyType: { type: String, required: true, enum: ['extCode', 'code'] },   // 有卡密用卡密，没卡密用编号

    extCode: { type: String, default: '' },   // 两个都留着，方便反查
    code: { type: String, default: '' },      // 仅当 keyType='code' 时等于 key

    // 四个名字。**每个都保证存在**，没值就是空串（不是缺字段）——
    // 页面、导出、对拍拿到的形状永远一致，前端不用到处写 `|| ''`。
    official: {
      jp: { type: String, default: '' },      // 官方日文名（官方没有则取编号目录第一条）
      ruby: { type: String, default: '' },    // 日文读音 · 假名注音（目录里没这一列，只可能来自官方）
      cn: { type: String, default: '' },      // 官方简中（官方只覆盖不到一半，其余来自编号目录）
      en: { type: String, default: '' },      // 官方英文名（官方没有时同样取编号目录第一条）
    },

    builtAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'carduniques' }
);

// 一个身份只有一行
cardUniqueSchema.index({ keyType: 1, key: 1 }, { unique: true });
cardUniqueSchema.index({ extCode: 1 });
cardUniqueSchema.index({ code: 1 });

module.exports = mongoose.model('CardUnique', cardUniqueSchema);
