/**
 * 订单 API — 订单三库：orders / order_cards / order_picks
 *
 * 订单编号: 18位 = 交易时间(YYYYMMDDHHMMSS) + 4位随机
 * 状态流转: ''(空) → pending(待处理) → picking(待拣卡) → shipping(待发货) → done(已完成)
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const auth = require('../../middleware/auth');
const Order = require('../../models/Order');
const OrderCard = require('../../models/OrderCard');
const OrderPick = require('../../models/OrderPick');
const OrderPhoto = require('../../models/OrderPhoto');
const Card = require('../../models/Card');
const CardCatalog = require('../../models/CardCatalog');
// 卡名已不存 cardcatalogs，取名字一律走这里（见 services/cardNames.js 顶上那段）
const 卡名 = require('../../services/cardNames');
const StockCode = require('../../models/StockCode');
const { generateOrderNo, parseTradeTime, shortName, cardNo } = require('../../utils/orderNo');
const jwt = require('jsonwebtoken');
const config = require('../../config');

// 状态流转顺序
// 待处理('' / pending) → 待拣卡(picking)：一步到位（通过时删除出库+压缩卡位）
const PASS_FLOW = { '': 'picking', pending: 'picking', picking: 'shipping', shipping: 'done', done: 'done' };

// 通过请求进程内锁：防止双击/网络重试并发导致重复出库、卡位重排错乱
const passingLocks = new Set();

// 库内卡位压实 / 卡数同步 —— 原先就长在本文件里，现在搬到 services 供上架归档共用（行为未改）
const { compactLibrarySerials, syncStockCode } = require('../../services/librarySerials');

/** 解析卡牌编号括号（异画）：QCAC-JP019(初版) → { parsedCode: 'QCAC-JP019', altLabel: '初版' } */
const parseCode = (code = '') => {
  const m = String(code).match(/^(.+?)\((.+)\)$/);
  if (m) return { parsedCode: m[1].trim(), altLabel: m[2].trim() };
  return { parsedCode: code.trim(), altLabel: '' };
};

/**
 * 卡牌增/删/改后失效凑库结果：清空拣货清单 + 重置全部卡牌匹配标记/卡图，强制重新凑库
 * （"订单卡牌没变过就保留，变了就重新解析"——只在未进入拣卡阶段的订单使用）
 */
const invalidateParse = async (order) => {
  await OrderPick.deleteMany({ orderNo: order.orderNo, userId: order.userId });
  await OrderCard.updateMany({ orderNo: order.orderNo }, { $set: { img: '', origImg: '', matched: false, missing: 0 } });
  order.allPicked = false;
  order.parsed = false;
};

/** 从订单编号解析交易时间，非法/自定义编号则回退当前时间 */
const safeTradeTime = (orderNo) => {
  const t = parseTradeTime(orderNo);
  if (!t || isNaN(t.getTime())) return new Date();
  return t;
};

/**
 * 解析买家信息 → { name, phone, address }
 * 支持: 字符串(合并行) "张先生 13999953090 新疆...158号" 或 对象 { name, phone, address }
 * 合并行按 11 位手机号定位拆分：手机号前=姓名，后=地址；无手机号则按空格 第一段=姓名 其余=地址
 */
const parseBuyerInfo = (buyerInfo) => {
  if (buyerInfo && typeof buyerInfo === 'object' && !Array.isArray(buyerInfo)) {
    return {
      name: String(buyerInfo.name || '').trim(),
      phone: String(buyerInfo.phone || '').trim(),
      address: String(buyerInfo.address || '').trim(),
    };
  }
  const text = String(buyerInfo || '').trim();
  if (!text) return { name: '', phone: '', address: '' };
  const phoneMatch = text.match(/1[3-9]\d{9}/); // 大陆11位手机号
  if (phoneMatch) {
    const idx = text.indexOf(phoneMatch[0]);
    return {
      name: text.slice(0, idx).trim(),
      phone: phoneMatch[0],
      address: text.slice(idx + phoneMatch[0].length).trim(),
    };
  }
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return { name: parts[0], phone: '', address: parts.slice(1).join(' ') };
  return { name: parts[0] || '', phone: '', address: '' };
};

// ==================== 创建 / 查询订单 ====================

