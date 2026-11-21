const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const Card = require('../../models/Card');
const Version = require('../../models/Version');
const CardMark = require('../../models/CardMark');
const { 分组, 造匹配器 } = require('../../services/cardMarks');

// 「这个库里有几张问题卡」—— 给前端库选择器显示成 A0-053-07(17/9)。
//
// 数字 = **正红 ⊕ 已登记 去重后的张数**，也就是「打开这个库会看到几行红/粉」。
// 一张卡如果既是识别失败、又登记过，界面上只画正红（failed 优先），
// 所以这里也**只能算一次** —— 合并成一个数给前端，不分开报。
//
// 口径必须跟 /libraries/:code/cards 里 marked / failed 的算法严格一致，
// 否则用户会对着 (17/9) 数出 17 行里只有 8 行红。两处改一处就要改另一处。
// 登记那一侧尤其别在这里手写匹配 —— 去调 services/cardMarks 的 分组()，
// 那里是 (编号, 罕贵度) + 通配的唯一口径。
//
// 范围口径也要一致，这点容易漏：本函数和上面的 cardCount 都是**按 libraryCode 全局**统计的，
// 而 /libraries/:code/cards 对本地库会再套一层 userId = req.user.id（见该路由里的 userIdFilter）。
// 两者相等依赖「一个库编号只属于一个人」这个假设 —— 实测 2026-09-29 成立（0 个编号跨用户）。
// 哪天同一个库编号被两个账号同时用（比如云端库被多端认领），斜杠后面那个数就会比
// 用户实际能翻到的行数多，得改成把 userId 一起带进 $match。
//
// 编号 / 罕贵度先归一化再比：列表接口比的是 trim + 大写，
// 而聚合里的 $in 是精确匹配，不归一化的话，哪天进来一批小写，这里会少数。
// （实测 2026-09-29：全库 38769 张卡的 code / libraryCode 都已是规范形式，
//   所以这层现在没在做事，纯粹给以后兜底。）
//
// 一次全表聚合，不是每个库查一次 —— 返回 Map<库编号, 问题张数>，查不到的库就是 0。
const FAILED_EXPR = {
  $or: [
    { $eq: ['$jpName', '识别失败'] },
    { $eq: ['$code', '---'] },
    { $eq: ['$code', '...'] },
  ],
};
const problemCountByLibrary = async () => {
  // 已登记的记录（cardmarks 是全局表，不分库、不分人）
  const marks = await CardMark.find({}).select('code rarity').lean();
  const { 通配, 成对 } = 分组(marks);
  // 两路 $or：这个编号有通配登记，或者 (编号, 罕贵度) 这一对精确上。
  // 成对那一路在聚合里现拼键 —— 跟 services/cardMarks 的 键() 是同一个格式（竖线分隔）。
  const isMarked = {
    $or: [
      { $in: ['$_n', 通配] },
      { $in: [{ $concat: ['$_n', '|', '$_r'] }, 成对] },
    ],
  };

  const rows = await Card.aggregate([
    {
      $set: {
        _n: { $toUpper: { $trim: { input: { $ifNull: ['$code', ''] } } } },
        _r: { $toUpper: { $trim: { input: { $ifNull: ['$rarity', ''] } } } },
      },
    },
    // 下面这一条 $match 选出来的就是「正红 ∪ 已登记」，所以分组时 $sum:1 天然就是去重后的张数
    { $match: { $expr: { $or: [FAILED_EXPR, isMarked] } } },
    { $group: { _id: '$libraryCode', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.n || 0]));
};

// GET /v1/api/versions - 游戏版本列表
router.get('/versions', auth, async (req, res) => {
  try {
    // 尝试从数据库读取
    let versions = await Version.find().lean();
    
    // 如果数据库为空，返回默认数据
    if (!versions || versions.length === 0) {
      versions = [
        { id: 'default-1', name: '游戏王日文', lang: '日文', logo: '/static/icons/version_logos/logo_yugioh_jp.png' },
        { id: 'default-2', name: '游戏王简中', lang: '简中', logo: '/static/icons/version_logos/logo_yugioh_cn.png' },
        { id: 'default-3', name: '游戏王英文', lang: '英文', logo: '/static/icons/version_logos/logo_yugioh_en.png' },
        { id: 'default-4', name: '游戏王测试', lang: '测试', logo: '/static/icons/version_logos/logo_yugioh_test.png' },
        { id: 'default-5', name: '宝可梦日文', lang: '日文', logo: '/static/icons/version_logos/logo_pokemon_jp.png' },
        { id: 'default-6', name: '宝可梦简中', lang: '简中', logo: '/static/icons/version_logos/logo_pokemon_cn.png' },
        { id: 'default-7', name: '宝可梦英文', lang: '英文', logo: '/static/icons/version_logos/logo_pokemon_en.png' },
        { id: 'default-8', name: '宝可梦繁中', lang: '繁中', logo: '/static/icons/version_logos/logo_pokemon_tw.png' }
      ];
    }
    
    res.json({ list: versions });
  } catch (error) {
    console.error('Get versions error:', error);
    // 出错时返回默认数据
    const versions = [
      { name: '游戏王日文', lang: '日文', logo: '/static/icons/version_logos/logo_yugioh_jp.png' },
      { name: '游戏王简中', lang: '简中', logo: '/static/icons/version_logos/logo_yugioh_cn.png' }
    ];
    res.json({ list: versions });
  }
});

// GET /v1/api/libraries/local - 本地库列表（从StockCode查，不再依赖Library表）
router.get('/libraries/local', auth, async (req, res) => {
  try {
    const StockCode = require('../../models/StockCode');
    const codes = await StockCode.find({ libraryType: 'local', assignedTo: req.user.id, status: { $nin: ['pending', 'archived', 'locked'] } }).sort({ subSeq: 1 }).lean();
    const problems = await problemCountByLibrary();
    const list = await Promise.all(codes.map(async (sc) => {
      const cardCount = await Card.countDocuments({ libraryCode: sc.fullCode });
      return { code: sc.fullCode, cardCount, problemCount: problems.get(sc.fullCode) || 0, status: sc.status, libraryType: sc.libraryType, createdAt: sc.createdAt };
    }));
    res.json({ list });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /v1/api/libraries/cloud - 云端库列表（从StockCode查）
router.get('/libraries/cloud', auth, async (req, res) => {
  try {
    const StockCode = require('../../models/StockCode');
    const codes = await StockCode.find({ libraryType: 'cloud', status: { $nin: ['pending', 'archived', 'locked'] } }).sort({ subSeq: 1 }).lean();
    const problems = await problemCountByLibrary();
    const list = await Promise.all(codes.map(async (sc) => {
      const cardCount = await Card.countDocuments({ libraryCode: sc.fullCode });
      return { code: sc.fullCode, cardCount, problemCount: problems.get(sc.fullCode) || 0, status: sc.status, libraryType: sc.libraryType, createdAt: sc.createdAt };
    }));
    res.json({ list });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /v1/api/libraries/:code - 库详情
router.get('/libraries/:code', auth, async (req, res) => {
  try {
    const { code } = req.params;
    const type = req.query.type || 'local';

    const StockCode = require('../../models/StockCode');
    const sc = await StockCode.findOne({ fullCode: code });
    if (!sc) {
      return res.status(404).json({ error: 'Library not found' });
    }

    const cardCount = await Card.countDocuments({ libraryCode: code });
    res.json({
      code: sc.fullCode,
      name: sc.fullCode,
      type: sc.libraryType,
      cardCount,
      status: sc.status
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /v1/api/libraries - 创建新库（认领StockCode）
router.post('/libraries', auth, async (req, res) => {
  try {
    const { type = 'local', name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const code = name;
    const StockCode = require('../../models/StockCode');
    const sc = await StockCode.findOne({ fullCode: code });
    if (!sc) {
      return res.status(404).json({ error: 'StockCode not found' });
    }
    // 锁检查：被上架批次锁定
    if (sc.listingBatchId) {
      return res.status(423).json({ error: '该库已被上架批次锁定（' + sc.listingBatchId + '），请先撤回解析' });
    }
    // 如果已被使用且属于其他库类型或用户，拒绝
    if (sc.libraryType && sc.libraryType !== type) {
      return res.status(409).json({ error: 'Library already exists with different type' });
    }
    if (sc.assignedTo && sc.assignedTo !== req.user.id && type === 'local') {
      return res.status(409).json({ error: 'Library already assigned to another user' });
    }

    // 认领 StockCode
    sc.libraryType = type;
    sc.assignedTo = type === 'local' ? req.user.id : null;
    sc.assignedAt = new Date();
    if (sc.status !== 'archived' && sc.status !== 'locked' && sc.status !== 'pending') {
      sc.status = 'in_use';
    }
    await sc.save();

    res.status(201).json({
      code: sc.fullCode,
      id: sc.code,
      cardCount: 0
    });
  } catch (error) {
    // 处理 MongoDB 重复键错误 E11000
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Library already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT /v1/api/libraries/:code - 更新库设置
router.put('/libraries/:code', auth, async (req, res) => {
  try {
    const { code } = req.params;
    const { name, type } = req.body;

    const StockCode = require('../../models/StockCode');
    const sc = await StockCode.findOne({ fullCode: code });
    if (!sc) {
      return res.status(404).json({ error: 'Library not found' });
    }
    // 锁检查：被上架批次锁定 —— 跟同文件里「认领编号」那处（:171-173）同一个口径。
    // 少了这一句就能绕过锁直接改库的类型（本地↔云端），而归档入口
    // （listings/batches.js 的 StockCode.find({listingBatchId})）是**按批次号反查库**的，
    // 类型被改掉之后归档那条路就找不着这个库了。
    if (sc.listingBatchId) {
      return res.status(423).json({ error: '该库已被上架批次锁定（' + sc.listingBatchId + '），请先撤回解析' });
    }

    if (type) sc.libraryType = type;
    await sc.save();

    const cardCount = await Card.countDocuments({ libraryCode: code });
    res.json({
      code: sc.fullCode,
      id: sc.code,
      name: name || sc.fullCode,
      type: sc.libraryType,
      cardCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /v1/api/libraries/:code/cards - 库中卡牌列表
router.get('/libraries/:code/cards', auth, async (req, res) => {
  try {
    const { code } = req.params;
    const { type = 'local', rarity, condition, versionId, page = 1, pageSize = 20 } = req.query;

    const userIdFilter = type === 'cloud' ? null : req.user.id;
    // 验证 StockCode 存在（替代 Library 表）
    const StockCode = require('../../models/StockCode');
    const sc = await StockCode.findOne({ fullCode: code });
    if (!sc) {
      return res.json({ list: [], total: 0, page: 1, pageSize: 20 });
    }

    const query = { libraryCode: code };
    if (type !== 'cloud') query.userId = userIdFilter;
    if (rarity) query.rarity = rarity;
    if (condition) query.condition = condition;
    if (versionId) query.versionId = parseInt(versionId);

    const total = await Card.countDocuments(query);
    const cards = await Card.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(parseInt(pageSize));

    // 这批卡的编号 → 目录。**只用来取卡名 / 中文名 / 卡密**（见下面 fromCatalog）。
    //
    // 以前这段还顺带算一个「未收录」(uncollected) 给前端画淡红底 —— 2026-09-29 已删。
    // 现在淡红只由「信息登记」(cardmarks) 决定：编号在目录里查不到时，写路径上会自动登记
    // 一条（CardMark.autoRegister），前端据此画淡红底 + 绿色「信息已登记」。淡红不再在这里算。
    //
    // ⚠️ 下面这个查询本身**不能删** —— 卡名、中文名、卡密、卡图都还靠 catalogMap。
    //
    // 判定口径的沿革（留着以后查）：这里历来只按 code 严格匹配、**故意不做编号容错**。
    // DL1~DL5 那 5 个包的卡面号跟目录号写法不一致（卡面印三位补零 DL1-085，目录用最少两位
    // DL1-85，且 DL1/DL2 的目录号 = 卡面号 − 1，详见 models/CardCatalog.js 里 faceCode 的注释），
    // 按 code 查就是 0 命中。这个口径现在搬进了 CardMark.autoRegister，语义没变。
    // 实测（2026-09-28）：全库 38761 张卡里 93 张查不到（去重 92 个编号），DL1 41 个、DL2 7 个。
    // 注意：cardcatalogs 的 faceCode 列**目前整列为空**（31969 条 0 条有值），
    // 所以「拿 faceCode 兜一次」那条现成的路现在没有数据可用。
    const CardCatalog = require('../../models/CardCatalog');
    // 卡名已不存 cardcatalogs，取名字一律走这里（见 services/cardNames.js 顶上那段）
    const 卡名 = require('../../services/cardNames');
    const normCode = (v) => String(v || '').trim().toUpperCase();
    const lookupCodes = cards
      .map(c => normCode(c.code))
      .filter(c => c && c !== '...' && c !== '---');
    const catalogHits = lookupCodes.length
      ? await CardCatalog.find({ code: { $in: lookupCodes } }).select('code extCode').lean()
      : [];
    // ⚠️ 漏了这行就是**静默退化**：下面 `fromCatalog` 会一路走 `|| card.jpName` 分支，
    // 拿识别当时的旧快照顶上去，页面看着正常、但改编号后名字不再跟着目录走。
    await 卡名.回填(catalogHits);
    const catalogMap = new Map(catalogHits.map(h => [normCode(h.code), h]));

    // 「信息登记」登记过的卡：同样实时查、不落库到卡上。
    // 前端据此把卡片行的蓝块画成绿色「信息已登记」（按不动）。
    // 后台把记录删掉 → 刷新就自动变回蓝色，不用去动任何一张卡。
    // 粒度是 (编号, 罕贵度)，通配口径统一在 services/cardMarks.js —— 上面那个问题计数
    // 用的是同一套（聚合版），两处必须对上，否则库选择器上的数字跟实际红行数会差。
    const markHits = lookupCodes.length
      ? await CardMark.find({ code: { $in: lookupCodes } }).select('code rarity').lean()
      : [];
    const isMarked = 造匹配器(markHits);

    // 卡名 / 中文名 / 卡密：也按编号**实时**从目录取，不读 cards 文档里的快照。
    //
    // 这三项是「目录」的属性（按编号查出来的），不是这张卡自带的属性 —— 编辑框里它们是只读的。
    // cards 文档里虽然也存了一份，但那是识别当时写进去的快照。一旦改了编号（「信息有误」允许改），
    // 或者人工订正了目录资料（比如 DL1~DL5 那批），快照就跟编号对不上了：
    // 接口会返回「编号 = 新卡、卡名 = 旧卡」这种自相矛盾的行，库存 / 上架 / 导出全跟着错。
    // 所以这里一律以目录为准，取不到才退回快照 —— 退回是为了 DL 这类目录里还没有的卡
    // 仍能显示识别时占位的「游戏王日文卡牌」，不至于变成空白。
    //
    // 好处：以后目录补上资料（人工订正 DL1~DL5 那 5 条），这些卡刷新就自动显示正确卡名，
    // 不需要把每张卡重存一遍。跟上面 uncollected 是同一套「不落库、实时查」的做法。
    //
    // 实测（2026-09-28）：全库 38761 张卡里 38667 张能查到目录，其中 38665 张名字本来就一致，
    // 所以这一改动实际影响面很小（只有 2 张会变），纯粹是防止以后再漂。
    const fromCatalog = (card) => {
      const hit = catalogMap.get(normCode(card.code));
      if (!hit) return { jpName: card.jpName, cnName: card.cnName, extCode: card.extCode || '' };
      return {
        jpName: hit.jpName || card.jpName,
        cnName: hit.cnName || card.cnName,
        extCode: hit.extCode || card.extCode || ''
      };
    };

    const list = cards.map(card => {
      const cat = fromCatalog(card);
      return {
        id: card._id,
        jpName: cat.jpName,
        cnName: cat.cnName,
        code: card.code,
        rarity: card.rarity,
        condition: card.condition,
        note: card.note || '',
        serial: card.serial,
        img: card.img,
        origImg: card.origImg || '',
        extCode: cat.extCode,
        altArtIndex: card.altArtIndex || 0,
        altLabel: card.altLabel || '',
        altLabels: card.altLabels || {},
        libraryCode: card.libraryCode,
        versionId: card.versionId,
        // 已登记（自动或手动）的卡 → 前端画绿色「信息已登记」+ 纯红底，并且按不动。
        // 「未收录」不再单独算：旧的那套"查不到目录就算未收录"已经并进这张表了，
        // 编号查不到目录时会在写路径上自动登记（CardMark.autoRegister）。
        // 粒度是 (编号, 罕贵度)：自动记的那条是通配，会把该编号所有印刷都标上。
        marked: isMarked(card.code, card.rarity)
      };
    });

    res.json({
      list,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /v1/api/libraries/:code - 删除库
router.delete('/libraries/:code', auth, async (req, res) => {
  try {
    const { code } = req.params;
    const type = req.query.type || 'local';

    const userIdFilter = type === 'cloud' ? null : req.user.id;
    const StockCode = require('../../models/StockCode');
    const sc = await StockCode.findOne({ fullCode: code, libraryType: type });
    if (!sc) {
      return res.status(404).json({ error: 'Library not found' });
    }
    // 锁检查：被上架批次锁定
    if (sc.listingBatchId) {
      return res.status(423).json({ error: '该库已被上架批次锁定（' + sc.listingBatchId + '），请先撤回解析' });
    }
    // 已归档的库不许删。原先只有「不把它释放回编号池」这一半 —— 卡照删不误，
    // 于是归档库会变成「编号还占着、卡没了」的空壳：页面上看得到、点进去是空的，
    // 而它占的编号既不能重发也没法回池。已上架的东西只能走「撤回」，不能删除。
    if (sc.status === 'archived') {
      return res.status(423).json({ error: '这个库已经确认上架（已归档），不能删除；要退请在这批上架的页面整批撤回' });
    }

    await Card.deleteMany({ libraryCode: code, userId: userIdFilter });

    // 释放 StockCode 回编号池（已上架/待上架不释放）
    if (sc.status !== 'archived' && sc.status !== 'pending') {
      sc.libraryType = '';
      sc.assignedTo = null;
      sc.currentCards = 0;
      sc.status = 'available';
      await sc.save();
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /v1/api/libraries/convert-to-cloud - 整库迁移：本地→云端
router.post('/libraries/convert-to-cloud', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });

    const StockCode = require('../../models/StockCode');
    const sc = await StockCode.findOne({ fullCode: code, libraryType: 'local', assignedTo: req.user.id });
    if (!sc) return res.status(404).json({ error: 'Local library not found' });
    // 锁检查：被上架批次锁定（同 :171-173）。整库转类型会绕开锁，而归档入口是按批次号反查库的。
    if (sc.listingBatchId) {
      return res.status(423).json({ error: '该库已被上架批次锁定（' + sc.listingBatchId + '），请先撤回解析' });
    }
    // （原先这里还有一句 `if (sc.libraryType === 'cloud') return 409` —— 上面的查询已经限定
    //   `libraryType:'local'`，那句永远不成立，已删。）

    const cardCount = await Card.countDocuments({ libraryCode: code, userId: req.user.id });

    // 更新 StockCode
    sc.libraryType = 'cloud';
    sc.assignedTo = null;
    await sc.save();

    await Card.updateMany({ libraryCode: code, userId: req.user.id }, { $unset: { userId: '' } });

    res.json({ success: true, code, cardCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /v1/api/libraries/convert-to-local - 整库迁移：云端→本地
router.post('/libraries/convert-to-local', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });

    const StockCode = require('../../models/StockCode');
    const sc = await StockCode.findOne({ fullCode: code, libraryType: 'cloud' });
    if (!sc) return res.status(404).json({ error: 'Cloud library not found' });
    // 锁检查：被上架批次锁定（同 :171-173）
    if (sc.listingBatchId) {
      return res.status(423).json({ error: '该库已被上架批次锁定（' + sc.listingBatchId + '），请先撤回解析' });
    }
    // （原先这里还有一句 `if (sc.libraryType === 'local' && ...)` —— 上面的查询已经限定
    //   `libraryType:'cloud'`，那句永远不成立，已删。）

    const cardCount = await Card.countDocuments({ libraryCode: code, userId: { $exists: false } });

    // 更新 StockCode
    sc.libraryType = 'local';
    sc.assignedTo = req.user.id;
    await sc.save();

    await Card.updateMany({ libraryCode: code, userId: { $exists: false } }, { userId: req.user.id });

    res.json({ success: true, code, cardCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
