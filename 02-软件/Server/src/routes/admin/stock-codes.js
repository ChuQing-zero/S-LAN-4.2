/**
 * 库存编号管理 API
 */
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const StockCode = require('../../models/StockCode');

// 管理员权限检查 (terminal_admin 和 admin 均可)
const adminOnly = (req, res, next) => {
  if (!req.user || !['admin', 'terminal_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
};

// 用户角色缓存
let userRoleCache = {}
async function getUserRole(uid) {
  if (!uid) return ''
  if (userRoleCache[uid]) return userRoleCache[uid]
  const User = require('../../models/User')
  const u = await User.findOne({ id: uid }).lean()
  userRoleCache[uid] = u?.role || 'user'
  return userRoleCache[uid]
}

// GET 列表
router.get('/', auth, async (req, res) => {
  try {
    const { prefix, zone, status, versionName, tag, libraryType, excludePool } = req.query;
    const filter = {};
    if (prefix) filter.prefix = prefix;
    if (zone !== undefined) filter.zone = Number(zone);
    if (status) filter.status = status;
    if (versionName) filter.versionName = versionName;
    if (tag) filter.tags = tag;
    if (libraryType === 'pool') { filter.libraryType = ''; filter.assignedTo = null }
    else if (libraryType === 'pending') { filter.status = 'pending' }
    else if (libraryType) filter.libraryType = libraryType;
    if (excludePool === 'true') {
      // "全部"=本地库+云端库+待上架+已上架，排除纯编号池
      filter.$or = [
        { libraryType: { '$in': ['local', 'cloud'] } },
        { status: { '$in': ['pending', 'archived'] } }
      ]
    }

    const list = await StockCode.find(filter).sort({ prefix: 1, zone: 1, seq: 1 }).lean();
    // 补全用户角色
    for (const item of list) {
      if (item.assignedTo) item._assignedRole = await getUserRole(item.assignedTo);
    }
    // Collect all unique tags
    const allTags = [...new Set(list.flatMap(c => c.tags || []))].sort();
    res.json({
      list,
      total: list.length,
      available: list.filter(c => c.status === 'available').length,
      inUse: list.filter(c => c.status === 'in_use').length,
      full: list.filter(c => c.status === 'full').length,
      allTags
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST 创建 (单个)
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    let { prefix, zone, seq, subSeq, versionName, note, tags, maxCards, status } = req.body;

    // 空值自动查找空位 (跟批量逻辑一致)
    if (!prefix && zone == null && seq == null && subSeq == null) {
      const gap = await findFirstGap('A', 0, 0, 1);
      prefix = gap.prefix; zone = gap.zone; seq = gap.seq; subSeq = gap.subSeq;
    } else {
      prefix = prefix || 'A';
      zone = zone ?? 0;
      seq = (seq != null) ? seq : 0;
      subSeq = (subSeq != null) ? subSeq : 0;
    }

    const sc = new StockCode({
      prefix, zone, seq, subSeq,
      versionName: versionName || '游戏王日文',
      note: note || '', tags: tags || [], maxCards: maxCards || 30, status: status || 'available'
    });
    await sc.save();
    res.status(201).json(sc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: '此编号已存在' });
    res.status(500).json({ error: e.message });
  }
});

// ---- 自动进位工具 ----
function nextPrefix(p) { return String.fromCharCode(p.charCodeAt(0) + 1) }
const MAX_SUBSEQ = 99, MAX_SEQ = 999, MAX_ZONE = 9, MAX_PREFIX = 'Z';

async function codeExists(prefix, zone, seq, subSeq) {
  const c = `${prefix}${zone}-${String(seq).padStart(3,'0')}-${String(subSeq).padStart(2,'0')}`;
  return !!(await StockCode.findOne({ code: c }));
}

/** 从给定位置开始找第一个空位, 自动进位 */
async function findFirstGap(p, z, s, sub) {
  while (true) {
    if (!(await codeExists(p, z, s, sub))) return { prefix: p, zone: z, seq: s, subSeq: sub };
    sub++;
    if (sub > MAX_SUBSEQ) { sub = 1; s++; }
    if (s > MAX_SEQ)     { s = 0; z++; }
    if (z > MAX_ZONE)    { z = 0; p = nextPrefix(p); }
    if (p > MAX_PREFIX)  throw new Error('所有编号已用完 (A0-000-00 ~ Z9-999-99)');
  }
}

/** 当前位置 +1, 自动进位 */
function advance(p, z, s, sub) {
  sub++;
  if (sub > MAX_SUBSEQ) { sub = 1; s++; }
  if (s > MAX_SEQ)      { s = 0; z++; }
  if (z > MAX_ZONE)     { z = 0; p = nextPrefix(p); }
  if (p > MAX_PREFIX)   throw new Error('所有编号已用完');
  return { prefix: p, zone: z, seq: s, subSeq: sub };
}

// POST 批量创建
router.post('/batch', auth, adminOnly, async (req, res) => {
  try {
    let { prefix, zone, startSeq, startSubSeq, count, versionName, note, maxCards } = req.body;

    // 空值用默认: 四个字段全空 → 从 A0-000 自动找空位
    if (!prefix) prefix = 'A';
    if (zone == null) zone = 0;
    let seq = (startSeq != null) ? startSeq : 0;
    let subSeq = (startSubSeq != null) ? startSubSeq : null;

    // 找起始空位
    let cur;
    if (subSeq != null) {
      // 用户指定了子序号 → 从指定位置开始 (可能跳过已存在)
      cur = await findFirstGap(prefix, zone, seq, subSeq);
    } else {
      // 全部自动 → 从 A0-000-01 开始找空位
      cur = await findFirstGap(prefix, zone, seq, 1);
    }

    const created = [];
    const skipped = [];
    const target = count || 10;

    while (created.length < target) {
      if (await codeExists(cur.prefix, cur.zone, cur.seq, cur.subSeq)) {
        skipped.push(`${cur.prefix}${cur.zone}-${String(cur.seq).padStart(3,'0')}-${String(cur.subSeq).padStart(2,'0')}`);
        cur = advance(cur.prefix, cur.zone, cur.seq, cur.subSeq);
        continue;
      }
      const sc = new StockCode({
        prefix: cur.prefix, zone: cur.zone, seq: cur.seq, subSeq: cur.subSeq,
        versionName: versionName || '游戏王日文',
        note: note || '', maxCards: maxCards || 30
      });
      await sc.save();
      created.push(sc.code);
      cur = advance(cur.prefix, cur.zone, cur.seq, cur.subSeq);
    }

    res.status(201).json({
      created,
      count: created.length,
      skipped: skipped.length > 0 ? skipped : undefined
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 标签迁移引擎 =====
/** 门牌号迁移：只改标签，不搬数据 */
async function applyLabelMigration(sc, libraryType, status, userId) {
  const code = sc.fullCode;
  const oldLibraryType = sc.libraryType;
  const oldStatus = sc.status;

  // locked 的编号**不许改状态**。放开了就等于绕过后面的 release 拦截：
  // 先把 locked 改成别的状态，再调 release 就释放回池了 —— 可它名下的卡还在，
  // 而归档入口（listings/batches.js）是 `StockCode.find({listingBatchId})` 反查库的，
  // 编号一旦回池，那批已经上架的卡就归档不到、也撤不回来了。
  // 要解锁只有一条路：把那一批整批撤回。
  if (sc.status === 'locked' && (status !== undefined || libraryType !== undefined)) {
    console.log('Label: code=' + code + ' 已锁定（批次 ' + (sc.listingBatchId || '?') + '），拒绝改标签');
    const err = new Error('这个编号已被上架批次锁定（' + (sc.listingBatchId || '?') + '），不能改类型/状态，请先撤回解析');
    err.status = 423;
    throw err;
  }

  console.log('Label: code=' + code + ' old=' + oldLibraryType + '/' + oldStatus + ' → new=' + libraryType + '/' + status);

  // 只改基本标签
  if (libraryType !== undefined) {
    sc.libraryType = libraryType;
    if (libraryType === 'local') sc.assignedTo = sc.assignedTo || userId;
    else if (libraryType === 'cloud') sc.assignedTo = null;
  }
  if (status !== undefined) sc.status = status;

  // Card的userId同步（local用userId，cloud用null）
  if (libraryType === 'local' || libraryType === 'cloud') {
    const Card = require('../../models/Card');
    const libUserId = libraryType === 'local' ? (sc.assignedTo || userId) : undefined;
    if (libraryType === 'cloud') {
      await Card.updateMany({ libraryCode: code }, { $unset: { userId: '' } });
    } else {
      await Card.updateMany({ libraryCode: code }, { userId: libUserId });
    }
  }

  // 计数同步
  const Card = require('../../models/Card');
  sc.currentCards = await Card.countDocuments({ libraryCode: code });

  await sc.save();
}

// PUT 更新单个
router.put('/:code', auth, adminOnly, async (req, res) => {
  try {
    const { note, tags, versionName, maxCards, status, libraryType } = req.body;
    const update = {};
    if (note !== undefined) update.note = note;
    if (tags !== undefined) update.tags = tags;
    if (versionName !== undefined) update.versionName = versionName;
    if (maxCards !== undefined) update.maxCards = maxCards;
    if (status !== undefined) update.status = status;
    if (libraryType !== undefined) update.libraryType = libraryType;

    let sc = await StockCode.findOne({ code: req.params.code });
    if (!sc) return res.status(404).json({ error: 'Not found' });

    // 基础字段更新
    if (note !== undefined) sc.note = note;
    if (tags !== undefined) sc.tags = tags;
    if (versionName !== undefined) sc.versionName = versionName;
    if (maxCards !== undefined) sc.maxCards = maxCards;

    // 改libraryType或status时自动搬数据（锁定的编号会在里面抛 423）
    await applyLabelMigration(sc, libraryType, status, req.user.id);

    res.json(sc);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// DELETE 删除
router.delete('/:code', auth, adminOnly, async (req, res) => {
  try {
    await StockCode.deleteOne({ code: req.params.code });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 内部路由: 获取用户列表 (调度用)
const User = require('../../models/User');
router.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}).select('id nickname role').lean()
    res.json({ list: users })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST 调度 — 分配最近可用库
router.post('/dispatch', auth, adminOnly, async (req, res) => {
  try {
    const { code, assignedTo, libraryType } = req.body;
    if (!code || !assignedTo) return res.status(400).json({ error: 'code and assignedTo required' });

    const sc = await StockCode.findOne({ code });
    if (!sc) return res.status(404).json({ error: 'Stock code not found' });

    sc.assignedTo = assignedTo;
    sc.libraryType = libraryType || 'local';
    sc.assignedAt = new Date();
    // 已上架/锁定/待上架状态不自动覆盖
    if (sc.status !== 'archived' && sc.status !== 'locked' && sc.status !== 'pending') {
      if (sc.currentCards < sc.maxCards) sc.status = 'in_use';
    }
    await sc.save();

    res.json(sc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /claim — 用户调度：校验编号池并认领
router.post('/claim', auth, async (req, res) => {
  try {
    const { code, libraryType } = req.body;
    if (!code || !libraryType) return res.status(400).json({ error: 'code and libraryType required' });

    // 查找编号
    const sc = await StockCode.findOne({ fullCode: code });
    if (!sc) return res.status(404).json({ error: '编号不存在' });

    // 检查状态：必须是 available 且未分配
    if (sc.status !== 'available' && sc.status !== 'in_use') {
      return res.status(409).json({ error: '该编号不可用(状态:' + sc.status + ')' });
    }
    if (sc.assignedTo && sc.assignedTo !== req.user.id) {
      return res.status(409).json({ error: '该编号已被其他用户占用' });
    }

    // 认领
    sc.libraryType = libraryType;
    sc.assignedTo = req.user.id;
    sc.assignedAt = new Date();
    if (sc.currentCards < sc.maxCards) sc.status = 'in_use';
    await sc.save();

    res.json({ success: true, stockCode: sc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /release — 释放编号回编号池
// 这个键会把编号整个交回池子（谁都可能再领到），所以跟同文件的增删改一样限管理员，
// 而且**必须**归属校验 —— 不能拿别人的编号来释放。
router.post('/release', auth, adminOnly, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });

    const sc = await StockCode.findOne({ fullCode: code });
    if (!sc) return res.json({ success: true }); // 不存在就算了

    // 已上架/锁定/待上架不允许释放回池
    if (sc.status === 'archived' || sc.status === 'locked' || sc.status === 'pending') {
      return res.status(400).json({ error: '已上架或锁定状态的编号不能释放' });
    }
    // （这里本来想再加一道「归属校验」，想了想是多余的：上面已经 adminOnly，
    //   能走到这行的一定是 admin/terminal_admin，写在角色之外的归属判断永远不会成立。
    //   普通用户要放掉**自己**的库走的是 DELETE /libraries/:code，那条已经是自己的库才认。）
    // 被上架批次锁着的不许释放（上面 status 那条拦的是 locked **状态**，
    // 而 listingBatchId 是那条锁的实体；两者理论上同生共死，但历史数据里可能只剩其一 ——
    // 只信状态标志会漏掉「状态被改过、批次号还挂着」的行）。
    if (sc.listingBatchId) {
      return res.status(423).json({ error: '该库已被上架批次锁定（' + sc.listingBatchId + '），请先撤回解析' });
    }
    sc.libraryType = '';
    sc.assignedTo = null;
    sc.currentCards = 0;
    sc.status = 'available';
    // 顺带把批次号清掉。不清的话会留下一个**悬空批次号**：编号已回池、别人领到之后
    // listingBatchId 还指着上一个批次，归档入口 `StockCode.find({listingBatchId})` 会把
    // 这个无辜的新库一起卷进那一批。
    sc.listingBatchId = null;
    await sc.save();

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /merge — 合并两个库（同类型、同用户、非已上架、非编号池）
router.post('/merge', auth, adminOnly, async (req, res) => {
  try {
    const { sourceCode, targetCode } = req.body
    if (!sourceCode || !targetCode) return res.status(400).json({ error: 'sourceCode and targetCode required' })
    if (sourceCode === targetCode) return res.status(400).json({ error: '不能合并到自身' })

    const source = await StockCode.findOne({ fullCode: sourceCode })
    const target = await StockCode.findOne({ fullCode: targetCode })
    if (!source) return res.status(404).json({ error: '源编号不存在' })
    if (!target) return res.status(404).json({ error: '目标编号不存在' })

    // 不能合并纯编号池(status=available 且无 libraryType)
    const isPool = (s) => s.status === 'available' && !s.libraryType && !s.assignedTo
    if (isPool(source) || isPool(target)) {
      return res.status(400).json({ error: '编号池不能合并' })
    }
    // 已上架只能和已上架合并；本地/云端只能同类型合并
    if (source.status === 'archived' && target.status !== 'archived') {
      return res.status(400).json({ error: '已上架库只能与已上架库合并' })
    }
    if (source.status !== 'archived' && source.libraryType !== target.libraryType) {
      return res.status(400).json({ error: '只能合并同类型库(同为本地库或同为云端库)' })
    }
    // 本地库必须同用户
    if (source.libraryType === 'local' && String(source.assignedTo || '') !== String(target.assignedTo || '')) {
      return res.status(400).json({ error: '本地库必须是同一用户才能合并' })
    }

    // ===== 三道守卫（合并 = 源库清空回池 + 目标库卡位重排，两头都碰不得）=====
    // ① 被上架批次锁着的不动：源库放回池会让 `StockCode.find({listingBatchId})` 少一个库，
    //    目标库卡位重排会让那一批已上架的卡位号全错。
    for (const [名, s] of [['源库', source], ['目标库', target]]) {
      if (s.listingBatchId) {
        return res.status(423).json({ error: 名 + '已被上架批次锁定（' + s.listingBatchId + '），请先撤回解析' })
      }
    }
    // ② locked 状态同理（listingBatchId 是锁的实体、locked 是它的状态，两者同生共死，
    //    但历史数据可能只剩其一，所以两个都查）
    for (const [名, s] of [['源库', source], ['目标库', target]]) {
      if (s.status === 'locked') {
        return res.status(423).json({ error: 名 + '处于「锁定」状态，不能合并' })
      }
    }
    // ③ 有未完成的拣货单的不动 —— `OrderPick.position` 存的是卡位号，
    //    重排之后那些单子会指到别的卡上（服务层的统一口径见 services/librarySerials.js）
    const { countOpenPicks } = require('../../services/librarySerials')
    for (const [名, s] of [['源库', source], ['目标库', target]]) {
      const n = await countOpenPicks(s.fullCode)
      if (n > 0) {
        return res.status(409).json({ error: 名 + '上还有 ' + n + ' 张未拣完的拣货单，重排卡位会让它们指错卡，先处理完再合并' })
      }
    }

    const Card = require('../../models/Card')

    // 检查目标库上限
    const targetCardCount = await Card.countDocuments({ libraryCode: targetCode })
    if (source.currentCards + targetCardCount > target.maxCards) {
      return res.status(400).json({ error: '合并后卡牌数(' + (source.currentCards + targetCardCount) + '张)将超出目标库上限(' + target.maxCards + '张)，拒绝合并' })
    }

    // 获取目标库最大序号
    const targetCards = await Card.find({ libraryCode: targetCode }).sort({ serial: 1 }).lean()
    let maxNum = 0
    targetCards.forEach(c => {
      if (c.serial) {
        const num = parseInt(c.serial.split('-').pop())
        if (!isNaN(num) && num > maxNum) maxNum = num
      }
    })

    // 迁移卡牌: 改 libraryCode + 重排 serial
    //
    // 走**原生驱动**按 `_id` 本来的类型匹配，别用 `Card.updateOne({_id})` ——
    // mongoose 会按 schema 把 _id 转成 ObjectId，正式库确实是 ObjectId 所以看着正常，
    // 但从 JSON 灌出来的库（如 s-lan-test）_id 是字符串，一转就永远匹配不上：
    // 卡一张都不会迁走，而源编号已经回池了 —— **卡变孤儿，merge 还回成功**。
    // 同样的坑在 services/librarySerials.js 的压实里踩过一次，写法照抄那边。
    const sourceCards = await Card.find({ libraryCode: sourceCode }).sort({ serial: 1 }).lean()
    for (const card of sourceCards) {
      maxNum++
      const newSerial = targetCode + '-' + String(maxNum).padStart(4, '0')
      await Card.collection.updateOne({ _id: card._id }, { $set: { libraryCode: targetCode, serial: newSerial } })
    }

    // 源编号重置回池
    source.currentCards = 0
    source.status = 'available'
    source.libraryType = ''
    source.assignedTo = null
    await source.save()

    // 目标编号更新计数（locked状态不自动改）
    target.currentCards = await Card.countDocuments({ libraryCode: targetCode })
    if (target.status !== 'locked' && target.status !== 'archived' && target.status !== 'pending') {
      if (target.currentCards >= target.maxCards) target.status = 'full'
      else if (target.currentCards > 0) target.status = 'in_use'
    }
    await target.save()

    res.json({ success: true, migrated: sourceCards.length, targetCards: target.currentCards })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /next-available — 自动取下一个可用编号（按前缀+分区+序号排序选第一个）
router.get('/next-available', auth, async (req, res) => {
  try {
    const sc = await StockCode.findOne({ status: 'available', libraryType: '' })
      .sort({ prefix: 1, zone: 1, seq: 1, subSeq: 1 }).lean()
    if (!sc) return res.status(404).json({ error: '没有可用编号' })
    res.json({ code: sc.fullCode, fullCode: sc.fullCode })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router;
