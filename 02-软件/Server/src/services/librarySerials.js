/**
 * 库内卡位（serial）的两个小工具 —— 出库（orders）和上架归档（listings）都要用，所以搬到这儿。
 * 原先长在 `routes/orders/index.js:32-64`，**行为一字不改，纯搬家**，那边改成 require 这里。
 *
 * 注意 `Card.serial` 是「库里第几个」的实打实的号（A0-000-01-0001），
 * `OrderPick.position` 存的也是它 —— 所以**任何一次重排都会让未消费的拣货单失配**。
 * 谁调用 `compactLibrarySerials`，谁就得自己先确认没有未完成的拣货单指着这个库。
 */
const Card = require('../models/Card');
const StockCode = require('../models/StockCode');
const OrderPick = require('../models/OrderPick');

/**
 * 下一个可用卡位号（数字部分）—— 只用于**追加**新卡，绝不重排已有的号。
 *
 * 为什么不用 `countDocuments()+1`：库里只要被删过卡（有了空洞），这个数就会**撞上**
 * 已存在的那张。两张卡同号之后 `OrderPick.position`（存的就是 serial）指谁都说不准，
 * 而出库时那句 `Card.deleteOne({libraryCode, serial})` 会删掉错的那一张。
 * 取现有最大号 +1 才是安全的追加点。
 */
const nextSerialNum = async (libraryCode, filter = {}) => {
  const cards = await Card.find({ libraryCode, ...filter }).select('serial').lean();
  let max = 0;
  for (const c of cards) {
    const n = parseInt(String(c.serial || '').split('-').pop(), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
};

/** 数字 → 完整卡位号（A0-000-04-0005 这种） */
const makeSerial = (libraryCode, num) => `${libraryCode}-${String(num).padStart(4, '0')}`;

/**
 * 这个库上还有几张**没拣完**的拣货单？
 * `OrderPick.position` 存的就是 `Card.serial`，所以任何重排都会让这些单子对不上号。
 */
const countOpenPicks = async (libraryCode) => {
  if (!libraryCode) return 0;
  return OrderPick.countDocuments({ libraryCode, pickStatus: { $ne: 'picked' } });
};

/**
 * 重排卡位前的统一守卫：有未完成的拣货单就抛（`err.status` 带上该回的 HTTP 码）。
 * 上面那段注释写的是「谁调用谁自己先确认」—— 这就是那个「确认」，别再各写各的了。
 */
const assertNoOpenPicks = async (libraryCode) => {
  const n = await countOpenPicks(libraryCode);
  if (n > 0) {
    const err = new Error(`库 ${libraryCode} 上还有 ${n} 张未拣完的拣货单，重排卡位会让它们指错卡，先处理完再动`);
    err.status = 409;
    throw err;
  }
};

/** 库内卡位压缩前移：剩余卡按卡位号排序后重排为连续编号（0001,0002...），跳过删除的卡位依次补位 */
const compactLibrarySerials = async (libraryCode) => {
  const cards = await Card.find({ libraryCode }).lean();
  // 按 serial 数字后缀排序（解析不出的排最后）
  cards.sort((a, b) => {
    const na = parseInt(String(a.serial || '').split('-').pop(), 10) || 0;
    const nb = parseInt(String(b.serial || '').split('-').pop(), 10) || 0;
    return na - nb;
  });
  let i = 0;
  for (const c of cards) {
    i++;
    const newSerial = `${libraryCode}-${String(i).padStart(4, '0')}`;
    if (newSerial !== c.serial) {
      // 走原生驱动、用 `c._id` 本来的类型去匹配（lean 读出来是什么类型就是什么类型）。
      // `Card.updateOne({_id})` 会按 schema 把 _id 转成 ObjectId —— 正式库的 _id 确实是 ObjectId，
      // 所以那边看着正常；但从 JSON 灌出来的库（如 s-lan-test）_id 是字符串，一转就永远匹配不上，
      // 压实会**一声不响地空转**（不报错、什么也没改）。
      await Card.collection.updateOne({ _id: c._id }, { $set: { serial: newSerial } });
    }
  }
};

/** 同步 StockCode 当前卡数与库状态（与 cards 路由新增/删除一致） */
const syncStockCode = async (libraryCode) => {
  const cnt = await Card.countDocuments({ libraryCode });
  const sc = await StockCode.findOne({ fullCode: libraryCode });
  if (sc) {
    const update = { currentCards: cnt };
    if (sc.status !== 'archived' && sc.status !== 'locked' && sc.status !== 'pending') {
      if (cnt >= sc.maxCards) update.status = 'full';
      else if (cnt > 0) update.status = 'in_use';
      else update.status = 'available';
    }
    await StockCode.updateOne({ fullCode: libraryCode }, { $set: update });
  }
};

module.exports = {
  compactLibrarySerials, syncStockCode,
  countOpenPicks, assertNoOpenPicks,
  nextSerialNum, makeSerial,
};
