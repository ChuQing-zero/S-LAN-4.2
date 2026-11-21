/**
 * 上架队列 API — ListingQueue CRUD + 锁管理
 */
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../../middleware/auth');
const ListingQueue = require('../../models/ListingQueue');
const StockCode = require('../../models/StockCode');
const ListingBatch = require('../../models/ListingBatch');
const Card = require('../../models/Card');
const OrderPick = require('../../models/OrderPick');
const { makeStamp, openAudit, readSnapshot, saveSnapshot } = require('../../services/cardAudit');
const { 标记已上架, 取消已上架 } = require('../../services/listingMarkListed');
const { syncStockCode } = require('../../services/librarySerials');
const listingLock = require('../../services/listingRunLock');

// ==================== 包名 ====================
// 包 = 卡牌编号的前缀（QCAC-JP001 → QCAC）。没有横杠就拿整串当包名。
const 取包名 = (code) => {
  const s = String(code || '').trim();
  if (!s) return '';
  return s.includes('-') ? s.split('-')[0] : s;
};

// 「一行属于哪个包」—— 跟前端 `组包`（auto-listing.vue:607-610）和 batches.js 的 `包名`
// **必须逐字一致**（三处，改一处要一起改）：前端按这个分组、按这个发「放回」，
// 后端按这个认标记，漂移了就会出现"点放回摘不掉"。
// ⚠️ 跟上面那个 取包名 不一样：那个是解析时**从编号前缀造 packCode**用的，只吃 code。
const 行的包名 = (it) => it.packCode || (String(it.code || '').split('-')[0] || '未知');

// ==================== 批次号生成 ====================
// 批次号 = yy-m-d-N。取「当天已有的最大 N」再 +1，有三个坑必须绕开：
//   ① 不能查 ListingQueue —— 撤回会把队列行删光（见下面 /:batchId/revert 的 deleteMany），
//      于是当天第一批被撤回之后 N 又回到 1，撞上 ListingBatch.batchId 的唯一索引，
//      整个 POST 500、前端弹「解析结果没能落库」，而且**当天再也解析不出新批次**。
//      档案 ListingBatch 是只增不删的，所以改查它。
//   ② 不能按 userId 过滤 —— batchId 的唯一索引是**全局**的（不是 per-user），
//      两个用户同一天各解析一次就会互相撞号。
//   ③ 不能 sort({ batchId: -1 }) —— 字符串排序下 '26-10-2-9' > '26-10-2-10'，
//      当天第 10 批开始又会撞号。所以捞出当天全部、按数值取最大。
const generateBatchId = async () => {
  const now = new Date();
  const prefix = `${String(now.getFullYear()).slice(2)}-${now.getMonth() + 1}-${now.getDate()}-`;
  const rows = await ListingBatch.find({ batchId: { $regex: `^${prefix}\\d+$` } })
    .select('batchId').lean();
  let seq = 0;
  for (const r of rows) {
    const n = parseInt(String(r.batchId).slice(prefix.length), 10);
    if (Number.isFinite(n) && n > seq) seq = n;
  }
  return `${prefix}${seq + 1}`;
};

// ==================== 保存解析结果 ====================

