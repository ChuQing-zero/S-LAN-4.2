const mongoose = require('mongoose');
const CardCatalog = require('./CardCatalog');

/**
 * 卡牌信息记录 —— 「这张卡要处理」的清单（纯红底 + 绿色「信息已登记」）
 *
 * 两个入口，一个状态：
 *   · 自动（source=auto）—— 编号在 cardcatalogs 里查不到（DL1-010 这种），
 *     在「编号被录进来」的写路径上自动记一条，见下面 autoRegister()。
 *   · 手动（source=manual）—— AI 认出来了，但人看着不对，自己点「信息登记」。
 * 界面上不做区分：两者都是纯红底 + 绿色「信息已登记」。
 *
 * 粒度：按 **(编号, 罕贵度)** 唯一 —— 标了 N 就只有 N 变红，标了 NPR 就只有 NPR 变红。
 *       同一个编号的不同印刷各修各的，这样后台才能"精准查到错误点"。
 *       ⚠️ 这条粒度是 V1.2.47 才有的，之前是**只按编号**（一个编号一错全错）。
 *       老记录一律迁成 `rarity: ''` = **不限罕贵度**，行为跟改之前一模一样。
 *
 * `rarity: ''` 是一个**通配**值，不是"罕贵度未知"：
 *   查 (code, rarity) 时命中条件是「存在 {code, ''}」**或**「存在 {code, rarity}」。
 *   自动登记永远写通配 —— 理由见 autoRegister() 上面那段。
 *
 * 前端不往 cards 文档上写任何字段：列表接口每次实时查这张表比对。
 * 所以后台手动删掉一条，前端刷新一下自动变回正常卡，不需要去动任何一张卡。
 * 「已登记 ⇒ 纯红底」是同一个字段推出来的，不是两套状态 ——
 * 删掉记录 = 底色和绿块一起还原成正常卡。
 *
 * 保留 jpName / cnName / img 三个**登记当时的快照**：后台列表里不查目录也能一眼看出
 * 这张卡当时长什么样、要修什么 —— 跟 MissingCode 靠实时查目录拿名字不一样，
 * 因为这里的重点是"我当时看到的那个错"，目录后来改了反而看不到问题了。
 *
 * 沿革（2026-09-29）：旧版这里跟一个「每次拉列表实时查目录算淡红」的独立状态并存，
 * 两个状态各画各的、会互相打架（一张卡可以既是淡红又不是已登记）。现在变色只认这张表，
 * 那套独立逻辑已从 routes/libraries 里删掉。
 * 沿革（2026-10-01，V1.2.46）：底色从淡红 #FFE8E8 改成纯红 #FF0000，同容器文字整体翻白。
 * 沿革（2026-10-01，V1.2.47）：粒度从「按编号」改成「按编号 + 罕贵度」。
 */
const cardMarkSchema = new mongoose.Schema(
  {
    // ⚠️ 这里**不能**再加 unique —— 唯一性由下面的 {code, rarity} 复合索引负责。
    // 一个编号现在可以有多条记录（N 一条、NPR 一条）。
    code: { type: String, required: true },
    // 罕贵度。**空串 = 不限罕贵度（通配）**，见文件顶上那段。
    // 归一化口径跟 code 一致：去空格 + 转大写，其余一字不差
    // （实测库里 rarity 没有 SER(1) 这类带后缀的历史写法，所以不需要额外的归一化）。
    rarity: { type: String, default: '' },
    libraryCode: { type: String, default: '' },   // 最早登记时所在的库
    jpName: { type: String, default: '' },        // 登记当时的卡名快照
    cnName: { type: String, default: '' },
    img: { type: String, default: '' },           // 登记当时的卡图快照
    note: { type: String, default: '' },          // 人工处理时写（改完什么了 / 什么问题）
    markedBy: { type: String, default: '' },      // 谁登记的（users.id）；自动登记为空
    // 这条是机器自动记的还是人点的。**不参与任何显示**，纯粹给「补齐 + 清理」用：
    // 以后要批量挑出"机器记的"、或者统计"目录还缺多少个编号"，靠它分得开。
    // 老记录没有这个字段，读的时候按 manual 兜底（见 routes/card-marks 的列表）。
    source: { type: String, enum: ['auto', 'manual'], default: 'manual' },
    markedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'cardmarks' }
);

// 唯一的键就是 (编号, 罕贵度)。索引同步在 src/index.js 的 syncIndexes 里做，不用手工建。
cardMarkSchema.index({ code: 1, rarity: 1 }, { unique: true });
cardMarkSchema.index({ markedAt: -1 });

const norm = (v) => String(v || '').trim().toUpperCase();

/**
 * 自动登记 —— 编号在目录里查不到就记一条，查得到就什么都不做。
 *
 * 判定口径刻意跟旧版"变色"那条**一模一样：只按 code 严格匹配，不看 rarity**。
 * DL1~DL5 那批卡面号跟目录号错位（卡面 DL1-085 ↔ 目录 DL1-85），按 code 就是查不到 ——
 * 这正是要标出来的"数据有问题"，所以它们照旧会被记进来。
 * 要是改成 faceCode 口径，这批就"命中"了、不会登记，那批卡就再也没人管了。
 *
 * 同理**记下来的记录永远是通配 `rarity: ''`**：这条的含义是「这个编号整个查不到」，
 * 是**编号级**的问题，不是某一档印刷的问题。真按罕贵度分档的是**手动**登记那条路
 * （routes/card-marks 的 POST），人看着哪一档不对才标哪一档。
 *
 * 用 $setOnInsert：**绝不覆盖已有记录**。人已经手点过的那条，note / markedBy / source
 * 全部原样保留 —— 自动登记只负责"补上没人记过的编号"，不负责改写人的判断。
 *
 * 只在**写路径**调用（识别出编号 / 新建卡 / 改编号）。
 * 绝对不要在拉列表的读接口里调 —— 那样"打开页面"就会变成写库，刷新一次写几百条，
 * 并发下还会互相覆盖。
 *
 * @param {string} code  编号（内部会规范化：去空格 + 转大写）
 * @param {object} info  { libraryCode, jpName, cnName, img } 都可选，只用于首次建档的快照
 * @returns {Promise<boolean>} 真的新登记了一条才返回 true
 */
cardMarkSchema.statics.autoRegister = async function (code, info = {}) {
  const c = norm(code);
  if (!c || c === '...' || c === '---') return false;

  const hit = await CardCatalog.findOne({ code: c }).select('_id').lean();
  if (hit) return false;

  const r = await this.updateOne(
    { code: c, rarity: '' },
    {
      $setOnInsert: {
        code: c,
        rarity: '',
        libraryCode: String(info.libraryCode || ''),
        jpName: String(info.jpName || ''),
        cnName: String(info.cnName || ''),
        img: String(info.img || ''),
        note: '',
        markedBy: '',
        source: 'auto',
        markedAt: new Date(),
      },
    },
    { upsert: true }
  );
  return !!r.upsertedCount;
};

module.exports = mongoose.model('CardMark', cardMarkSchema);