// POST /v1/api/orders — 创建订单
router.post('/', auth, async (req, res) => {
  try {
    const { buyerInfo, note, status, orderNo: customNo, courierCode, pickupCode } = req.body;
    // 订单编号: 前端手工传入则用(查重)，否则自动生成18位
    let orderNo;
    if (customNo && String(customNo).trim()) {
      orderNo = String(customNo).trim();
      const exist = await Order.findOne({ orderNo });
      if (exist) return res.status(400).json({ error: '该订单编号已存在，请换一个' });
    } else {
      let tries = 0;
      do {
        orderNo = generateOrderNo();
        tries++;
        const exist = await Order.findOne({ orderNo });
        if (!exist) break;
      } while (tries < 5);
    }
    const short = shortName(orderNo); // 简称统一 = 订单+后4位（无论自动还是手工编号）

    const buyer = parseBuyerInfo(buyerInfo);
    const order = await Order.create({
      orderNo,
      shortName: short,
      tradeTime: safeTradeTime(orderNo),
      status: status || '',
      buyerInfo: {
        name: buyer.name,
        phone: buyer.phone,
        address: buyer.address,
        note: String(note || '').trim()
          || (buyerInfo && typeof buyerInfo === 'object' ? String(buyerInfo.note || '').trim() : ''),
      },
      courierCode: String(courierCode || '').trim(),
      pickupCode: String(pickupCode || '').trim(),
      userId: req.user.id,
    });
    res.status(201).json(order);
  } catch (e) {
    console.error('Create order error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/orders?status=&page=&pageSize=&keyword=&sort= — 订单列表（分页 + 每状态计数 + 关键字搜索）
// status: all(全部)/''(待处理=空+pending)/picking/shipping/done
// sort: pass(默认, 待处理/全部按创建时间升序=第1单最早, 其余按进入该状态时间升序) / created(按创建时间倒序)
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, keyword, sort } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

    const q = { userId };
    // 状态过滤：待处理 tab(pending) = 空状态 '' 与 pending 一起显示（两者都是"待处理"）
    if (status && status !== 'all') {
      q.status = (status === 'pending') ? { $in: ['', 'pending'] } : status;
    } else if (status === '') {
      q.status = { $in: ['', 'pending'] };
    }
    // 关键字搜索：编号/简称/买家姓名/电话/快递码/取件码
    if (keyword && String(keyword).trim()) {
      const kw = new RegExp(String(keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [
        { orderNo: kw },
        { shortName: kw },
        { 'buyerInfo.name': kw },
        { 'buyerInfo.phone': kw },
        { courierCode: kw },
        { pickupCode: kw },
      ];
    }

    // 每状态数量（tab 角标；不随关键字过滤，始终统计该用户全部订单）
    const countsAgg = await Order.aggregate([
      { $match: { userId } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const counts = {};
    let totalCount = 0;
    countsAgg.forEach(c => { counts[c._id || ''] = c.n; totalCount += c.n; });

    // 排序：pass=按进入当前状态时间升序(先进入先排第1单)；created=按创建时间倒序(最新在上)
    let sortQ = { createdAt: 1 };
    if (sort !== 'created') {
      if (status === 'picking') sortQ = { 'passPicked.at': 1, _id: 1 };
      else if (status === 'shipping') sortQ = { 'passShipping.at': 1, _id: 1 };
      else if (status === 'done') sortQ = { 'passDone.at': 1, _id: 1 };
    } else {
      sortQ = { createdAt: -1 };
    }

    const total = await Order.countDocuments(q);
    const list = await Order.find(q).sort(sortQ).skip((page - 1) * pageSize).limit(pageSize).lean();
    if (list.length) {
      // 给每个订单附精简卡牌列表（订单列表视图：第一张卡图 + 卡名×数量），一次聚合查询 + 卡目录中文名映射
      const orderNos = list.map(o => o.orderNo);
      const cards = await OrderCard.find({ orderNo: { $in: orderNos } }).sort({ lineNo: 1 }).lean();
      const codes = [...new Set(cards.map(c => (c.parsedCode || '').trim().toUpperCase()).filter(Boolean))];
      let cnMap = {};
      if (codes.length) {
        const cat = await CardCatalog.find({ code: { $in: codes } }).select('code extCode').lean();
        await 卡名.回填(cat);      // 名字从唯一目录换回来（cardcatalogs 已不存名字）
        cnMap = Object.fromEntries(cat.map(c => [c.code, c.cnName]));
      }
      const byOrder = {};
      cards.forEach(c => {
        (byOrder[c.orderNo] = byOrder[c.orderNo] || []).push({
          code: c.code,
          parsedCode: c.parsedCode,
          cnName: cnMap[(c.parsedCode || '').trim().toUpperCase()] || '',
          qty: c.qty,
          rarity: c.rarity,   // 订单框第一张卡图要按 {编号}+{罕贵} 现拼，缺它就退化成兜底链（V1.2.86）
          altLabel: c.altLabel, // 异画标签：客户端拿它反查异画号，否则异画卡会显示成原画
          img: c.img,         // 恒空（见上面 parse 里那段说明）；留着不删是为了不动响应形状
          origImg: c.origImg,
        });
      });
      list.forEach(o => { o.cardList = byOrder[o.orderNo] || []; });
    }
    res.json({ list, total, page, pageSize, hasMore: page * pageSize < total, counts, totalCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/orders/:orderNo — 订单详情（含卡牌 + 拣货清单）
// ?fresh=1: 重新进入订单 → 清空旧凑库结果，需重新凑库解析（仅未进入拣卡阶段的订单）
router.get('/:orderNo', auth, async (req, res) => {
  try {
    const order = await Order.findOne({ orderNo: req.params.orderNo, userId: req.user.id }).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (req.query.fresh === '1' && (!order.status || order.status === 'pending')) {
      await OrderPick.deleteMany({ orderNo: order.orderNo, userId: req.user.id });
      // 清空卡图与匹配标记 → 未解析状态显示卡背/白底
      await OrderCard.updateMany({ orderNo: order.orderNo }, { $set: { img: '', origImg: '', matched: false, missing: 0 } });
      await Order.updateOne({ _id: order._id }, { $set: { allPicked: false, parsed: false } });
      order.allPicked = false;
      order.parsed = false;
    }

    const cards = await OrderCard.find({ orderNo: order.orderNo }).sort({ lineNo: 1 }).lean();
    const picks = await OrderPick.find({ orderNo: order.orderNo }).sort({ _id: 1 }).lean();

    // 给每张卡附带它的拣货明细
    const cardMap = {};
    picks.forEach(p => {
      if (!cardMap[p.cardNo]) cardMap[p.cardNo] = [];
      cardMap[p.cardNo].push(p);
    });
    const cardsWithPicks = cards.map(c => ({ ...c, picks: cardMap[c.cardNo] || [] }));

    res.json({ ...order, cards: cardsWithPicks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /v1/api/orders/:orderNo — 编辑订单（买家信息 + 订单编号重命名）
router.put('/:orderNo', auth, async (req, res) => {
  try {
    const { buyerInfo, note, orderNo: newNo, courierCode, pickupCode } = req.body;
    const order = await Order.findOne({ orderNo: req.params.orderNo, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (courierCode !== undefined) order.courierCode = String(courierCode).trim();
    if (pickupCode !== undefined) order.pickupCode = String(pickupCode).trim();

    if (buyerInfo !== undefined) {
      const buyer = parseBuyerInfo(buyerInfo);
      order.buyerInfo = {
        name: buyer.name,
        phone: buyer.phone,
        address: buyer.address,
        note: String(note || '').trim()
          || (buyerInfo && typeof buyerInfo === 'object' ? String(buyerInfo.note || '').trim() : '')
          || order.buyerInfo?.note || '',
      };
    }

    // 改订单编号: 查重 + 级联更新 order_cards / order_picks / order_photos
    if (newNo && String(newNo).trim() && String(newNo).trim() !== order.orderNo) {
      // 仅待处理(空/pending)允许改号；拣卡后订单编号是"身份"，锁定不可改
      if (order.status && order.status !== '' && order.status !== 'pending') {
        return res.status(400).json({ error: '订单已进入拣卡阶段，订单编号不可修改' });
      }
      const newOrderNo = String(newNo).trim();
      const exist = await Order.findOne({ orderNo: newOrderNo });
      if (exist) return res.status(400).json({ error: '该订单编号已存在，请换一个' });
      const oldOrderNo = order.orderNo;
      const cards = await OrderCard.find({ orderNo: oldOrderNo });
      for (const c of cards) {
        const newCardNo = cardNo(newOrderNo, c.lineNo);
        await OrderCard.updateOne({ _id: c._id }, { $set: { orderNo: newOrderNo, cardNo: newCardNo } });
        await OrderPick.updateMany({ cardNo: c.cardNo }, { $set: { orderNo: newOrderNo, cardNo: newCardNo } });
      }
      // 级联迁移拍照留痕：更新 orderNo + 重命名磁盘文件，避免改号后照片孤儿/照片墙空白
      const photos = await OrderPhoto.find({ orderNo: oldOrderNo });
      for (const ph of photos) {
        const ext = path.extname(ph.filename) || '.jpg';
        const newFilename = `${newOrderNo}-${ph.index}${ext}`;
        const oldFp = path.join(photoDir, ph.filename);
        const newFp = path.join(photoDir, newFilename);
        try { if (fs.existsSync(oldFp)) fs.renameSync(oldFp, newFp); } catch (e) { /* 文件缺失也继续迁移记录 */ }
        await OrderPhoto.updateOne({ _id: ph._id }, {
          $set: { orderNo: newOrderNo, filename: newFilename, path: `/uploads/order-photos/${newFilename}` },
        });
      }
      order.orderNo = newOrderNo;
      order.shortName = shortName(newOrderNo); // 简称统一 = 订单+后4位（无论自动还是手工编号）
      order.tradeTime = safeTradeTime(newOrderNo);
    }

    await order.save();
    res.json(order);
  } catch (e) {
    console.error('Update order error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /v1/api/orders/:orderNo — 删除订单（连同订单卡牌与拣货清单全部清空）
router.delete('/:orderNo', auth, async (req, res) => {
  try {
    const { orderNo } = req.params;
    const order = await Order.findOne({ orderNo, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await OrderCard.deleteMany({ orderNo, userId: req.user.id });
    await OrderPick.deleteMany({ orderNo, userId: req.user.id });
    // 删除订单的拍照留痕：磁盘文件 + order_photos 记录，避免孤儿照片残留
    const photos = await OrderPhoto.find({ orderNo }).lean();
    for (const ph of photos) {
      const fp = path.join(photoDir, ph.filename);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* 文件缺失也允许删记录 */ }
      await OrderPhoto.deleteOne({ _id: ph._id });
    }
    await Order.deleteOne({ _id: order._id });

    res.json({ success: true, deleted: order.orderNo });
  } catch (e) {
    console.error('Delete order error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== 订单卡牌 (order_cards) ====================

// POST /v1/api/orders/:orderNo/cards — 添加卡牌
router.post('/:orderNo/cards', auth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' });
    }
    const order = await Order.findOne({ orderNo: req.params.orderNo, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    // 拣卡后卡牌不可再增改删（身份/库存已锁定）
    if (order.status && order.status !== '' && order.status !== 'pending') {
      return res.status(400).json({ error: '订单已进入拣卡阶段，卡牌不可再修改' });
    }

    // 取已有最大 lineNo
    const last = await OrderCard.findOne({ orderNo: order.orderNo }).sort({ lineNo: -1 }).lean();
    let lineNo = (last?.lineNo || 0);

    const docs = items.map((item) => {
      lineNo++;
      const { parsedCode, altLabel } = parseCode(item.code);
      return {
        cardNo: cardNo(order.orderNo, lineNo),
        orderNo: order.orderNo,
        lineNo,
        code: item.code || '',
        parsedCode,
        altLabel,
        rarity: item.rarity || '',
        qty: item.qty || 1,
        condition: item.condition || '流通品相',
        note: item.note || '',
        userId: req.user.id,
      };
    });
    await OrderCard.insertMany(docs);

    // 更新订单卡牌总数
    const total = await OrderCard.aggregate([
      { $match: { orderNo: order.orderNo } },
      { $group: { _id: null, sum: { $sum: '$qty' } } },
    ]);
    order.totalCards = total[0]?.sum || 0;
    // 卡牌已变更：失效旧凑库结果（清拣货/清匹配标记），需重新凑库
    await invalidateParse(order);
    await order.save();

    res.status(201).json({ added: docs.length, totalCards: order.totalCards, cards: docs });
  } catch (e) {
    console.error('Add order cards error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /v1/api/orders/:orderNo/cards/:cardNo — 删除卡牌
router.delete('/:orderNo/cards/:cardNo', auth, async (req, res) => {
  try {
    const { orderNo, cardNo: cno } = req.params;
    const order = await Order.findOne({ orderNo, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    // 拣卡后卡牌不可再增改删（身份/库存已锁定）
    if (order.status && order.status !== '' && order.status !== 'pending') {
      return res.status(400).json({ error: '订单已进入拣卡阶段，卡牌不可再修改' });
    }

    const del = await OrderCard.deleteOne({ orderNo, cardNo: cno, userId: req.user.id });
    if (!del.deletedCount) return res.status(404).json({ error: 'Card not found' });

    // 卡牌已变更：失效旧凑库结果（清拣货/清匹配标记），需重新凑库
    await invalidateParse(order);

    // 重算总数
    const total = await OrderCard.aggregate([
      { $match: { orderNo } },
      { $group: { _id: null, sum: { $sum: '$qty' } } },
    ]);
    order.totalCards = total[0]?.sum || 0;
    await order.save();

    res.json({ success: true, totalCards: order.totalCards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /v1/api/orders/:orderNo/cards/:cardNo — 编辑卡牌（code/rarity/qty/note）
router.put('/:orderNo/cards/:cardNo', auth, async (req, res) => {
  try {
    const { orderNo, cardNo: cno } = req.params;
    const { code, rarity, qty, condition, note } = req.body;
    const order = await Order.findOne({ orderNo, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    // 拣卡后卡牌不可再增改删（身份/库存已锁定）
    if (order.status && order.status !== '' && order.status !== 'pending') {
      return res.status(400).json({ error: '订单已进入拣卡阶段，卡牌不可再修改' });
    }

    const card = await OrderCard.findOne({ orderNo, cardNo: cno, userId: req.user.id });
    if (!card) return res.status(404).json({ error: 'Card not found' });

    if (code !== undefined) {
      const { parsedCode, altLabel } = parseCode(code);
      card.code = code;
      card.parsedCode = parsedCode;
      card.altLabel = altLabel;
    }
    if (rarity !== undefined) card.rarity = rarity;
    if (qty !== undefined) card.qty = parseInt(qty, 10) || 1;
    if (condition !== undefined) card.condition = condition || '流通品相';
    if (note !== undefined) card.note = note;
    await card.save();

    // 卡牌信息已变：失效旧凑库结果（清拣货/清匹配标记/parsed/allPicked），需重新凑库
    await invalidateParse(order);

    // 重算订单卡牌总数
    const total = await OrderCard.aggregate([
      { $match: { orderNo } },
      { $group: { _id: null, sum: { $sum: '$qty' } } },
    ]);
    order.totalCards = total[0]?.sum || 0;
    await order.save();

    res.json({ success: true, card, totalCards: order.totalCards });
  } catch (e) {
    console.error('Update order card error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== 凑库解析 (order_cards → order_picks) ====================

/**
 * 凑库方案: 对订单每张卡，按 code+rarity 找所有库存卡（**已上架**）
 * 库编号数值升序（A0-000-01 < A0-000-02 < A0-000-10），逐库累加数量
 * 凑够目标 qty 即停；不足则返回缺口提示
 *
 * ⚠️ 池子是 `{ listed: true }`。「已上架」= 这张实体卡已经挂到店里卖出去了，
 * 订单才会来，所以**只有已上架的卡才该被订单拣走**；未上架的是还没挂出去的东西。
 *
 * 这句条件在 V1.2.87 之前**是写反的**（`{ listed: false }`），而它错了很久没人发现：
 * 那时**没有任何代码会自动标 `listed:true`**（只有「上架记录」那条人工路径会标），
 * 全库都是 `false` —— 一句写反的条件被"全库都是 false"恰好掩盖，等于没筛，看着一直正常。
 * V1.2.78 让「一键上架跑成功就自动标 true」之后，池子当场清空：每张卡都判「未凑库」。
 *
 * 谁进池、谁出池：`services/listingMarkListed.js`
 * （一键上架成功 → 入池；撤回一批 → 出池）。
 */
router.post('/:orderNo/parse', auth, async (req, res) => {
  try {
    const order = await Order.findOne({ orderNo: req.params.orderNo, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const cards = await OrderCard.find({ orderNo: order.orderNo }).sort({ lineNo: 1 }).lean();
    if (cards.length === 0) return res.status(400).json({ error: '订单还没有卡牌' });

    // 一次性查所有可能涉及的库存卡（**已上架** —— 见上面那段：上架了才会卖出去、才会有订单）
    const q = { listed: true };
    const parsedCodes = [...new Set(cards.map(c => c.parsedCode))];
    q.code = { $in: parsedCodes };
    const stockCards = await Card.find(q).lean();

    // 收集涉及的库编号 → 查 StockCode 数值字段用于排序
    const libCodes = [...new Set(stockCards.map(c => c.libraryCode))];
    const libs = await StockCode.find({ fullCode: { $in: libCodes } }).lean();
    const libMap = {};
    libs.forEach(l => { libMap[l.fullCode] = l; });
    // 数值升序排序: prefix+zone, seq, subSeq（库存库缺 StockCode 记录时按 0 兜底，避免崩溃）
    const sortedLibCodes = [...new Set(libCodes)].sort((a, b) => {
      const la = libMap[a] || {}, lb = libMap[b] || {};
      const keyA = `${la.prefix || ''}${String(la.zone == null ? 0 : la.zone).padStart(2, '0')}-${String(la.seq == null ? 0 : la.seq).padStart(3, '0')}-${String(la.subSeq == null ? 0 : la.subSeq).padStart(2, '0')}`;
      const keyB = `${lb.prefix || ''}${String(lb.zone == null ? 0 : lb.zone).padStart(2, '0')}-${String(lb.seq == null ? 0 : lb.seq).padStart(3, '0')}-${String(lb.subSeq == null ? 0 : lb.subSeq).padStart(2, '0')}`;
      return keyA.localeCompare(keyB);
    });

    // 按库分组: 每个(库, 匹配键) 记录每一张具体卡的精确位置(serial, 如 A0-000-04-0005)
    // code + rarity + 异画 + 备注 全等匹配，凑库精确到具体卡位
    const libCards = {}; // libCode -> { key: [{ serial, cardId, img, origImg }] }
    stockCards.forEach(c => {
      const k = `${c.code}|${c.rarity || ''}|${c.altLabel || ''}|${c.note || ''}`;
      if (!libCards[c.libraryCode]) libCards[c.libraryCode] = {};
      if (!libCards[c.libraryCode][k]) libCards[c.libraryCode][k] = [];
      libCards[c.libraryCode][k].push({
        serial: c.serial || c.libraryCode,
        cardId: c._id,
        img: c.img || '',
        origImg: c.origImg || '',
        jpName: c.jpName || '',
        cnName: c.cnName || '',
        extCode: c.extCode || '',
        condition: c.condition || '',
        altArtIndex: c.altArtIndex || 0,
      });
    });

    // 清空旧拣货清单，重新生成
    await OrderPick.deleteMany({ orderNo: order.orderNo, userId: req.user.id });

    // 1) 先聚合: 同一编号+罕贵+异画+备注 的订单卡合并为一组、合计需求总量。
    //    避免多行同编号卡各自按"完整库存计数"匹配 → 同一批物理卡被重复占用。
    const groupMap = new Map(); // key -> { key, totalQty, lines: [{ card, remaining, picked }] }
    for (const card of cards) {
      // 匹配键: 编号+罕贵度+异画+备注 全等，备注为空则只匹配库存里备注也为空的卡
      const key = `${card.parsedCode}|${card.rarity || ''}|${card.altLabel || ''}|${card.note || ''}`;
      if (!groupMap.has(key)) groupMap.set(key, { key, totalQty: 0, lines: [] });
      const g = groupMap.get(key);
      g.totalQty += card.qty;
      g.lines.push({ card, remaining: card.qty, picked: [], img: '', origImg: '', condition: '' });
    }

    const pickDocs = [];
    let ok = true;

    // 2) 逐组一次性消耗库存: 每从某库取走一张具体卡(splice 即消耗)，同库卡绝不被多行重复占用；
    //    组内每张具体卡按订单卡行顺序回填(先处理第一行, 再处理第二行)，拣货精确到卡位
    for (const g of groupMap.values()) {
      for (const libCode of sortedLibCodes) {
        if (g.totalQty <= 0) break;
        const avail = libCards[libCode]?.[g.key] || [];
        if (avail.length <= 0) continue;
        const taken = avail.splice(0, g.totalQty); // 精确取出本库最多 totalQty 张具体卡
        g.totalQty -= taken.length;
        for (const pc of taken) {
          for (const line of g.lines) {
            if (line.remaining <= 0) continue;
            line.remaining -= 1;
            if (!line.img && !line.origImg) { // 记录该订单卡的卡图（取第一张匹配库存卡）
              // 只记 `origImg`（实拍原图）—— 库存卡上**真有的**就是它（清库前 38,767 张里 99.88%）。
              //
              // 这里原来还试着拼一张 YGO 图地址，用的是 `pc.extCode` / `pc.img`：两个都是死字段
              // （`Card.extCode` 0.11%、`Card.img` 0.00%，后者在建卡时就被硬编码成 `''`），
              // 拼出来恒为空串 —— 看着像在做卡图，其实什么都没做（V1.2.86 查"整页恒卡背"时挖出来的）。
              //
              // 官方图改由**前端**按 `{编号}+{罕贵}` 现拼，卡密问目录要（见 Client/src/api/cardDb.js）。
              // 不在服务端拼、也不落库：卡密是**目录**的属性，存进 order_cards 就会随目录更新而过期。
              line.origImg = pc.origImg || '';
              line.condition = pc.condition || '流通品相'; // 品相同样取自第一张匹配库存卡
              line.img = '';                                // 刻意留空：官方图不在这儿拼，前端现拼
            }
            line.picked.push({ libraryCode: libCode, position: pc.serial, qty: 1 });
            pickDocs.push({
              cardNo: line.card.cardNo,
              cardId: line.card._id,
              // 库存卡自己的 _id（跟上面 cardId 不是一回事：那个是 order_cards 的）。
              // 出库时按它删最准 —— `{libraryCode, serial}` 万一有重复就会删错卡。
              stockCardId: pc.cardId,
              orderNo: order.orderNo,
              code: line.card.parsedCode,
              rarity: line.card.rarity,
              altLabel: line.card.altLabel,
              note: line.card.note || '',
              jpName: pc.jpName || '',   // 快照库存卡名称/卡密/品相 → 通过删库存后拣卡页仍可显示
              cnName: pc.cnName || '',
              extCode: pc.extCode || '',
              condition: pc.condition || '',
              libraryCode: libCode,
              position: pc.serial,
              qty: 1,
              pickStatus: 'pending',
              userId: req.user.id,
            });
            break;
          }
        }
      }
    }

    // 回写每张订单卡：匹配状态(matched) + 卡图（匹配到的用库存卡**实拍原图** origImg；
    // img 恒为空，官方图由前端按编号现拼；未匹配的 origImg 也空 → 前端仍是淡红底 + 「未凑库」，
    // 但卡图照样出（目录图只认编号+罕贵，跟凑没凑到库存无关））
    const cardUpdates = [];
    for (const g of groupMap.values()) {
      for (const line of g.lines) {
        cardUpdates.push({ _id: line.card._id, matched: line.remaining <= 0, missing: line.remaining, img: line.img || '', origImg: line.origImg || '', condition: line.condition || '流通品相' });
      }
    }
    if (cardUpdates.length) {
      await Promise.all(cardUpdates.map(u => OrderCard.updateOne({ _id: u._id }, { $set: { img: u.img, origImg: u.origImg, matched: u.matched, missing: u.missing, condition: u.condition } })));
    }

    // 3) 汇总结果（按订单卡行序输出，前端卡牌列表一一对应）
    const results = [];
    for (const g of groupMap.values()) {
      for (const line of g.lines) {
        const card = line.card;
        const matched = card.qty - line.remaining;
        results.push({
          cardNo: card.cardNo, code: card.code, rarity: card.rarity, note: card.note || '',
          target: card.qty, matched, missing: line.remaining,
          ok: line.remaining <= 0, picks: line.picked,
        });
        if (line.remaining > 0) ok = false;
      }
    }
    results.sort((a, b) => a.cardNo.localeCompare(b.cardNo));

    if (pickDocs.length) await OrderPick.insertMany(pickDocs);

    order.allPicked = ok;
    order.parsed = true; // 已执行凑库解析 → 前端据此区分"未解析"与"解析后缺货"
    await order.save();

    res.json({ success: ok, allPicked: ok, results, pickCount: pickDocs.length });
  } catch (e) {
    console.error('Parse order error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== 拣货清单 (order_picks) ====================

// GET /v1/api/orders/:orderNo/picks — 拣货清单
router.get('/:orderNo/picks', auth, async (req, res) => {
  try {
    const picks = await OrderPick.find({ orderNo: req.params.orderNo, userId: req.user.id }).sort({ _id: 1 }).lean();
    res.json({ list: picks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /v1/api/orders/:orderNo/picks/:pickId — 标记拣卡状态
router.put('/:orderNo/picks/:pickId', auth, async (req, res) => {
  try {
    const { pickStatus } = req.body;
    const pick = await OrderPick.findOneAndUpdate(
      { _id: req.params.pickId, orderNo: req.params.orderNo, userId: req.user.id },
      { $set: { pickStatus: pickStatus === 'picked' ? 'picked' : 'pending' } },
      { new: true }
    );
    if (!pick) return res.status(404).json({ error: 'Pick not found' });
    res.json(pick);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 状态流转 ====================

// POST /v1/api/orders/:orderNo/pass — 通过 → 下一状态
// 待处理 → 待拣卡：必须凑库解析且全部匹配成功(allPicked=true)；通过时删除匹配的库存卡(出库) + 库内卡位压缩前移
router.post('/:orderNo/pass', auth, async (req, res) => {
  const orderNo = req.params.orderNo;
  // 进程内锁：双击/网络重试并发时，第二次直接拒绝，避免重复出库+卡位重排错乱
  if (passingLocks.has(orderNo)) {
    return res.status(409).json({ error: '正在处理通过请求，请勿重复点击' });
  }
  passingLocks.add(orderNo);
  try {
    const order = await Order.findOne({ orderNo, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.status === 'done') {
      return res.json({ success: true, order, message: '订单已完成' });
    }

    const enteringPicking = PASS_FLOW[order.status] === 'picking';
    const enteringShipping = PASS_FLOW[order.status] === 'shipping';
    const enteringDone = PASS_FLOW[order.status] === 'done';
    // 进入待拣卡前必须凑库成功（全部匹配），否则拒绝
    if (enteringPicking && !order.allPicked) {
      return res.status(400).json({ error: '订单需先凑库解析且全部匹配成功才能通过' });
    }
    // 进入待发货前必须全部卡已确认拣到（服务端强校验，防止绕过前端直接调接口）
    if (enteringShipping) {
      const unPicked = await OrderPick.countDocuments({ orderNo, userId: req.user.id, pickStatus: { $ne: 'picked' } });
      if (unPicked > 0) {
        return res.status(400).json({ error: `还有 ${unPicked} 张卡未确认拣到，需全部点亮「已拣」才能通过` });
      }
    }
    // 进入已完成前必须填写快递码和取件码（仅 待发货→已完成 需要；待拣卡→待发货 不需要，按业务规则）
    if (enteringDone && (!String(order.courierCode || '').trim() || !String(order.pickupCode || '').trim())) {
      return res.status(400).json({ error: '进入已完成前请先填写快递码和取件码' });
    }
    // 进入已完成前必须至少一张拍照留痕，否则拒绝
    if (enteringDone) {
      const photoCount = await OrderPhoto.countDocuments({ orderNo });
      if (!photoCount) return res.status(400).json({ error: '进入已完成前请先拍照留痕' });
    }

    // 进入待拣卡：先出库（删除该订单匹配的库存卡 + 压缩受影响库的卡位），再做状态流转
    // 顺序原因：出库若中途失败，订单仍停原状态，可安全重试（重新解析会正确标缺货）；
    // 若先改状态再出库，失败会留下"订单已拣卡但库存未删"的脏数据，可能被重复出库。
    if (enteringPicking) {
      const picks = await OrderPick.find({ orderNo, userId: req.user.id }).lean();

      // === 出库前的守卫：别的订单在同一批库上还有没拣完的卡吗？ ===
      // 出库末尾要把受影响库的卡位**压实**（重排成连续号），而 `OrderPick.position` 存的就是
      // serial —— 别单的单子会被这一压挪到别的卡上。所以查的是「**别的**订单」的未完成拣货单：
      // 本单自己的还在（status 还没流转），拿它当判据就永远拦自己、什么也做不成。
      // 放在删卡**之前**：一旦开删，失败就只能停在半路。
      const libsTouched = [...new Set(picks.map(p => p.libraryCode).filter(Boolean))];
      for (const lib of libsTouched) {
        const others = await OrderPick.countDocuments({
          libraryCode: lib, pickStatus: { $ne: 'picked' }, orderNo: { $ne: orderNo },
        });
        if (others > 0) {
          return res.status(409).json({
            error: `库 ${lib} 上还有 ${others} 张别的订单没拣完的卡，出库要重排卡位会让它们指错卡，先处理完那些订单`,
          });
        }
      }

      const seen = new Set();      // (库, 卡位) 去重，一张卡只删一次
      const affected = new Set();  // 受影响库 → 待压缩
      for (const p of picks) {
        const lib = p.libraryCode || '';
        const pos = String(p.position || '').trim();
        const key = lib + '|' + pos;
        if (seen.has(key)) continue;
        seen.add(key);
        let del;
        if (p.stockCardId) {
          // 优先按库存卡自己的 _id 删。**必须走原生驱动** —— mongoose 会把 _id 按 schema
          // 转成 ObjectId，而从 JSON 灌出来的库（如 s-lan-test）_id 是字符串，一转就永远
          // 匹配不上（卡删不掉，还静默当成功）。同 services/librarySerials.js 的写法。
          del = await Card.collection.deleteOne({ _id: p.stockCardId });
        } else if (pos) {
          // 老数据没记 stockCardId：退回按 (库, 卡位) 删
          del = await Card.deleteOne({ libraryCode: lib, serial: pos });
        } else {
          // 旧数据无卡位：按 code+rarity+note 兜底删一张
          del = await Card.deleteOne({ libraryCode: lib, code: p.code || '', rarity: p.rarity || '', note: p.note || '' });
        }
        if (del && del.deletedCount) affected.add(lib);
      }
      for (const lib of affected) {
        await compactLibrarySerials(lib);
        await syncStockCode(lib);
      }
    }

    order.status = PASS_FLOW[order.status] || order.status;
    // 记录通过操作人（回溯是谁处理）：按目标状态写入对应字段
    const op = { userId: req.user.id, nickname: req.user.nickname || '', at: new Date() };
    if (order.status === 'picking') order.passPicked = op;
    else if (order.status === 'shipping') order.passShipping = op;
    else if (order.status === 'done') order.passDone = op;
    await order.save();

    res.json({ success: true, order });
  } catch (e) {
    console.error('Pass order error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    passingLocks.delete(orderNo);
  }
});

// ==================== 拍照留痕 ====================
// 文件目录: S-LAN-Local/backend/uploads/order-photos，命名 订单号-序号.jpg
const photoDir = path.join(__dirname, '../../../uploads/order-photos');

// POST /v1/api/orders/:orderNo/photos — 拍照留痕上传（前端压缩后 base64 dataURL）
router.post('/:orderNo/photos', auth, async (req, res) => {
  try {
    const order = await Order.findOne({ orderNo: req.params.orderNo, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const { dataUrl } = req.body || {};
    if (!dataUrl || !/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) {
      return res.status(400).json({ error: 'dataUrl 格式不正确（需为图片 base64 dataURL）' });
    }
    const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    const ext = (m[1] || 'jpeg').toLowerCase() === 'jpeg' ? 'jpg' : (m[1] || 'jpg').toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: '图片数据为空或超过 5MB' });
    }
    // index 取「现有最大序号 + 1」：删除中间张后重拍不会撞唯一索引（count+1 会撞上还存在的序号）
    const lastPhoto = await OrderPhoto.findOne({ orderNo: order.orderNo }).sort({ index: -1 }).select('index').lean();
    const index = (lastPhoto && lastPhoto.index != null ? lastPhoto.index : 0) + 1;
    const filename = `${order.orderNo}-${index}.${ext}`;
    fs.mkdirSync(photoDir, { recursive: true });
    fs.writeFileSync(path.join(photoDir, filename), buf);
    const photo = await OrderPhoto.create({
      orderNo: order.orderNo,
      index,
      filename,
      path: `/uploads/order-photos/${filename}`,
      userId: req.user.id,
    });
    // 同步订单已拍照张数（写订单库，刷新不丢）
    const photoCount = await OrderPhoto.countDocuments({ orderNo: order.orderNo });
    await Order.updateOne({ _id: order._id }, { $set: { photoCount } });
    res.status(201).json({ ...photo.toObject(), photoCount });
  } catch (e) {
    console.error('Upload order photo error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/orders/:orderNo/photos — 拍照留痕列表（按序号）
// 每张返回 src = API 路由直出地址（与卡图 /api/tcg/card-image 同思路，手机端可正常显示），path = 静态文件地址（后备）
router.get('/:orderNo/photos', auth, async (req, res) => {
  try {
    const order = await Order.findOne({ orderNo: req.params.orderNo, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const list = await OrderPhoto.find({ orderNo: order.orderNo }).sort({ index: 1 }).lean();
    const base = `/v1/api/orders/${order.orderNo}/photos`;
    list.forEach(p => { p.src = `${base}/${p.index}/file`; });
    res.json({ list });
  } catch (e) {
    console.error('List order photos error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/orders/:orderNo/photos/:index/file — 以 API 路由方式返回照片文件
// 鉴权：Authorization Bearer 或 ?token= 查询参数（<image> 只能带 query），防局域网任意设备访问
router.get('/:orderNo/photos/:index/file', async (req, res) => {
  try {
    const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.query.token || '');
    if (!raw) return res.status(401).json({ error: 'Unauthorized' });
    let decoded = null;
    try { decoded = jwt.verify(raw, config.jwtSecret); } catch (e) { /* fallthrough */ }
    if (!decoded || !decoded.userId) return res.status(401).json({ error: 'Unauthorized' });

    const photo = await OrderPhoto.findOne({ orderNo: req.params.orderNo, index: Number(req.params.index) }).lean();
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    // 归属校验：管理员(admin/terminal_admin)可查看全部（后台照片缓存管理需要），普通账号只能看自己订单的照片
    const isAdmin = decoded.role === 'admin' || decoded.role === 'terminal_admin';
    if (!isAdmin && photo.userId && photo.userId !== decoded.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const fp = path.join(photoDir, photo.filename);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(fp);
  } catch (e) {
    console.error('Stream order photo error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /v1/api/orders/:orderNo/photos/:index — 删除拍照留痕（删库记录 + 删文件）
router.delete('/:orderNo/photos/:index', auth, async (req, res) => {
  try {
    const order = await Order.findOne({ orderNo: req.params.orderNo, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const idx = Number(req.params.index);
    const photo = await OrderPhoto.findOne({ orderNo: order.orderNo, index: idx });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    const fp = path.join(photoDir, photo.filename);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* 文件缺失也允许删记录 */ }
    await OrderPhoto.deleteOne({ _id: photo._id });
    // 同步订单已拍照张数（写订单库，刷新不丢）
    const photoCount = await OrderPhoto.countDocuments({ orderNo: order.orderNo });
    await Order.updateOne({ _id: order._id }, { $set: { photoCount } });
    res.json({ success: true, photoCount });
  } catch (e) {
    console.error('Delete order photo error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