// POST /v1/api/listings/queues — 保存解析结果 + 锁定 StockCode
router.post('/', auth, async (req, res) => {
  try {
    const { items, flowSummary, lockedStockCodes } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' });
    }

    const lockList = (lockedStockCodes && Array.isArray(lockedStockCodes))
      ? [...new Set(lockedStockCodes.filter(Boolean))]
      : [];

    // ===== 建档顺序照 cardAudit 的规矩：先把存档落到盘上，再动手改数据 =====
    // 单机 MongoDB 没有副本集，跨集合写入没有回滚；所以「档案没写成功 → 一个字都不改」。
    // 先读一遍这几个库的现状，原样抄进 snapshot —— 这就是以后撤回的唯一依据。
    const lockedDocs = lockList.length
      ? await StockCode.find({ fullCode: { $in: lockList } }).lean()
      : [];

    const packSet = new Set(items.map(it => 取包名(it.code)));
    packSet.delete('');

    // 撞号重算：generateBatchId 已经按当天最大号 +1，正常一次就成；
    // 万一两边同时在建档（客户端双击、两个用户同秒），唯一索引会拒掉后到的那个，
    // 这里重算重试而不是把 500 丢给前端 —— 前端拿不到 batchId 只会弹「解析结果没能落库」。
    let batchId, batchDoc;
    for (let attempt = 1; ; attempt++) {
      batchId = await generateBatchId();
      try {
        batchDoc = await ListingBatch.create({
          batchId,
          userId: req.user.id,
          state: 'parsing',
          snapshot: lockedDocs.map(sc => ({
            fullCode: sc.fullCode || '',
            status: sc.status || '',
            libraryType: sc.libraryType || '',
            assignedTo: sc.assignedTo || null,
            currentCards: sc.currentCards || 0,
            listingBatchId: sc.listingBatchId || null,
          })),
          stats: {
            libCount: lockedDocs.length,
            packCount: packSet.size,
            rowCount: items.length,
            cardCount: items.reduce((n, it) => n + (it.addQty || 1), 0),
          },
        });
        break;
      } catch (e) {
        if (e && e.code === 11000 && attempt < 5) {
          console.warn('[listings/queues] 批次号撞号，重算重试:', batchId);
          continue;
        }
        throw e;
      }
    }

    // 写入 ListingQueue（档案已落盘，这里失败也不影响撤回时的依据）
    const docs = items.map((item, i) => ({
      batchId,
      index: i + 1,
      code: item.code || '',
      rarity: item.rarity || '',
      altLabel: item.altLabel || '',
      condition: item.condition || '',
      note: item.note || '',
      packCode: 取包名(item.code),
      serialList: Array.isArray(item.serialList) ? item.serialList : [],
      existQty: item.existQty || 0,
      addQty: item.addQty || 1,
      totalQty: item.totalQty || 1,
      flow: item.flow || 'A',
      itemStatus: 'pending',
      userId: req.user.id,
    }));
    await ListingQueue.insertMany(docs);

    // 锁定 StockCode（状态改为 locked）—— 放在最后，前面任何一步炸了都不会误锁
    if (lockList.length) {
      await StockCode.updateMany(
        { fullCode: { $in: lockList } },
        { $set: { listingBatchId: batchId, status: 'locked' } }
      );
    }

    res.status(201).json({
      batchId,
      itemCount: docs.length,
      flowSummary: flowSummary || null,
      stats: batchDoc.stats,
    });
  } catch (e) {
    console.error('Save queue error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== 查询 ====================

// GET /v1/api/listings/queues/pending — 待上架（未完成的批次）
router.get('/pending', auth, async (req, res) => {
  try {
    // 找到所有有 pending / running / failed item 的 batchId
    // （running 也算「还没跑完」—— 不列它的话，正跑着的批次会从「待上架」里凭空消失）
    const activeItems = await ListingQueue.find({
      userId: req.user.id,
      itemStatus: { $in: ['pending', 'running', 'failed'] }
    }).sort({ batchId: -1, index: 1 }).lean();

    // 按 batchId 分组
    const batchMap = {};
    for (const item of activeItems) {
      if (!batchMap[item.batchId]) batchMap[item.batchId] = [];
      batchMap[item.batchId].push(item);
    }

    const batches = Object.entries(batchMap).map(([batchId, cards]) => {
      const flowA = cards.filter(c => c.flow === 'A').length;
      const flowB = cards.filter(c => c.flow === 'B').length;
      const flowC = cards.filter(c => c.flow === 'C').length;
      const successCount = cards.filter(c => c.itemStatus === 'success').length;
      const failedCount = cards.filter(c => c.itemStatus === 'failed').length;
      const runningCount = cards.filter(c => c.itemStatus === 'running').length;
      const firstCard = cards[0];
      return {
        batchId,
        totalCards: cards.length,
        successCount,
        failedCount,
        runningCount,
        flowSummary: { flowA, flowB, flowC },
        createdAt: firstCard.createdAt,
      };
    });

    res.json({ list: batches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/listings/queues/completed — 已完成库
router.get('/completed', auth, async (req, res) => {
  try {
    // 找到所有 item 全部 success 的 batchId
    const allBatches = await ListingQueue.aggregate([
      { $match: { userId: req.user.id } },
      { $group: {
        _id: '$batchId',
        total: { $sum: 1 },
        success: { $sum: { $cond: [{ $eq: ['$itemStatus', 'success'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$itemStatus', 'failed'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$itemStatus', 'pending'] }, 1, 0] } },
        // running 必须一起算 —— 否则「正在跑」的批次也满足 pending=0 && failed=0，
        // 会提前出现在「已上架」里（跑着跑着就被当成跑完了）
        running: { $sum: { $cond: [{ $eq: ['$itemStatus', 'running'] }, 1, 0] } },
        createdAt: { $max: '$createdAt' },
      }},
      { $match: { pending: 0, failed: 0, running: 0 } },  // 全部 success
      { $sort: { createdAt: -1 } },
    ]);

    const list = allBatches.map(b => ({
      batchId: b._id,
      totalCards: b.total,
      successCount: b.success,
      failedCount: b.failed,
      createdAt: b.createdAt,
    }));

    // 获取每批的 flow 统计
    for (const batch of list) {
      const flows = await ListingQueue.aggregate([
        { $match: { batchId: batch.batchId } },
        { $group: {
          _id: '$flow',
          count: { $sum: 1 },
        }},
      ]);
      const flowSummary = { flowA: 0, flowB: 0, flowC: 0 };
      flows.forEach(f => {
        if (f._id === 'A') flowSummary.flowA = f.count;
        if (f._id === 'B') flowSummary.flowB = f.count;
        if (f._id === 'C') flowSummary.flowC = f.count;
      });
      batch.flowSummary = flowSummary;
    }

    res.json({ list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/listings/queues/:batchId — 单批详情（含所有 items + 包级「确认完成」标记）
router.get('/:batchId', auth, async (req, res) => {
  try {
    const items = await ListingQueue.find({
      batchId: req.params.batchId,
      userId: req.user.id,
    }).sort({ index: 1 }).lean();

    if (items.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    // 包级标记跟行一起回 —— 前端本来就调这个接口，省一次往返，而且标记和行是同一份快照，
    // 不会出现"包搬过去了但卡还没刷新"。
    // 档案缺失（老批次）或已归档的一律回空数组：**不是 500**，前端照常渲染。
    const 档案 = await ListingBatch.findOne({ batchId: req.params.batchId, userId: req.user.id })
      .select('state donePacks').lean();
    const 包集 = new Set(items.map(it => 行的包名(it)));
    // 用当前队列的包名集合过滤一遍：行被删光的包会变成孤儿标记，别把它回给前端。
    const donePacks = (档案 && 档案.state === 'parsing' ? (档案.donePacks || []) : [])
      .filter(d => 包集.has(d.pack));

    res.json({ batchId: req.params.batchId, items, donePacks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 撤回 ====================

// POST /v1/api/listings/queues/:batchId/revert — 撤回：照解析前的存档还原
//
// 老写法是 `StockCode.updateMany({listingBatchId}, {$set:{status:'pending'}})` —— 两处毛病：
//   ① 不看原来是什么状态，`in_use`（本地库里正用着）也好 `full`（满了）也好，一律写成 `pending`，原状态丢了；
//   ② 归档时不清 `listingBatchId`，于是已上架的批次也匹配得上，撤回会把店里可能正在卖的卡打回 pending。
// 现在改成读 `listingbatches.snapshot` **逐库原样还回去**；已归档的那批还要额外还两样：
// 卡位号（归档时压实过）和原图链接（归档时清空了），都记在归档那份卡片快照里。
router.post('/:batchId/revert', auth, async (req, res) => {
  const batchId = req.params.batchId;
  try {
    // ==================== 一、前置检查（一个字都不写） ====================
    const batch = await ListingBatch.findOne({ batchId, userId: req.user.id }).lean();
    if (!batch) {
      return res.status(404).json({ error: '这个批次没有档案，撤不了（档案是 V1.2.58 起才有的）' });
    }
    if (batch.state === 'reverted') {
      return res.status(400).json({ error: '这一批已经撤回过了' });
    }

    // 执行中不许撤回（V1.2.81）。
    //
    // 撤回会把队列删掉、库状态照快照还原、本功能的「已上架」标记收回 —— 而正在跑的那条链
    // 还在往同一个批次上写行状态、还在**驱动模拟器往店里点**。两边同时动手的后果不是"数据脏"，
    // 是**实打实的对外动作**：库已经被判回"没上架"，模拟器却照着老队列继续挂卡、继续点确认。
    // 口径跟下面那句 `拦执行中`（remove / remove-all / rerun / mark-listed 都用它）一字不差，
    // 只是它定义在文件下方，这里直接问锁。
    //
    // 只管**进程内**这把锁，不管库里停在 running 的行 —— 那种是"上一次跑崩了留下来的"，
    // 正是最需要撤回自救的时候（那种行的正规出口是先点「重跑」，但撤回不该被它挡住）。
    if (listingLock.isRunning(batchId)) {
      return res.status(409).json({ error: '这一批正在执行中，先终止再撤回' });
    }

    const snap = batch.snapshot || [];
    if (snap.length === 0) {
      return res.status(400).json({ error: '这个批次的档案里没有库快照，撤不了' });
    }
    const codeList = snap.map(s => s.fullCode).filter(Boolean);

    const isListed = batch.state === 'listed';

    // 还原要写卡位号，而卡位号是 OrderPick.position 认的那把钥匙 —— 有没拣完的拣货单就先拦下来
    const openPicks = await OrderPick.countDocuments({
      libraryCode: { $in: codeList },
      pickStatus: { $ne: 'picked' },
    });
    if (openPicks > 0) {
      return res.status(409).json({
        error: `这些库上还有 ${openPicks} 张没拣完的卡（订单拣货单），先处理完再撤回 —— 撤回要还原卡位号`,
      });
    }

    // 先把卡片快照读出来（读不到就不能盲撤，卡位号和原图回不去）。
    //
    // 判据从 `isListed` 放宽成「**有没有归档戳记**」（V1.2.79）。归档戳记只在归档那条路上写，
    // 所以「有戳记」== 「这批动过卡位号和原图」，两种情形都在内：
    //   ① 归档跑完了（state === 'listed'，戳记是 3.4 写的）；
    //   ② 归档**死在半路**（state 还停在 'parsing'，戳记是 3.0 提前写的）——
    //      这种批次卡位号已经压实、原图已经清空，状态却还没翻过去。
    //      原来按 isListed 判，②会被当成"没归档过的批次"直接跳过还原，
    //      库状态回到 pending 而卡位号/原图留在归档后的样子 —— **不报错的部分还原**，最难查。
    // 老的、从没归档过的批次没有戳记，行为一个字不变。
    const 要还原卡 = isListed || !!batch.auditStamp;
    let cardRows = null;
    if (要还原卡) {
      try {
        cardRows = readSnapshot(batch.auditStamp, 'cards-before-' + batchId);
      } catch (e) {
        return res.status(500).json({
          error: '归档时那份卡片快照找不到了（' + e.message + '），没它还原不了卡位号和原图，先别撤',
        });
      }
      if (!Array.isArray(cardRows) || cardRows.length === 0) {
        return res.status(500).json({ error: '归档时的卡片快照是空的，还原不了，先别撤' });
      }
    }

    // ==================== 二、先落审计，再动手 ====================
    const stamp = makeStamp();
    const audit = openAudit(stamp, 'listing-revert', batchId);
    audit.save({
      action: 'listing-revert', batchId, userId: req.user.id,
      step: 'begin', stamp,
      fromState: batch.state,
      libraries: codeList,
      snapshot: snap,
      cardsInSnapshot: cardRows ? cardRows.length : 0,
      at: new Date().toISOString(),
    });

    // ==================== 三、动手 ====================
    // 3.1 逐库照快照还原（不再一律 pending）
    //     currentCards 用现数（不是在快照值上照抄）：万一这批中间删过卡，现数才是真的。
    //     现阶段 `parsing` 和 `listed` 两种走法都不删卡，所以现数 = 快照值。
    const restored = [];
    for (const s of snap) {
      const cnt = await Card.countDocuments({ libraryCode: s.fullCode });
      await StockCode.updateOne(
        { fullCode: s.fullCode },
        {
          $set: {
            status: s.status || 'pending',
            libraryType: s.libraryType || '',
            assignedTo: s.assignedTo || null,
            currentCards: cnt,
            listingBatchId: s.listingBatchId || null,
          },
        }
      );
      restored.push({ fullCode: s.fullCode, status: s.status, libraryType: s.libraryType, currentCards: cnt });
    }
    audit.save({
      action: 'listing-revert', batchId, step: 'stockcodes-restored',
      libraries: restored, at: new Date().toISOString(),
    });

    // 3.2 动过卡位号的那批（归档跑完的 + 归档死在半路的）：卡位号 + 原图链接逐张还回去
    let cardsRestored = 0, cardsMissing = 0;
    if (要还原卡 && cardRows) {
      // 快照里的 id 是**字符串**（JSON 存不下 ObjectId 的类型）。而 cards._id 有两种存法：
      //   正式库是 ObjectId，从 JSON 灌出来的库（如 s-lan-test）就是字符串。
      // mongoose 的 `Card.updateOne({_id:'…'})` 会按 schema 把它转成 ObjectId ——
      // 在字符串库里就永远匹配不上，还原会**一声不响地全落空**（不报错，只是 cardsMissing 一堆）。
      // 所以这里走原生驱动，把两种类型都放进 $in，哪种存着就命中哪种。
      const 候选ID = (s) => (mongoose.Types.ObjectId.isValid(s) ? [s, new mongoose.Types.ObjectId(s)] : [s]);
      // 「还原卡位号」是一组**置换**：快照里记的是压实**之前**的号，而库里现在拿的是压实**之后**
      // 的连续号 —— 某张卡的旧号，此刻多半正被同库另一张卡占着。一步一张地直接写回去，
      // 中途必然撞上 `cards` 的 `{libraryCode, serial}` 唯一索引（E11000 半路炸掉，跟第 9 步
      // 加索引时第 3 阶段回归炸的是同一次）。所以分两步：
      //   ① 把这批卡全部**停到临时号**上（`TMP-<批次号>-<序号>`，谁也不撞）
      //   ② 再逐张写回目标号
      // 万一在①②之间断了：卡上留着 TMP 号，但批次状态还是 listed（3.4 没跑到），
      // 快照也还在 —— 重跑一次撤回就整批写回，不会丢数据。
      const 在册 = [];
      for (let i = 0; i < cardRows.length; i++) {
        const r = cardRows[i];
        const r1 = await Card.collection.updateOne(
          { _id: { $in: 候选ID(r.id) } },
          { $set: { serial: 'TMP-' + batchId + '-' + String(i).padStart(4, '0') } }
        );
        if (r1.matchedCount) 在册.push(r);
        else cardsMissing++;   // 卡没了（不该发生）—— 记下来，别装作还上了
      }
      for (const r of 在册) {
        // 快照里 serial 为空的老行不要写空串 —— 同库两张空号会再撞一次唯一索引。
        // （只还原原图链接就好；空号本来就是坏数据，不替它编一个。）
        const 目标 = { origImg: r.origImg || '' };
        if (r.serial) 目标.serial = r.serial;
        const r2 = await Card.collection.updateOne(
          { _id: { $in: 候选ID(r.id) } },
          { $set: 目标 }
        );
        if (r2.matchedCount) cardsRestored++;
        else cardsMissing++;
      }
      audit.save({
        action: 'listing-revert', batchId, step: 'cards-restored',
        restored: cardsRestored, missing: cardsMissing, at: new Date().toISOString(),
      });
    }

    // 3.2b 这批标过的「已上架」要一起收回（V1.2.78）
    //
    // 撤回 = 整批作废，这些卡不再上架卖了，也就该**退出凑库池**（凑库只认 `listed:true`）。
    // `listed` 是另一个开关，上面 3.1/3.2 都不会碰它 —— 不在这里收回来，
    // 这批跑成功过的卡就还留在池子里，会被订单当"已上架的货"拣走。
    // 放在 3.3 删队列**之前**：范围用的 codeList 来自档案快照，跟队列在不在没关系，
    // 但读起来顺 —— 「还东西」都在删之前做完。
    const 收回已上架 = await 取消已上架({
      libraryCodes: codeList, userId: req.user.id, batchId, 位置: `撤回批次 ${batchId}`,
    });
    audit.save({
      action: 'listing-revert', batchId, step: 'listed-cleared',
      收回: 收回已上架.收回, 漏收: 收回已上架.漏收, 他标: 收回已上架.他标,
      libraries: codeList, at: new Date().toISOString(),
    });
    // `漏收` 正常恒为 0。非 0 = 本功能标过、但不是这一批的 —— 要么身份没写成功，
    // 要么是加身份字段（V1.2.82）之前跑的那一批留下的旧标记。这种卡撤回后仍是 listed:true，
    // 也就是**还留在凑库池里**，会被订单当"已上架的货"拣走 —— 得人工去「主库」的
    // 「取消已上架」把它退出来。日志打全，别让它静默。
    if (收回已上架.漏收 > 0) {
      console.error(`[listing] 撤回批次 ${batchId}：这些库上还有 ${收回已上架.漏收} 张本功能标的、`
        + `但不是这一批的卡没收回来（仍是 listed:true，仍会被订单拣走）。`
        + `多为 V1.2.82 之前跑的那一批，确认后请用「主库」的「取消已上架」手工恢复：`
        + `${codeList.slice(0, 5).join(',')}${codeList.length > 5 ? ' …' : ''}`);
    }

    // 3.3 删队列
    const del = await ListingQueue.deleteMany({ batchId, userId: req.user.id });
    audit.save({
      action: 'listing-revert', batchId, step: 'queue-cleared',
      deleted: del.deletedCount, at: new Date().toISOString(),
    });

    // 3.4 档案收尾（不删档案 —— 留着当"这批被撤过"的痕迹）
    //     包级「确认完成」的标记一并清掉：上面 3.3 已经把这批的队列行删光了，
    //     留着就是一堆没有行可指的孤儿（跟 state 同一次 $set 写，保证撤回过的批次永不回潮）。
    await ListingBatch.updateOne(
      { batchId, userId: req.user.id },
      { $set: { state: 'reverted', revertedAt: new Date(), donePacks: [] } }
    );
    audit.save({
      action: 'listing-revert', batchId, step: 'done',
      auditId: audit.auditId, at: new Date().toISOString(),
    });

    res.json({
      success: true,
      batchId,
      fromState: batch.state,
      libCount: codeList.length,
      cardsRestored,
      cardsMissing,
      收回已上架: 收回已上架.收回,
      // 本该收回却没收回的张数（正常 0）。前端在撤回成功的提示里点名，别让它静默（V1.2.82）
      未收回已上架: 收回已上架.漏收,
      queueDeleted: del.deletedCount,
      auditId: audit.auditId,
    });
  } catch (e) {
    console.error('Revert queue error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== 队列条目：删除 / 重跑 ====================
//
// 这三个动作都落在「一行」上（`ListingQueue` 的一行 = 一种 code+罕贵+品相+备注+异画）。
// 删除键的语义是「这份实体卡不跟着这批上架了」—— 所以卡是从库里**真删掉**的，
// 不是从这一行上摘下来留着：摘下来它就变成没主的孤儿卡了。
// 删除**不做卡位压实** —— 压实是「确认完成」那一步统一做的（`batches.js`），
// 中间每删一张就重排一次，会把 OrderPick.position 这把钥匙反复挪动。

/**
 * 取这一批的这一行。批次档案是唯一的依据，所以没有档案就不给动。
 * 返回 `{ batch, item }` 或 `{ error: { status, body } }`。
 */
const 取条目 = async (req, batchId, index) => {
  const batch = await ListingBatch.findOne({ batchId, userId: req.user.id }).lean();
  if (!batch) {
    return { error: { status: 404, body: { error: '这个批次没有档案（档案是 V1.2.58 起才有的），动不了它的条目' } } };
  }
  if (batch.state === 'listed') {
    return { error: { status: 409, body: { error: '这一批已经确认完成（归档）了，别再改它的条目 —— 要改先撤回' } } };
  }
  if (batch.state === 'reverted') {
    return { error: { status: 409, body: { error: '这一批已经撤回过了' } } };
  }
  const item = await ListingQueue.findOne({ batchId, index, userId: req.user.id }).lean();
  if (!item) return { error: { status: 404, body: { error: '这一批里没有第 ' + index + ' 行' } } };

  // 已确认的包 = 只读（V1.2.75）。前端把已确认包渲染成只读详情，但后端不兜住的话还能偷偷改：
  //   rerun  → 造出"已确认但又回到 pending"的包：它被 包们 过滤出待上架屏、又进不了归档判据，
  //            而用户在详情里是只读、看不见那行 —— 只能靠「放回」自救，是个软死锁；
  //   remove-all → 删空整个包，组包 里就没它了，两屏都看不见，DB 里留下一条孤儿标记。
  // 所以这里拦一道：要改先把包「放回」。
  const 名 = 行的包名(item);
  if ((batch.donePacks || []).some(d => d.pack === 名)) {
    return { error: { status: 409, body: { error: `「${名}」这个包已经确认完成了，先把它「放回待上架包」再改` } } };
  }

  return { batch, item };
};

/**
 * 按 serial 逐张找卡、删卡，返回**被删掉的原始卡文档**（给快照和审计留档用）。
 *
 * 两处都不能省：
 *   ① 先按 `serial` 查（serial 是普通字符串字段，两种 `_id` 类型的库都查得到）；
 *   ② 再拿它**本来的** `_id` 去原生删 —— 不能用 `Card.deleteOne({_id: '…'})`，
 *      mongoose 会按 schema 把字符串转成 ObjectId，在从 JSON 灌出来的库（如 s-lan-test）上
 *      匹配 0 条却**不报错**，于是「删了」是假的，卡还在（对应 [[test-db-string-ids-break-mongoose]]）。
 */
const 删卡 = async (serials) => {
  const 删掉的 = [];
  for (const s of serials) {
    const c = await Card.collection.findOne({ serial: s });
    if (!c) continue;
    await Card.collection.deleteOne({ _id: c._id });
    删掉的.push(c);
  }
  return 删掉的;
};

/** 删完之后：摘 serialList、减 addQty、摘空则整行删、同步卡数 */
const 收尾这一行 = async (batchId, index, userId, item, serials) => {
  const 剩下 = (item.serialList || []).filter(s => !serials.includes(s));

  if (剩下.length === 0) {
    // 这行一份都不剩了 → 整行消失。留着的话它就会是个永远跑不动的 pending，把「确认完成」卡死。
    await ListingQueue.deleteOne({ batchId, index, userId });
    return { 行没了: true, serialList: [], addQty: 0, totalQty: 0 };
  }

  // addQty 跟着减（最少留 1）：这行的「这次上几张」本来就跟实体卡份数绑着，
  // 卡少了数量却不变的话，模拟器上就会照着旧数量填。
  const 新addQty = Math.max(1, (item.addQty || 1) - serials.length);
  const 新totalQty = (item.existQty || 0) + 新addQty;
  await ListingQueue.updateOne(
    { batchId, index, userId },
    { $set: { serialList: 剩下, addQty: 新addQty, totalQty: 新totalQty } }
  );
  return { 行没了: false, serialList: 剩下, addQty: 新addQty, totalQty: 新totalQty };
};

/** 这个批次是不是正在跑（跑着的时候别让人从底下把卡抽走） */
const 拦执行中 = (batchId) => (
  listingLock.isRunning(batchId)
    ? { status: 409, body: { error: '这一批正在执行中，先终止再改条目' } }
    : null
);

// POST /v1/api/listings/queues/:batchId/item/:index/remove — 逐份删（body: { serials: [...] }）
router.post('/:batchId/item/:index/remove', auth, async (req, res) => {
  const batchId = req.params.batchId;
  const index = parseInt(req.params.index, 10);
  try {
    const r = await 取条目(req, batchId, index);
    if (r.error) return res.status(r.error.status).json(r.error.body);
    const { item } = r;

    const 要删 = Array.isArray(req.body && req.body.serials)
      ? [...new Set(req.body.serials.map(s => String(s || '').trim()).filter(Boolean))]
      : [];
    if (要删.length === 0) {
      return res.status(400).json({ error: '要删哪几份？serials 不能是空的（整行删请走 remove-all）' });
    }

    const 行里的 = item.serialList || [];
    const 不在行里 = 要删.filter(s => !行里的.includes(s));
    if (不在行里.length) {
      return res.status(400).json({ error: '这几份不属于这一行，不删：' + 不在行里.join('、') });
    }

    const 拦 = 拦执行中(batchId);
    if (拦) return res.status(拦.status).json(拦.body);

    // ===== 先落快照，再动手（删卡是不可逆的，这份档是唯一的记录） =====
    // saveSnapshot 写不进去会抛 → 下面 catch 转 500，一个字都不删。
    const stamp = makeStamp();
    // 审计文件名末尾必须带上毫秒：makeStamp 只到秒，而「删一份」是会被连点好几次的，
    // 同一秒里同一行删 5 次的话，`openAudit` 的 `writeFileSync` 会把前 4 份**悄悄覆盖**掉 ——
    // 只留下最后一次的记录，前面删掉的卡就查无实据了。（和 V1.2.60 快照改名同一个坑）
    const audit = openAudit(stamp, 'listing-item-remove', batchId, 'i' + index, Date.now());
    const 待删 = await Card.collection.find({ serial: { $in: 要删 } }).toArray();
    saveSnapshot(
      stamp,
      'removed-cards-' + batchId + '-i' + index + '-' + Date.now(),
      待删.map(c => ({ ...c, _id: String(c._id) }))   // _id 存成字符串 —— JSON 存不下 ObjectId 的类型
    );
    audit.save({
      action: 'listing-item-remove', batchId, index, userId: req.user.id,
      step: 'begin', stamp,
      code: item.code, rarity: item.rarity,
      要删的份: 要删, 行里的份: 行里的, 卡片快照条数: 待删.length,
      at: new Date().toISOString(),
    });

    // ===== 动手 =====
    const 删掉的 = await 删卡(要删);
    const 没找到 = 要删.filter(s => !删掉的.some(c => c.serial === s));
    const 动过的库 = [...new Set(删掉的.map(c => c.libraryCode).filter(Boolean))];
    audit.save({
      action: 'listing-item-remove', batchId, index, step: 'cards-deleted',
      deleted: 删掉的.length, missing: 没找到, libraries: 动过的库,
      at: new Date().toISOString(),
    });

    const 结果 = await 收尾这一行(batchId, index, req.user.id, item, 要删);
    for (const lib of 动过的库) await syncStockCode(lib);
    audit.save({
      action: 'listing-item-remove', batchId, index, step: 'done',
      rowDeleted: 结果.行没了, serialList: 结果.serialList, addQty: 结果.addQty, totalQty: 结果.totalQty,
      auditId: audit.auditId, at: new Date().toISOString(),
    });

    res.json({
      success: true,
      batchId, index,
      deleted: 删掉的.length,
      missing: 没找到,          // 库里本来就找不到的份（不该发生）—— 别装作删掉了
      rowDeleted: 结果.行没了,
      serialList: 结果.serialList,
      addQty: 结果.addQty,
      totalQty: 结果.totalQty,
      libraries: 动过的库,
      auditId: audit.auditId,
    });
  } catch (e) {
    console.error('Listing item remove error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/listings/queues/:batchId/item/:index/remove-all — 整行删
router.post('/:batchId/item/:index/remove-all', auth, async (req, res) => {
  const batchId = req.params.batchId;
  const index = parseInt(req.params.index, 10);
  try {
    const r = await 取条目(req, batchId, index);
    if (r.error) return res.status(r.error.status).json(r.error.body);
    const { item } = r;

    const 拦 = 拦执行中(batchId);
    if (拦) return res.status(拦.status).json(拦.body);

    const 全份 = item.serialList || [];

    // 一行里一份实体卡都没有（解析时就没有 serial 的那种）也是合法的 —— 那就不用落卡片快照，
    // 但还是照旧开审计：动作本身（删掉一整行）得留下痕迹。
    const stamp = makeStamp();
    const audit = openAudit(stamp, 'listing-item-remove-all', batchId, 'i' + index, Date.now());
    if (全份.length) {
      const 待删 = await Card.collection.find({ serial: { $in: 全份 } }).toArray();
      saveSnapshot(
        stamp,
        'removed-cards-' + batchId + '-i' + index + '-all-' + Date.now(),
        待删.map(c => ({ ...c, _id: String(c._id) }))
      );
      audit.save({
        action: 'listing-item-remove-all', batchId, index, userId: req.user.id,
        step: 'begin', stamp, code: item.code, rarity: item.rarity,
        行里的份: 全份, 卡片快照条数: 待删.length, at: new Date().toISOString(),
      });
    } else {
      audit.save({
        action: 'listing-item-remove-all', batchId, index, userId: req.user.id,
        step: 'begin', stamp, code: item.code, rarity: item.rarity,
        行里的份: [], note: '这一行没有实体卡位号，只删队列行', at: new Date().toISOString(),
      });
    }

    const 删掉的 = await 删卡(全份);
    const 没找到 = 全份.filter(s => !删掉的.some(c => c.serial === s));
    const 动过的库 = [...new Set(删掉的.map(c => c.libraryCode).filter(Boolean))];

    await ListingQueue.deleteOne({ batchId, index, userId: req.user.id });
    for (const lib of 动过的库) await syncStockCode(lib);

    audit.save({
      action: 'listing-item-remove-all', batchId, index, step: 'done',
      deleted: 删掉的.length, missing: 没找到, libraries: 动过的库,
      auditId: audit.auditId, at: new Date().toISOString(),
    });

    res.json({
      success: true,
      batchId, index,
      deleted: 删掉的.length,
      missing: 没找到,
      rowDeleted: true,
      libraries: 动过的库,
      auditId: audit.auditId,
    });
  } catch (e) {
    console.error('Listing item remove-all error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/listings/queues/:batchId/item/:index/rerun — 单卡重跑
//
// 只是把这一行放回 `pending`，让它下次「一键上架」时重新排队；
// 真正跑的是 auto-execute —— 这里不碰模拟器。
// 顺带它也是**清掉「卡在 running 的僵尸行」**的唯一出口（进程崩过之后留下的那种）。
router.post('/:batchId/item/:index/rerun', auth, async (req, res) => {
  const batchId = req.params.batchId;
  const index = parseInt(req.params.index, 10);
  try {
    const r = await 取条目(req, batchId, index);
    if (r.error) return res.status(r.error.status).json(r.error.body);

    const 拦 = 拦执行中(batchId);
    if (拦) return res.status(拦.status).json(拦.body);

    const 原本 = r.item.itemStatus;
    await ListingQueue.updateOne(
      { batchId, index, userId: req.user.id },
      { $set: { itemStatus: 'pending', errorMessage: '' } }
    );

    res.json({ success: true, batchId, index, from: 原本, to: 'pending' });
  } catch (e) {
    console.error('Listing item rerun error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /v1/api/listings/queues/:batchId/item/:index/price — 手改这一行的上架价格
//
// 这是 `listingPrice`（要挂到店里去的价）的**人写入口**，跟 outputPrice「价格(输出)」无关：
// 后者是模拟器吐出来的第三个参考数，只读、也不该被人改。
// 自动跑完只会拿集换价给 listingPrice 打个底（且仅在为空时），所以这里改完的值重跑也不会被冲掉。
//
// 执行中**不拦**：跑着的时候人是可以改价的，而落库那句「空才填」的过滤条件在数据库那层
// 就把这个值保护住了（见 services/listingOutputs.js 的 给上架价打底）。
router.put('/:batchId/item/:index/price', auth, async (req, res) => {
  const batchId = req.params.batchId;
  const index = parseInt(req.params.index, 10);
  try {
    const r = await 取条目(req, batchId, index);
    if (r.error) return res.status(r.error.status).json(r.error.body);

    const 价 = String((req.body && req.body.price) != null ? req.body.price : '').trim();
    // 空串 = 清掉这个价（下一次跑完会被集换价重新打底）。非空则必须是纯数字，最多两位小数。
    // 不收「¥」「元」「,」这些东西：价格是要喂给上架流程的，混进非数字字符到那儿才炸，不如这儿拦住。
    if (价 !== '' && !/^\d{1,9}(\.\d{1,2})?$/.test(价)) {
      return res.status(400).json({ error: '价格只能是数字（最多两位小数），要清空就传空串' });
    }

    await ListingQueue.updateOne(
      { batchId, index, userId: req.user.id },
      { $set: { listingPrice: 价 } }
    );

    res.json({
      success: true, batchId, index,
      listingPrice: 价,
      outputJhj: r.item.outputJhj || '',      // 一并回给前端：集换价是打底用的参照，页面上要并排显示
    });
  } catch (e) {
    console.error('Listing item price error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/listings/queues/:batchId/item/:index/mark-listed — 人工标成「已上架」
//
// 干什么用的：这一行跑红了（流程报错、模拟器抽风），但人已经在店里手工把它上架了。
// 没有这个键的话，这一行会永远红着 —— 「确认完成」的判据是「没有 pending」，红的不拦，
// 所以归档本身过得去，但那抹红会一直挂到归档为止，看着像还有活没干完。
// 有了它，人核对完就能把这一行按绿：「我认过了，这行算完成」。
//
// 跟 rerun 的方向正好相反：rerun 把行放回 pending 等下次跑，这个直接把行判成功。
// 守卫复用取条目里那套（归档过的批次改不动、行不存在 404、跨用户 404）+ 拦执行中
// （跑着的时候不许从底下改结论 —— 模拟器一回来就会把这里刚写的结论覆盖掉）。
const 人工标记 = '人工标记';
router.post('/:batchId/item/:index/mark-listed', auth, async (req, res) => {
  const batchId = req.params.batchId;
  const index = parseInt(req.params.index, 10);
  try {
    const r = await 取条目(req, batchId, index);
    if (r.error) return res.status(r.error.status).json(r.error.body);

    const 拦 = 拦执行中(batchId);
    if (拦) return res.status(拦.status).json(拦.body);

    const 原本 = r.item.itemStatus;
    if (原本 === 'success' && String(r.item.outputStatus || '') !== 人工标记) {
      // 真跑成功过的行，别让人用「人工标记」把它盖掉 —— 那会把模拟器取回来的 14 项输出的来路弄糊。
      return res.status(409).json({ error: '这一行是真跑成功过的，不用人工标记；要重跑请点「重跑」' });
    }

    await ListingQueue.updateOne(
      { batchId, index, userId: req.user.id },
      { $set: { itemStatus: 'success', errorMessage: '', outputStatus: 人工标记 } }
    );

    // 「我已经在店里手工上架了」这句一按，实体卡就该退出凑库 —— 跟真跑成功的行同一个口径。
    // 不补这一句的话，人工标记过的行看着绿了，卡却还在库存里等着被订单拣走（V1.2.78）。
    const 标了 = await 标记已上架({
      serialList: r.item.serialList, userId: req.user.id, batchId,
      位置: `人工标记 批次 ${batchId} 第 ${index} 行`,
    });

    res.json({ success: true, batchId, index, from: 原本, to: 'success', outputStatus: 人工标记, 标记张数: 标了 });
  } catch (e) {
    console.error('Listing item mark-listed error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
