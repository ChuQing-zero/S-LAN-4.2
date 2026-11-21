const mongoose = require('mongoose');

/**
 * 上架批次档案 (listingbatches)
 * 一次「开始解析」= 一批。批次号由 ListingQueue 那边生成（如 26-10-2-1），一批可跨多个包。
 *
 * 这份档案有两个用处：
 *   ① snapshot —— 解析**之前**把被锁的那几个库原样抄下来，撤回时照它还原。
 *      不抄的话撤回只能一律写回 pending，库原来在本地库(in_use)还是满了(full) 就丢了。
 *   ② state —— 这批走到哪一步了。归档从此由人工点「确认完成」，不再看队列里跑绿没跑绿。
 */
const listingBatchSchema = new mongoose.Schema({
  // ===== 批次标识 =====
  batchId: { type: String, required: true, unique: true },   // 26-10-2-1

  // ===== 流程状态 =====
  state: {
    type: String,
    enum: ['parsing', 'listed', 'reverted'],
    default: 'parsing',                                       // parsing=已解析待上架 / listed=已上架 / reverted=已撤回
  },

  // ===== 解析前的库快照（撤回的唯一依据）=====
  // 解析时被锁的每个库一条，字段就是当时的原样。顺序无关，按 fullCode 定位。
  snapshot: [{
    _id: false,
    fullCode:     { type: String, default: '' },   // 库编号 A0-000-00
    status:       { type: String, default: '' },   // 解析前状态 available/in_use/full...
    libraryType:  { type: String, default: '' },   // 解析前归属 local/cloud
    assignedTo:   { type: String, default: null }, // 解析前归属人
    currentCards: { type: Number, default: 0 },    // 解析前库内卡数
    listingBatchId: { type: String, default: null },// 解析前挂的批次号（正常是 null）
  }],

  // ===== 包级「确认完成」（V1.2.75）=====
  // 这批里哪些**包**已经被人工核对、从「待上架包」挪进「已上架包」了。
  // 只是标记：库、卡位号、库锁一律不动 —— 那是 `state='listed'`（整批归档）那一步才做的。
  // 存子文档是为了留住「完成于」这个时刻（原型上那枚 `done: '刚完成'` 的正式版）。
  // ⚠️ 它**不是内容快照**，只记包名+时间；行被删过的话，跟"确认那一刻"不完全一致。
  donePacks: [{
    _id: false,
    pack: { type: String, default: '' },           // 包名，算法见 routes/listings/queues.js 的 取包名
    at:   { type: Date, default: Date.now },       // 搬包的时刻
  }],

  // ===== 规模统计（列表页/弹窗文案直接用，省得现算）=====
  stats: {
    libCount:  { type: Number, default: 0 },       // 涉及几个库
    packCount: { type: Number, default: 0 },       // 涉及几个包（按编号前缀去重）
    rowCount:  { type: Number, default: 0 },       // 解析出几行（= ListingQueue 条数）
    cardCount: { type: Number, default: 0 },       // 本次上架实体卡张数（各行 addQty 之和）
  },

  // ===== 连续失败计数（V1.2.106）=====
  // 「一键上架」连着几张没跑成。用来做熔断：连着到阈值就自动停下 + 弹窗警告。
  // 挂在**批次**上而不是内存里，是因为整批 = 前端一个包发一次请求（V1.2.104），
  // 计数必须跨请求活着 —— 用户要的正是「跨包连着数，换包不清零」。
  // 任意一张跑成 → 归零；新开一趟（前端不带 `连败继续`）→ 也归零。
  连败: { type: Number, default: 0 },

  // ===== 时间点 =====
  completedAt: { type: Date, default: null },      // 点「确认完成」的时刻
  revertedAt:  { type: Date, default: null },      // 撤回的时刻

  // ===== 归档那一次的审计戳 =====
  // 归档会压实卡位号、清原图链接，撤回想还原就得找回当时那份卡片快照
  // （`Storage/carduniques-backup/<stamp>/cards-before-<batchId>.json`）。
  // 只到秒，所以同一秒的两批会共用同一个目录 —— 文件名里的批次号负责区分。
  auditStamp: { type: String, default: '' },

  // ===== 所属用户 =====
  userId: { type: String, required: true },

}, { timestamps: true });

// 索引
listingBatchSchema.index({ userId: 1, state: 1 });
listingBatchSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ListingBatch', listingBatchSchema);
