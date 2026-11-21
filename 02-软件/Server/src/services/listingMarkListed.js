/**
 * 「这一行上架成功」→ 把它压着的**实体卡**标成 `listed`（V1.2.78）。
 *
 * 这一笔标记就是**进凑库池的开关**（V1.2.87 才对齐）
 * --------------------------------------------------
 * 订单凑库筛的就是 `{ listed: true }`（`routes/orders/index.js`）：「已上架」= 这张实体卡
 * 已经挂到店里卖出去了，订单才会来 —— 所以**只有被标成已上架的卡才会被订单拣走**。
 * 一键上架跑成功一行，这一行压着的卡就当场进池。
 *
 * ⚠️ 这条链子断了很久，V1.2.87 才接上
 * -----------------------------------
 * 加这个服务之前，**没有任何代码会自动标 `listed:true`**（原先只有「上架记录」那条人工路径会，
 * 见 `routes/listed-cards/index.js:147/190`），全库都是 `listed:false`；而凑库那时筛的是
 * `{ listed: false }` —— 一句**方向写反了的**条件，被"全库都是 false"恰好掩盖，
 * 等于没筛，所以看着一直正常。V1.2.78 让一键上架开始自动标 true 之后，池子当场清空：
 * 实测（只读查真库）46 张卡被批次 `26-10-2-1` 全标成 true，而筛子还在找 false ——
 * 于是每张卡都判「未凑库」。V1.2.87 把凑库条件改正成 `{ listed: true }`，两边终于对齐。
 *
 * 所以标失败**不是"多卖一张"，是"这张卡凑不进来"**
 * -----------------------------------------------
 * 标不上 = 卡上架了却进不了凑库池 = 有订单也凑不到它，而界面上只会显示「未凑库」，
 * 没人看得出是标记没写成功。绝不能静默：下面 catch 里把号打全（含 batchId），日志里能捞回来。
 *
 * 拿什么当钥匙
 * ------------
 * `ListingQueue.serialList` 存的正是这一行压着的**实体卡位号**（`A0-000-00-0001`），
 * 跟 `Card.serial` 一一对应 —— 真库 8564 行**行行都带号**，抽查 300 个号命中 300 张卡。
 * 所以并列一句 `Card.serial ∈ serialList` 就够，不用绕 `code + libraryCode`。
 * 顺带的好处：这是**物理**身份，跟库搬不搬迁无关。
 *
 * ⚠️ 它**不建 `ListedCard` 记录**
 * ----------------------------
 * 只翻 `Card.listed` 这一个开关。`ListedCard` 是「上架记录」那一页的数据（价格、上架时间、
 * 汇总数量），要价、要来源库，这儿一样都没有 —— 硬塞一条假记录比不塞更坏。
 * 代价说清楚：**「上架记录」页不会因此多出这些卡**，它们只是进了「已上架库」那张列表，
 * 并且从此刻起可以被订单拣走。要补真记录还得走「上架记录」那条路（人工面板 `panel.vue`）。
 *
 * 不覆盖先到的时间戳
 * ----------------
 * 过滤条件里带 `listed: { $ne: true }`：人工自己标过（带了价、带了时间）的不冲掉。
 * 这也让整件事**幂等** —— 重跑同一行不会反复写 `listedAt`。
 *
 * 顺带把「是我标的」写进卡里（V1.2.82）
 * ------------------------------------
 * 加 `listedBy:'auto-listing'` + `listedBatchId`，撤回时照这两个字段精确收回自己标的卡。
 * 上面那句 `listed: { $ne: true }` 守卫在这里还有第二层意义：一张已经被「主库」人工标过的卡
 * 会**被跳过**，于是它**不带**本功能的身份，撤回时也就**不会**被误收回 —— 正是要的行为。
 *
 * 出错不外抛
 * ----------
 * 它挂在上架流程的**成功分支**里，那时候卡已经在店里挂出去了 —— 只因为这一笔标记
 * 写失败就把整行判成失败，是拿小事掀翻大事。所以这里吞掉异常**但打字打全**
 * （带上 batchId/index），让日志里查得到。归档时还有一次兜底补标（`batches.js`）。
 */
const Card = require('../models/Card');

// 本功能的身份标记。全仓只有 `取消已上架` 认这枚字，别的路径不要复用。
const 本功能 = 'auto-listing';

/**
 * @param {Object}   o
 * @param {String[]} o.serialList  这一行压着的实体卡位号（ListingQueue.serialList）
 * @param {String}   o.userId
 * @param {String}  [o.batchId]    哪个批次标的，撤回据此精确回收（V1.2.82）
 * @param {Date}    [o.at]         标成已上架的时刻，默认现在
 * @param {String}  [o.位置]       出错日志里用来定位（如 `批次 xx 第 3 行`）
 * @returns {Promise<Number>} 真的被翻过来的张数（0 = 本来就已经标过，或者号对不上）
 */
