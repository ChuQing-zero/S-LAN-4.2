/**
 * 已上架库 API
 */
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const ListedCard = require('../../models/ListedCard');
const ListedSummary = require('../../models/ListedSummary');
const Card = require('../../models/Card');

// 汇总表的分组键 = 编号 | 罕贵度 | 品相 | 异画。
// **原来这里多带了一段 `note`**：key 说自己按 5 个维度分组，可 `$set` 只写 4 个字段
// （`note` 连 ListedSummary 的 schema 里都没有），于是「只有备注不同」的两条记录
// 会各占一行，而页面上看它们一模一样 —— 数对不上、还看不出为什么。
// 现在 key 和 `$set` 用同一组字段。（异画存在汇总表的 `altLabel` 列名里，值是 ListedCard.altArt。）
const summaryKey = (code, rarity, condition, altArt) =>
  [code || '?', rarity || '', condition || '', altArt || ''].join('|');

// 同步 ListedSummary
async function syncSummary(code, rarity, condition, altArt, delta) {
  const key = summaryKey(code, rarity, condition, altArt);
  if (delta > 0) {
    await ListedSummary.findOneAndUpdate(
      { key },
      { $set: { code: code || '?', rarity: rarity || '', condition: condition || '', altLabel: altArt || '' }, $inc: { quantity: delta } },
      { upsert: true }
    );
  } else {
    await ListedSummary.updateOne({ key }, { $inc: { quantity: delta } });
    // 清理 quantity <= 0 的记录
    await ListedSummary.deleteMany({ key, quantity: { $lte: 0 } });
  }
}

// 删掉上架记录之后，把库存卡上的「已上架」标记退回去。
// 不退的后果是实打实的：orders/index.js 凑库时筛的就是 `{ listed: true }`（V1.2.87 改正）——
// 标记留着不放，这张卡就**还留在凑库池里**，上架记录都删了却仍会被订单拣走。
// 只在「同编号 + 同来源库」已经没有任何上架记录时才退：同一张卡上架两次、删掉其中一条，
// 标记得留着。
// 只退 listed / listedAt / listedPrice —— `listingId` 不是这条路径写的
// （master-library 的 mark-listed 才写），不该由这里抹掉。
// `listedBy`/`listedBatchId` 必须一起清（V1.2.82）：只清 listed 而留下身份的话，
// 这张卡日后被别的路径标回 listed:true 时会带着旧身份，被一键上架的撤回误当成"自己标的"
// 收回去 —— 从凑库池里无辜消失。
async function unmarkCards(userId, code, sourceLibraryCode) {
  if (!sourceLibraryCode) return 0;
  const 还有 = await ListedCard.countDocuments({ userId, code, sourceLibraryCode });
  if (还有 > 0) return 0;
  const r = await Card.updateMany(
    { code, libraryCode: sourceLibraryCode, userId },
    { $set: { listed: false, listedAt: null, listedPrice: null, listedBy: null, listedBatchId: null } }
  );
  return r.modifiedCount || 0;
}

