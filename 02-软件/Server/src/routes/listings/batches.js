/**
 * 上架批次档案 API — 两件事：整批归档（「确认完成」）、包级标记（V1.2.75 的「确认完成」/「放回」）。
 *
 * 为什么归档要改成人工点：
 *   原先自动归档写在 `auto-execute.js:217` / `auto-execute-vm.js:265`，判据是
 *   `okCount === totalCount` —— 左边是**本次执行**成功的张数，右边是**整批**张数，两个口径不同。
 *   只要失败过一次（哪怕后来重跑全绿），`okCount` 永远小于 `totalCount`，那道门永远开不了。
 *   反过来，页面的「已上架库」读的是 `GET /listings/queues/completed`（判据是队列里跑绿没跑绿），
 *   跟那道门毫无关系 —— 于是会出现「页面说已上架、实体卡还 locked」的静默不一致。
 *   现在改成：跑完了、人核对过了，点一下这里。这是唯一的归档入口。
 */
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const ListingBatch = require('../../models/ListingBatch');
const ListingQueue = require('../../models/ListingQueue');
const StockCode = require('../../models/StockCode');
const Card = require('../../models/Card');
const OrderPick = require('../../models/OrderPick');
const { compactLibrarySerials, syncStockCode } = require('../../services/librarySerials');
const { makeStamp, openAudit, readSnapshot, saveSnapshot } = require('../../services/cardAudit');
const { 标记已上架 } = require('../../services/listingMarkListed');