async function 标记已上架({ serialList, userId, batchId = null, at, 位置 = '' } = {}) {
  // 没有号就什么都别做 —— 早年的行可能没写 serialList，
  // 那种情况下按 code 兜底会**误伤同编号的其他实体卡**（同库同编号常有多张），宁可不标。
  const 号们 = [...new Set((serialList || []).map(s => String(s || '').trim()).filter(Boolean))];
  if (号们.length === 0) return 0;

  try {
    const r = await Card.updateMany(
      { serial: { $in: 号们 }, userId, listed: { $ne: true } },
      { $set: { listed: true, listedAt: at || new Date(), listedBy: 本功能, listedBatchId: batchId } }
    );
    return (r && (r.modifiedCount ?? r.n)) || 0;
  } catch (e) {
    console.error(`[listing] 标「已上架」失败${位置 ? '（' + 位置 + '）' : ''}：`
      + `${e.message} —— 这 ${号们.length} 张卡位号仍是 listed:false，`
      + `订单凑库（只认 listed:true）拣不到它们，界面上只会显示「未凑库」：`
      + `${号们.slice(0, 5).join(',')}${号们.length > 5 ? ' …' : ''}`);
    return 0;
  }
}

/**
 * 撤回一批上架时，把这些库里**本功能标的**卡提出凑库池。
 *
 * 为什么必须有这一枚
 * ----------------
 * 「撤回」的语义是**整批作废**：库的状态照快照还回 `pending`、卡位号和原图也还原，
 * 这些卡不再上架卖了。可 `listed` 是**另一个开关**，撤回不碰它 ——
 * 上面刚标了一批 `true`，撤回后那些卡**仍留在凑库池里**，会被订单当成"已上架的货"拣走
 * （拣的是一批已经撤下来的卡）。库里也没有任何界面能顺手把它翻回来（只有
 * `master-library` 的「取消已上架」那个逃生口）。卡不是丢了，是**还在池子里冒充在卖的货**，
 * 比丢了更难查。
 *
 * 为什么只在**库里**找，不按 serialList
 * -----------------------------------
 * 已归档那批的卡位号被 `compactLibrarySerials` 重排过，队列里的 serialList 早对不上现在的
 * `Card.serial`。所以改用「这批锁的库」这个范围 —— 库里现在还是 `listed` 的，就是这批标的。
 * 全仓没有任何路径会改 `Card.libraryCode`（撤回只还原 serial/origImg），所以这个范围不会
 * "搬库漏收"。
 *
 * 认身份，不认「两个 null」（V1.2.82）
 * -----------------------------------
 * 老办法靠 `listedPrice: null` + `listingId: null` 分辨来源，但这**分辨不出来** ——
 * 「主库」`routes/master-library/index.js` 标记时写的是 `listingId: listingId || null`，
 * 而调用方 `master-library.vue` 根本不传 listingId，落库就是 `null`；`listedPrice` 默认也是 null。
 * 于是人工标的卡跟本功能标的卡**逐字段同形**，撤回会把人工标的那些也一起抹掉 →
 * 它们从凑库池里凭空消失（卡还在库里，就是凑不到订单）。
 * 现在改成认 `listedBy: 'auto-listing'` + `listedBatchId` 这枚**专用身份**，别的路径不写它。
 *
 * 返回三个数，不是一个（口径很重要）
 * --------------------------------
 *   - `收回`：真收回来了几张；
 *   - `漏收`：**真异常**，正常恒为 0 —— 本功能标过、但不是这个批次的（含没有批次号的旧标记）。
 *     非 0 说明身份没写成功或有残留，这才要报警；
 *   - `他标`：**预期**（主库/上架记录标的、以及加身份字段之前的旧标记），只记日志不报警。
 * 只报"这批库里还剩 N 张 listed:true"是不行的 —— 那是常态，天天响等于不响。
 */
async function 取消已上架({ libraryCodes, userId, batchId = null, 位置 = '' } = {}) {
  const 库们 = [...new Set((libraryCodes || []).map(s => String(s || '').trim()).filter(Boolean))];
  if (库们.length === 0) return { 收回: 0, 漏收: 0, 他标: 0 };
  try {
    const r = await Card.updateMany(
      { libraryCode: { $in: 库们 }, userId, listed: true, listedBy: 本功能, listedBatchId: batchId },
      { $set: { listed: false, listedAt: null, listedBy: null, listedBatchId: null } }
    );
    const 收回 = (r && (r.modifiedCount ?? r.n)) || 0;
    const 漏收 = await Card.countDocuments({
      libraryCode: { $in: 库们 }, userId, listed: true, listedBy: 本功能, listedBatchId: { $ne: batchId },
    });
    const 他标 = await Card.countDocuments({
      libraryCode: { $in: 库们 }, userId, listed: true, listedBy: { $ne: 本功能 },
    });
    return { 收回, 漏收, 他标 };
  } catch (e) {
    console.error(`[listing] 撤回时取消「已上架」标记失败${位置 ? '（' + 位置 + '）' : ''}：${e.message}`
      + ` —— 这些库上被标过的卡仍是 listed:true，撤回后还在凑库池里（会被订单拣走），`
      + `要手工退出请用「主库」那个「取消已上架」：${库们.slice(0, 5).join(',')}${库们.length > 5 ? ' …' : ''}`);
    return { 收回: 0, 漏收: 0, 他标: 0, 出错: true };
  }
}

module.exports = { 标记已上架, 取消已上架 };