// GET /v1/api/listed-cards — 已上架列表
router.get('/', auth, async (req, res) => {
  try {
    const { rarity, condition, code, page = 1, pageSize = 20, sort = '-createdAt' } = req.query;
    const query = { userId: req.user.id };
    if (rarity) query.rarity = rarity;
    if (condition) query.condition = condition;
    if (code) query.code = { $regex: code, $options: 'i' };

    const total = await ListedCard.countDocuments(query);
    const cards = await ListedCard.find(query)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(parseInt(pageSize));

    res.json({
      list: cards,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/listed-cards/stats — 统计信息
router.get('/stats', auth, async (req, res) => {
  try {
    const query = { userId: req.user.id };
    const [total, totalValue, byRarity, byDate] = await Promise.all([
      ListedCard.countDocuments(query),
      ListedCard.aggregate([
        { $match: { userId: req.user.id } },
        { $group: { _id: null, total: { $sum: { $multiply: ['$price', '$quantity'] } }, count: { $sum: '$quantity' } } }
      ]),
      ListedCard.aggregate([
        { $match: { userId: req.user.id } },
        { $group: { _id: '$rarity', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ListedCard.aggregate([
        { $match: { userId: req.user.id } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
        { $limit: 30 }
      ])
    ]);

    res.json({
      total,
      totalCards: totalValue[0]?.count || 0,
      totalValue: totalValue[0]?.total || 0,
      byRarity: byRarity.map(r => ({ rarity: r._id, count: r.count })),
      byDate: byDate.map(d => ({ date: d._id, count: d.count }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/listed-cards — 添加上架记录
router.post('/', auth, async (req, res) => {
  try {
    const { code, rarity, condition, note, altArt, price, quantity, serial, extCode, altArtIndex, altLabel, img, versionName, isJiHuan, sourceLibraryCode, jpName, cnName } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });

    // 数量只算一次，行里和汇总里用同一个值 —— 原来行里是 `Number(quantity)||1`、
    // 汇总里却写死 `+1`，上架 3 张汇总只加 1，跟批量那条路径（按 quantity 加）也对不上。
    const qty = Number(quantity) || 1;

    const card = new ListedCard({
      code, jpName: jpName || '', cnName: cnName || '',
      rarity: rarity || '', condition: condition || '',
      note: note || '', altArt: altArt || '',
      price: Number(price) || 0, quantity: qty,
      serial: serial || '', extCode: extCode || '',
      altArtIndex: altArtIndex ?? null, altLabel: altLabel || '',
      img: img || '', versionName: versionName || '',
      isJiHuan: !!isJiHuan, sourceLibraryCode: sourceLibraryCode || '',
      userId: req.user.id
    });
    await card.save();

    // 同步汇总
    await syncSummary(code, rarity, condition, altArt, qty);

    // 同步更新 Card 模型的 listed 标记。
    // **用 updateMany**：同一个编号在同一个库里可能有多张实体卡（这个库上架的那一批就是），
    // 原来的 updateOne 只挑中其中一张，剩下的留在 `listed:false` 上 ——
    // 那些卡**进不了凑库池**：同一个库里明明整批都挂出去在卖，订单却凑不到它们。
    if (sourceLibraryCode) {
      await Card.updateMany(
        { code, libraryCode: sourceLibraryCode, userId: req.user.id },
        {
          $set: {
            listed: true,
            // 写明来源（V1.2.82）：一键上架的撤回只回收 `listedBy:'auto-listing'` 的卡，
            // 这条路径标的不会被它误抹。
            listedBy: 'listed-cards',
            listedBatchId: null,
            listedAt: new Date(),
            listedPrice: Number(price) || 0
          }
        }
      );
    }

    res.status(201).json(card);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/listed-cards/batch — 批量添加上架记录(流程完成后调用)
router.post('/batch', auth, async (req, res) => {
  try {
    const { cards, sourceLibraryCode } = req.body;
    if (!cards || !Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: 'cards array is required' });
    }

    const docs = cards.map(c => ({
      code: c.code, jpName: c.jpName || '', cnName: c.cnName || '',
      rarity: c.rarity || '', condition: c.condition || '',
      note: c.note || '', altArt: c.altArt || '',
      price: Number(c.price) || 0, quantity: Number(c.quantity) || 1,
      serial: c.serial || '', extCode: c.extCode || '',
      altArtIndex: c.altArtIndex ?? null, altLabel: c.altLabel || '',
      img: c.img || '', versionName: c.versionName || '',
      isJiHuan: !!c.isJiHuan,
      sourceLibraryCode: sourceLibraryCode || c.sourceLibraryCode || '',
      userId: req.user.id
    }));

    const result = await ListedCard.insertMany(docs);

    // 批量同步汇总（数量口径与单条一致：Number() 归一，别把字符串交给 $inc）
    for (const c of cards) {
      await syncSummary(c.code, c.rarity, c.condition, c.altArt, Number(c.quantity) || 1);
    }

    // 批量更新 Card listed 标记。
    // 按编号**逐个分组**写，而不是一条 `code:{$in:[…]}` 打天下（V1.2.82）：
    // 单条路径（上面 `:147`）会写 `listedPrice` 记下当时的价，批量这条原先漏了它 ——
    // 而一个价没法覆盖多个编号，所以只能按编号分组、各写各的价。同一个编号在这批里
    // 出现多次且价不同时取最后一个，跟汇总那条按 quantity 累加的口径不冲突。
    if (sourceLibraryCode) {
      const 按编号 = new Map();
      for (const c of cards) if (!按编号.has(c.code)) 按编号.set(c.code, Number(c.price) || 0);
      for (const [code, price] of 按编号) {
        await Card.updateMany(
          { code, libraryCode: sourceLibraryCode, userId: req.user.id },
          {
            $set: {
              listed: true,
              // 写明来源（V1.2.82）：一键上架撤回只认 `listedBy:'auto-listing'`，不碰这条路径标的卡。
              listedBy: 'listed-cards',
              listedBatchId: null,
              listedAt: new Date(),
              listedPrice: price,
            }
          }
        );
      }
    }

    res.status(201).json({ count: result.length, ids: result.map(r => r._id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /v1/api/listed-cards/:id — 删除单条
router.delete('/:id', auth, async (req, res) => {
  try {
    const card = await ListedCard.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!card) return res.status(404).json({ error: 'Not found' });
    // 汇总按这行自己的数量减（不是写死 -1），跟加的时候对称
    await syncSummary(card.code, card.rarity, card.condition, card.altArt, -(Number(card.quantity) || 1));
    // 退回库存卡上的「已上架」标记 —— 不退的话，上架记录都删了，这张卡却还留在凑库池里会被拣走
    const unmarked = await unmarkCards(req.user.id, card.code, card.sourceLibraryCode);
    res.json({ success: true, unmarked });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /v1/api/listed-cards — 清空已上架库
router.delete('/', auth, async (req, res) => {
  try {
    // 先把行取出来 —— 删完就没得算了。两件收尾都靠它：
    // 汇总要按「行自己的数量」减，卡片标记要按「编号 + 来源库」退。
    // 原来这里只 deleteMany，两处痕迹都不清：汇总数虚高、卡永远挂在 listed 上。
    const rows = await ListedCard
      .find({ userId: req.user.id })
      .select('code rarity condition altArt quantity sourceLibraryCode')
      .lean();

    const result = await ListedCard.deleteMany({ userId: req.user.id });

    // 汇总：同一个分组键的行合成一次减法（省掉一堆单行 update）
    const 汇总 = new Map();
    for (const r of rows) {
      const k = summaryKey(r.code, r.rarity, r.condition, r.altArt);
      const 项 = 汇总.get(k) || { code: r.code, rarity: r.rarity, condition: r.condition, altArt: r.altArt, delta: 0 };
      项.delta += Number(r.quantity) || 1;
      汇总.set(k, 项);
    }
    for (const v of 汇总.values()) {
      await syncSummary(v.code, v.rarity, v.condition, v.altArt, -v.delta);
    }

    // 卡片标记：同「编号 + 来源库」只退一次
    const 组合 = new Set();
    let unmarked = 0;
    for (const r of rows) {
      const k = (r.code || '') + '\u0000' + (r.sourceLibraryCode || '');
      if (组合.has(k)) continue;
      组合.add(k);
      unmarked += await unmarkCards(req.user.id, r.code, r.sourceLibraryCode);
    }

    res.json({ success: true, deleted: result.deletedCount, unmarked });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
