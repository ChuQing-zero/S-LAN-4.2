const mongoose = require('mongoose');

/**
 * 上架执行队列 — 解析完成后持久化每条卡牌的执行状态
 *
 * 每条文档 = 一张待上架卡牌（合并后），包含流程分配、数量、执行状态
 * 同一个 batchId 下的所有文档组成一个"批次"
 */
const listingQueueSchema = new mongoose.Schema({
  // ===== 批次标识 =====
  batchId: { type: String, required: true },

  // ===== 卡牌信息 =====
  index:      { type: Number, required: true },   // 序号 1, 2, 3...
  code:       { type: String, default: '' },       // 编号 QCAC-JP001
  rarity:     { type: String, default: '' },       // 罕贵度 SER/UR/SR/N...
  altLabel:   { type: String, default: '' },       // 异画
  condition:  { type: String, default: '' },       // 品相 流通品相/有瑕疵/有损伤
  note:       { type: String, default: '' },       // 备注 78品/9品...
  packCode:   { type: String, default: '' },       // 所属包 = 编号前缀 QCAC / PHNI（详情页按它分堆）
  serialList: { type: [String], default: [] },     // 这一行涉及的实体卡位号 A0-000-00-0001（详情逐份列出/逐份删除靠它）

  // ===== 数量 =====
  existQty:   { type: Number, default: 0 },        // 初始数量（已上架已有的）
  addQty:     { type: Number, default: 1 },        // 增加数量（本次新增）
  totalQty:   { type: Number, default: 1 },        // 最终数量（发往模拟器）

  // ===== 流程 =====
  flow:       { type: String, default: 'A' },      // 流程 A/B/C

  // ===== 输出参数（VM执行后回写）=====
  // 模拟器跑完会吐出 14 项（见 auto-execute-vm.js 的 allOutputs），这里一项不落全存下来。
  // 从前只存 4 项，另外 10 项算完就扔，页面上「详细」按钮点开是空的 —— 现在跑过的都查得回。
  outputJhj:         { type: String, default: '' },   // 集换价(输出)
  outputLowest:      { type: String, default: '' },   // 最低价(输出)
  outputPrice:       { type: String, default: '' },   // 价格(输出) —— 第三个参考数，不是上架价
  outputCode:        { type: String, default: '' },   // 编号(输出)
  outputRarity:      { type: String, default: '' },   // 罕贵度(输出)
  outputCnName:      { type: String, default: '' },   // 中文卡名(输出)
  outputCnAlias:     { type: String, default: '' },   // 中文别名(输出)
  outputLang:        { type: String, default: '' },   // 语种(输出)
  outputGameVersion: { type: String, default: '' },   // 游戏版本(输出)
  outputRows:        { type: String, default: '' },   // 行数(输出)
  outputQty:         { type: String, default: '' },   // 数量(输出)
  outputNote:        { type: String, default: '' },   // 备注(输出)
  outputInputCode:   { type: String, default: '' },   // 输入框编号(输出)
  outputStatus:      { type: String, default: '' },   // 运行状态(输出)

  // ===== 上架价格（独立字段）=====
  // 跟 outputPrice「价格(输出)」不是一回事：这个是**人定的、要挂到店里去的价**，
  // 跑完只用集换价 outputJhj 给它打底，而且**仅在为空时**打 —— 用户手改过的价，重跑不许冲掉。
  listingPrice: { type: String, default: '' },

  // ===== 执行状态 =====
  // running = 这一张正在模拟器上跑。它有两个用处：
  //   ① 别人（另一台设备/另一个页面）一眼能看出「这批正跑着」，而不是看到一堆 pending 以为没跑；
  //   ② 进程崩了之后，停在 running 的那一行就是「上次没跑完」的痕迹 —— 能重跑，但不会自动变回 pending。
  itemStatus: {
    type: String,
    enum: ['pending', 'running', 'success', 'failed'],
    default: 'pending'
  },
  errorMessage: { type: String, default: '' },

  // 这一行**已经重试了几次**（不含第一遍；V1.2.108）。
  // 为什么单开一个字段：重试的中间那些遍**不写 itemStatus**（一写 failed，前端当场按终态渲染、
  // 接口也不再捞它，第二遍没地方落脚），所以整张卡从进来到出结论一直是 running ——
  // 「它已经试过一遍了」这件事只有这儿看得见。崩在第二遍上时，这一行看着只是个 running，
  // 少了这个数就分不出"刚进来"和"试过一遍又崩了"。
  // 跑成时它是「试了几次才成」，最终失败时是「试了几次才红」，都不回零；
  // 只有这一行**这一趟开跑**时才清回 0（见 auto-execute-vm.js）。
  重试次数: { type: Number, default: 0 },

  // ===== 所属用户 =====
  userId: { type: String, required: true },

}, { timestamps: true });

// 索引
listingQueueSchema.index({ batchId: 1, index: 1 });
listingQueueSchema.index({ userId: 1, batchId: 1 });
listingQueueSchema.index({ userId: 1, itemStatus: 1 });

module.exports = mongoose.model('ListingQueue', listingQueueSchema);