// POST /v1/api/listings/batches/:batchId/complete — 人工确认完成 → 归档
router.post('/:batchId/complete', auth, async (req, res) => {
  const { batchId } = req.params;
  try {
    // ==================== 一、前置检查（一个字都不写） ====================
    const batch = await ListingBatch.findOne({ batchId, userId: req.user.id }).lean();
    if (!batch) return res.status(404).json({ error: '没有这个批次：' + batchId });
    if (batch.state === 'listed') return res.status(400).json({ error: '这一批已经确认完成过了' });
    if (batch.state === 'reverted') return res.status(400).json({ error: '这一批已经撤回过了，不能再确认完成' });

    const items = await ListingQueue.find({ batchId, userId: req.user.id }).lean();
    if (items.length === 0) return res.status(404).json({ error: '这个批次没有队列记录' });

    const pendingCount = items.filter(it => it.itemStatus === 'pending').length;
    if (pendingCount > 0) {
      return res.status(400).json({ error: `还剩 ${pendingCount} 张没跑完，跑完再确认` });
    }
    // running = 还挂在模拟器上跑着。归档要压实卡位号，这会儿动不了它。
    const runningCount = items.filter(it => it.itemStatus === 'running').length;
    if (runningCount > 0) {
      return res.status(409).json({ error: `还有 ${runningCount} 张正在执行中，等它跑完（或终止后重跑成「待执行」）再确认` });
    }
    // failed（红）**拦**，跟列表口径对齐。
    //
    // 原先这里不拦，注释写的是「那是留给人看的，删掉还是不删由人决定」。可列表那边
    // （`queues.js:216` 的 `GET /queues/completed`）的判据是 `pending:0 && failed:0 && running:0`
    // —— 两边口径不一致，于是能造出这样一种自相矛盾的状态：
    // 点了「确认完成」→ 库真归档了（卡位号被重排、原图被清空），可这一批**在「已上架库」里根本不出现**
    // （列表判据带 failed=0，它被滤掉了），人再也找不到那些卡 —— 正是本文件开头那段注释骂的
    // 「页面说已上架、实体卡还没上架」的翻版。
    //
    // 要归档就得先把红的处理掉。「重跑」（`queues.js` 的重跑）和「删掉这一行」都是人的决定，
    // 这里只负责**不让人蒙着眼睛走过去**。红行若落在已确认的包里，先「放回」那个包就能重跑 ——
    // 出口是有的，不会堵死。
    const failedCount = items.filter(it => it.itemStatus === 'failed').length;
    if (failedCount > 0) {
      return res.status(400).json({
        error: `还有 ${failedCount} 张跑失败了（红的），先「重跑」或删掉这些行再确认完成`,
      });
    }

    // 这一批该管哪些库。
    //
    // 主口径是 StockCode 上的批次号（解析时锁的那批）。但**只有它不够**：
    // 3.1 会把 `listingBatchId` 一并清空，于是万一上一次归档死在 3.1 之后、3.4 之前，
    // 这一次按批次号就一个库都查不到了 —— 原来那句 `codeList.length === 0 → 400` 会让
    // 这一批**永远归档不了**：状态还停在 parsing（进不了「已上架库」），按批次号又查不到库
    // （进不了这一屏的归档判据），而「撤回」那时也走不通（见下面 3.0 的注释）—— 三头堵死。
    //
    // 兜底就用档案里的库快照：它跟锁定那批是**同一个集合**（`queues.js:72` 先按 lockList
    // 读 StockCode 抄进 snapshot，`:137` 再按同一个 lockList 上锁）。只扣掉一种：
    // 现在挂在**别的**批次名下的库 —— 那说明这批被撤过又重新解析了，不属于这次。
    const locked = await StockCode.find({ listingBatchId: batchId }).select('fullCode').lean();
    const 锁定 = [...new Set(locked.map(s => s.fullCode).filter(Boolean))];
    const 锁定集 = new Set(锁定);
    const 快照候选 = [...new Set((batch.snapshot || [])
      .map(s => String(s.fullCode || '')).filter(c => c && !锁定集.has(c)))];
    const 被别人锁 = new Set(
      (快照候选.length
        ? await StockCode.find({
          fullCode: { $in: 快照候选 },
          listingBatchId: { $nin: [null, batchId] },
        }).select('fullCode').lean()
        : []).map(s => s.fullCode)
    );
    const codeList = [...锁定, ...快照候选.filter(c => !被别人锁.has(c))];
    if (codeList.length === 0) {
      return res.status(400).json({ error: '这一批名下一个库都没有，档案和库对不上，先别动' });
    }
    if (锁定.length === 0) {
      // 走到这儿说明是"接着上次没跑完的归档继续" —— 记一笔，事后对得上账
      console.warn(`[listings] 批次 ${batchId} 按批次号查不到库，改用档案快照里的 `
        + `${codeList.length} 个库继续归档（上一次死在半路）`);
    }

    // ⚠️ 归档要压实卡位号，而卡位号是 OrderPick.position 认的那把钥匙 ——
    //    有未完成的拣货单指着这些库就先拦下来，等它走完。
    const openPicks = await OrderPick.countDocuments({
      libraryCode: { $in: codeList },
      pickStatus: { $ne: 'picked' },
    });
    if (openPicks > 0) {
      return res.status(409).json({
        error: `这些库上还有 ${openPicks} 张没拣完的卡（订单拣货单），先处理完再确认完成 —— 归档要重排卡位号`,
      });
    }

    // ==================== 二、先把快照落到盘上（照 cardAudit 的老规矩） ====================
    // 单机 MongoDB 没有副本集，跨集合写入没有回滚。「快照没写成功 → 直接 500，一个字都不改」。
    // 这份档要能回答「归档前这些卡位长什么样」，所以逐张记 serial —— 压实是唯一会改 serial 的一步。
    //
    // ⚠️ `batch.auditStamp` 有值 = **上一次归档死在半路**，这一趟是接着跑（V1.2.79）。
    //    这时候**绝对不许重拍快照**：库里现在的卡位号/原图是上一趟压实+清空**之后**的样子，
    //    再拍一张盖上去，就把"归档前长什么样"这张唯一的回退依据换成了一张废纸。
    //    所以续跑只把**原来那张**读回来核对（读不到就 500，跟"快照没写成功不许动手"同一条规矩）。
    const 续跑 = !!batch.auditStamp;
    let stamp, cardRows;
    if (续跑) {
      stamp = batch.auditStamp;
      try {
        cardRows = readSnapshot(stamp, 'cards-before-' + batchId);
      } catch (e) {
        return res.status(500).json({
          error: '上一次归档留下的卡片快照找不到了（' + e.message + '），没它回不了退，先别动',
        });
      }
      if (!Array.isArray(cardRows) || cardRows.length === 0) {
        return res.status(500).json({ error: '上一次归档留下的卡片快照是空的，回不了退，先别动' });
      }
    } else {
      // 归档会动每张卡的两样东西：卡位号（重排）和原图链接（清空）。
      // 撤回想还原这两样，就得先把它们抄下来 —— 所以这份档两样都记。
      stamp = makeStamp();
      cardRows = await Card.find({ libraryCode: { $in: codeList } })
        .select('_id libraryCode serial origImg').lean();
      // 文件名带上批次号：makeStamp 只到秒，同一秒里归档两批的话，
      // 固定名会被后一批**悄悄覆盖**掉前一批的档。
      saveSnapshot(stamp, 'cards-before-' + batchId, cardRows.map(c => ({
        id: String(c._id), libraryCode: c.libraryCode, serial: c.serial || '', origImg: c.origImg || '',
      })));   // 写不进去就让它抛 → 下面 catch 转 500
    }
    // 本次尝试的日志单独一份（续跑时它会跟 stamp 不同名 —— 上一次那份日志要留着看"死在哪一步"）。
    // `stamp` 仍然原样记进 begin 那条，事后对得上"用的是哪张快照"。
    const audit = openAudit(makeStamp(), 'listing-complete', batchId);

    audit.save({
      action: 'listing-complete', batchId, userId: req.user.id,
      step: 'begin', stamp,
      续跑,
      libraries: codeList,
      stats: batch.stats || {},
      queueItems: items.length,
      failedItems: items.filter(it => it.itemStatus === 'failed').length,
      cards: cardRows.length,
      at: new Date().toISOString(),
    });

    // ==================== 三、动手（顺序按「先读后清」） ====================
    // codeList 已经在上面拿过了 —— 下面第一步会把 listingBatchId 清掉，清掉之后就找不回这些库了。

    // 3.0 先把戳记下 —— **在动任何数据之前**
    //
    // `batch.auditStamp` 原来是 3.4（收尾）才写的，可它是「撤回」找回上面那份卡片快照的**唯一钥匙**
    // （`queues.js` 的 revert 读 `readSnapshot(batch.auditStamp, 'cards-before-<batchId>')`）。
    // 于是出现这样一个死角：归档死在 3.1~3.3 之间时，卡位号已经被压实、原图已经清空，
    // 戳记却还没落 —— 快照其实好端端躺在盘上，却谁都找不到，**原图和旧卡位号再也回不去**。
    // 先写这一句，代价只有一次 updateOne；3.4 再写一遍同一个值（幂等，无害）。
    await ListingBatch.updateOne(
      { batchId, userId: req.user.id },
      { $set: { auditStamp: stamp } }
    );

    // 3.1 库归档：archived + 归属清空 + 批次号一并清掉
    //     （批次号不清就是颗雷：这批一旦在「已上架库」里被撤回，会把店里可能正在卖的卡打回 pending）
    const upRes = await StockCode.updateMany(
      { listingBatchId: batchId },
      { $set: { status: 'archived', libraryType: '', listingBatchId: null } }
    );
    audit.save({
      action: 'listing-complete', batchId, step: 'stockcodes-archived',
      matched: upRes.matchedCount ?? upRes.n, modified: upRes.modifiedCount ?? upRes.nModified,
      libraries: codeList, at: new Date().toISOString(),
    });

    // 3.2 上架成功 → 清除该批次库卡牌的原图链接（原图文件保留，可到「原图缓存管理」清理）
    const imgRes = await Card.updateMany(
      { libraryCode: { $in: codeList }, origImg: { $ne: '' } },
      { $set: { origImg: '' } }
    );
    audit.save({
      action: 'listing-complete', batchId, step: 'origimg-cleared',
      cleared: imgRes.modifiedCount ?? imgRes.nModified, at: new Date().toISOString(),
    });

    // 3.2b 兜底：跑成功的行，实体卡要**进**订单凑库池（V1.2.78）
    //
    // 新跑成功的行在成功那一刻就标了（两条执行链 + 人工标记都调了 标记已上架）。
    // 这里兜的是**这次改动之前**跑成功的行 —— 实测真库有 8 行、25 张卡一张都没标。
    // 凑库的筛选是 `{ listed: true }`（V1.2.87 从写反的 false 改正），没标 = 卡明明
    // 上架了却拣不出来，有订单也凑不上。归档是这批卡最后一次由系统集中过手的时机，顺手扫干净。
    //
    // ⚠️ 必须放在 3.3 **之前**：3.3 的 compactLibrarySerials 会重排卡位号，
    //    重排完 `Card.serial` 就跟 `serialList` 对不上了，那时候再标只能标个空集。
    // 失败的行**不标** —— 它们真的没上架（店里没有，留着让人重跑或删）。
    const 成功行的号 = [...new Set(
      items.filter(it => it.itemStatus === 'success').flatMap(it => it.serialList || [])
    )];
    const 补标张数 = await 标记已上架({
      serialList: 成功行的号, userId: req.user.id, batchId, 位置: `归档兜底 批次 ${batchId}`,
    });
    audit.save({
      action: 'listing-complete', batchId, step: 'listed-backfilled',
      候选: 成功行的号.length, 标了: 补标张数, at: new Date().toISOString(),
    });

    // 3.3 压实卡位 + 同步卡数
    //     （syncStockCode 对 archived 不动 status，只修 currentCards —— 正合这里要的）
    const compacted = [];
    for (const lib of codeList) {
      await compactLibrarySerials(lib);
      await syncStockCode(lib);
      compacted.push(lib);
    }
    audit.save({
      action: 'listing-complete', batchId, step: 'serials-compacted',
      libraries: compacted, at: new Date().toISOString(),
    });

    // 3.4 档案收尾（把这次的审计戳记下 —— 撤回要照它找回上面那份卡片快照）
    //     包级标记**不动**（留作"这个包什么时候被确认过"的记录），但顺手清一遍孤儿：
    //     只留这一批里还真实存在的包。（正常情况下不该有孤儿 —— 取条目 那道守卫挡着，
    //     这里兜的是手改库之类的情况。）
    const 包集 = new Set(items.map(it => 包名(it)));
    const donePacks = (batch.donePacks || []).filter(d => 包集.has(d.pack));
    await ListingBatch.updateOne(
      { batchId, userId: req.user.id },
      { $set: { state: 'listed', completedAt: new Date(), auditStamp: stamp, donePacks } }
    );
    audit.save({
      action: 'listing-complete', batchId, step: 'done',
      auditId: audit.auditId, at: new Date().toISOString(),
    });

    res.json({
      success: true,
      batchId,
      libCount: codeList.length,
      itemCount: items.length,
      failedCount: items.filter(it => it.itemStatus === 'failed').length,
      libraries: codeList,
      auditId: audit.auditId,
    });
  } catch (e) {
    console.error('Listing batch complete error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== 包级「确认完成」（V1.2.75）====================
//
// 跟上面那个整批归档**完全是两回事**，别混：
//   包级（这里）= 把一个包从「待上架包」挪进「已上架包」。**只是标记** ——
//                 库状态、卡位号、库锁一个字不动，撤回整批时连标记一起清掉。
//   批级（上面）= 把待上架库归档进已上架库。那一步才真动库。
//
// 为什么包级也要落库（而不是存浏览器）：刷新不丢、手机/PC 一致，而且能审计。

// 包名算法必须跟前端 `组包`（Client/src/pages/auto-listing/auto-listing.vue:607-610）**逐字一致**。
// 前端按这个把行分组、也按这个发「放回」；两边一旦漂移，用户点了「放回」就摘不掉后端这条标记。
// ⚠️ 别顺手跟 queues.js:19 的同名函数合并 —— 那个是解析时**从编号前缀造 packCode**用的，用途不同。
const 包名 = (it) => it.packCode || (String(it.code || '').split('-')[0] || '未知');

// 两个新端点共用的前置检查。返回 { error } 或 { batch, items }
async function 取批次和队列(req, batchId) {
  // 无档案 404、state 不是 parsing 一律 409 —— listed 已经归档、reverted 队列都删光了，
  // 这两种都不该再动包级标记。（跟上面 complete 的 400 口径不同：那边是"重复点"，这边是"状态冲突"。）
  const batch = await ListingBatch.findOne({ batchId, userId: req.user.id }).lean();
  if (!batch) return { error: { status: 404, body: { error: '没有这个批次：' + batchId } } };
  if (batch.state === 'listed') {
    return { error: { status: 409, body: { error: '这一批已经确认完成（归档）了，包级标记不再改动' } } };
  }
  if (batch.state === 'reverted') {
    return { error: { status: 409, body: { error: '这一批已经撤回过了' } } };
  }
  const items = await ListingQueue.find({ batchId, userId: req.user.id }).lean();
  if (items.length === 0) return { error: { status: 404, body: { error: '这个批次没有队列记录' } } };
  return { batch, items };
}

// GET 用：读回这份档案当前的包级标记（撤销/确认后要回给前端最新的一份）
async function 取标记(batchId, userId) {
  const b = await ListingBatch.findOne({ batchId, userId }).select('donePacks').lean();
  return (b && b.donePacks) || [];
}

// POST /v1/api/listings/batches/:batchId/packs/complete — 包级「确认完成」
// body { packs: ['17CC', ...] }
router.post('/:batchId/packs/complete', auth, async (req, res) => {
  const { batchId } = req.params;
  try {
    const 原名单 = req.body && req.body.packs;
    if (!Array.isArray(原名单)) return res.status(400).json({ error: 'packs 要是一个数组' });
    const packs = [...new Set(原名单.map(x => String(x == null ? '' : x).trim()).filter(Boolean))];
    if (packs.length === 0) return res.status(400).json({ error: '没给包名' });
    if (packs.length > 500) return res.status(400).json({ error: '一次最多标 500 个包' });

    const 前置 = await 取批次和队列(req, batchId);
    if (前置.error) return res.status(前置.error.status).json(前置.error.body);
    const { batch, items } = 前置;

    // 服务端不信客户端：只认"这一批里真实存在、且这个包没有 pending/running 行"的包。
    // 判据跟前端 `组包` 的 `包可确认` 同源，只是**从行状态算**、不看「缺」（缺是前端查目录才知道的）。
    //
    // failed（红）**也拦** —— 跟上面整批归档那道闸同一个口径。
    // 原先这里放行（"那是留给人的，删不删由人决定"），可整批归档现在是拦红的：
    // 红行一旦被挪进「已上架包」，那个包就变成只读，行级什么也动不了，
    // 想重跑得先「放回」—— 与其让人走到那一步再回头，不如在门口就说清楚。
    const 行数 = new Map();
    for (const it of items) {
      const p = 包名(it);
      const r = 行数.get(p) || { 没跑: 0, 红: 0 };
      if (it.itemStatus === 'pending' || it.itemStatus === 'running') r.没跑++;
      if (it.itemStatus === 'failed') r.红++;
      行数.set(p, r);
    }
    const 已标 = new Set((batch.donePacks || []).map(d => d.pack));

    const accepted = [];
    const skipped = [];
    const ops = [];
    const at = new Date();
    for (const pack of packs) {
      const r = 行数.get(pack);
      if (!r) { skipped.push({ pack, reason: '这一批里没有这个包' }); continue; }
      if (已标.has(pack)) { skipped.push({ pack, reason: '已经确认过了' }); continue; }
      if (r.没跑 > 0) { skipped.push({ pack, reason: `还剩 ${r.没跑} 行没跑完` }); continue; }
      if (r.红 > 0) { skipped.push({ pack, reason: `还有 ${r.红} 行是失败的（红的），先重跑或删掉` }); continue; }
      accepted.push(pack);
      // 条件更新（带 $ne）而不是"读出来改完再整数组写回去" —— 后者两个人同时点会互相盖。
      // ⚠️ 也不能用 $addToSet：子文档里带 at 字段，值不同就永远判不成重复。
      ops.push({
        updateOne: {
          filter: { batchId, userId: req.user.id, 'donePacks.pack': { $ne: pack } },
          update: { $push: { donePacks: { pack, at } } },
        },
      });
    }
    if (ops.length) await ListingBatch.bulkWrite(ops);

    res.json({ success: true, accepted, skipped, donePacks: await 取标记(batchId, req.user.id) });
  } catch (e) {
    console.error('Listing packs complete error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/listings/batches/:batchId/packs/undo — 「放回」：把包退回「待上架包」
// body { pack: '17CC' }
router.post('/:batchId/packs/undo', auth, async (req, res) => {
  const { batchId } = req.params;
  try {
    const pack = String((req.body && req.body.pack) || '').trim();
    if (!pack) return res.status(400).json({ error: '没给包名' });

    const 前置 = await 取批次和队列(req, batchId);
    if (前置.error) return res.status(前置.error.status).json(前置.error.body);

    // 幂等：没标过的包照样 200 —— 前端连点两下不该报错。
    await ListingBatch.updateOne(
      { batchId, userId: req.user.id },
      { $pull: { donePacks: { pack } } }
    );

    res.json({ success: true, pack, donePacks: await 取标记(batchId, req.user.id) });
  } catch (e) {
    console.error('Listing packs undo error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/listings/batches — 列这个用户的批次档案（?state=listed 只列已上架的）
router.get('/', auth, async (req, res) => {
  try {
    const q = { userId: req.user.id };
    if (req.query.state) q.state = String(req.query.state);
    const list = await ListingBatch.find(q)
      .sort({ createdAt: -1 })
      .limit(Number(req.query.limit) || 50)
      .select('batchId state stats snapshot completedAt revertedAt createdAt')
      .lean();
    res.json({
      list: list.map(b => ({
        batchId: b.batchId,
        state: b.state,
        stats: b.stats || {},
        libraries: (b.snapshot || []).map(s => s.fullCode),
        completedAt: b.completedAt,
        revertedAt: b.revertedAt,
        createdAt: b.createdAt,
      })),
    });
  } catch (e) {
    console.error('Listing batch list error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/listings/batches/:batchId — 看一眼这批的档案
router.get('/:batchId', auth, async (req, res) => {
  try {
    const batch = await ListingBatch.findOne({ batchId: req.params.batchId, userId: req.user.id }).lean();
    if (!batch) return res.status(404).json({ error: '没有这个批次' });
    res.json({ batch });
  } catch (e) {
    console.error('Listing batch get error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
