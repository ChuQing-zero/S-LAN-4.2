/**
 * 卡牌唯一目录 API —— 后台「卡牌资料库 → 唯一目录」那张表。
 *
 * 一张卡一行：卡密 + **官方日语 / 日语读音 / 官方简中 / 官方英语** 四个名字。
 *
 * ⚠️ 列表接口**不再返回**「库里现在写的」和「状态」了（V1.2.31）。
 * 那两个是拿编号目录的名字跟官方比对出来的（`services/cardReview.js`），
 * 而编号目录那三个名字列下一步就要删 —— 到那时「目录里写的名字」不存在，这两个必然作废。
 * 用户也确认这页不再需要它们，所以提前拆掉，列表接口顺带能交回 Mongo 真分页。
 * `/stats` 和 `/verify` 仍然会用到 `computeReview` 那套现算，没受影响。
 *
 * 全部接口 `authAdmin`（`admin` + `terminal_admin` 才放得进来）。
 * 分页参数用 `page` / `pageSize` —— 跟 `missing-codes` / `card-marks` 走，不跟 tcg 的 `perPage`。
 *
 * 写接口有四个，都在文件下半部分：
 *   `POST   /unique`         新增一条**身份**（手工录入的卡密）
 *   `PATCH  /row/:code`      改**目录行**（`cardcatalogs`）的卡密 / 日文名
 *   `PATCH  /unique/:key`    改**身份**（`carduniques`）的四个名字 / 卡密 ← 表1 行内编辑走这个
 *   `DELETE /unique/:key`    删**身份**（`carduniques`）← 详细弹窗右上角的「删除」，见文件末尾
 */
const express = require('express');
const router = express.Router();
const authAdmin = require('../../middleware/authAdmin');
const CardUnique = require('../../models/CardUnique');
const CardCatalog = require('../../models/CardCatalog');
// 卡密的形态规则全仓唯一一份（V1.2.73 从「1–12 位数字」放宽成字母/数字/下划线/短横线）。
// 这里两个都要：`卡密合法` 判新增/改写（非空），`卡密可留空` 判目录行（清空是合法动作）。
const { 卡密合法, 卡密可留空, 卡密说明 } = require('../../services/cardPassword');
const review = require('../../services/cardReview');
const cardUniques = require('../../services/cardUniques');
const cardAudit = require('../../services/cardAudit');
const official = require('../../services/cardOfficial');
// 卡名的映射缓存 —— 写了 carduniques 之后都要 `失效()`，见 services/cardNames.js
const 卡名 = require('../../services/cardNames');

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /v1/api/card-uniques — 表1 列表（分页 / kw / keyType）
async function 列表(req, res) {
  try {
    const { kw = '', keyType = '', page = 1, pageSize = 50, sort = 'key' } = req.query;

    const query = {};
    if (keyType) query.keyType = keyType;
    if (kw) {
      const r = escRe(kw);
      query.$or = [
        { key: { $regex: r, $options: 'i' } },
        { 'official.jp': { $regex: r, $options: 'i' } },
        { 'official.ruby': { $regex: r, $options: 'i' } },
        { 'official.cn': { $regex: r, $options: 'i' } },
        { 'official.en': { $regex: r, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 500);
    const 方向 = sort === '-key' || sort === 'keyDesc' ? -1 : 1;

    // 以前这里要把 13883 条全拉进内存，因为「状态 / 库里」是要跟编号目录比出来的、
    // 下推不了 Mongo，于是只能「全取 → JS 筛 → JS 排 → 自己切片」。
    // 这页现在只显示「卡密 + 四个名字」，不再展示那两个比对结果，于是能交回 Mongo
    // 真分页：skip/limit + countDocuments，单页查询从「13k 条文档」降到「50 条」。
    const [total, docs] = await Promise.all([
      CardUnique.countDocuments(query),
      CardUnique.find(query)
        .select('key keyType extCode code official.jp official.ruby official.cn official.en')
        .sort({ key: 方向 })
        .skip((pageNum - 1) * size)
        .limit(size)
        .lean(),
    ]);

    res.json({
      list: docs.map((d) => ({
        _id: d._id,
        key: d.key,
        keyType: d.keyType,
        extCode: d.extCode || '',
        code: d.code || '',
        official: {
          jp: (d.official && d.official.jp) || '',
          ruby: (d.official && d.official.ruby) || '',
          cn: (d.official && d.official.cn) || '',
          en: (d.official && d.official.en) || '',
        },
      })),
      total,
      page: pageNum,
      pageSize: size,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.get('/', authAdmin, 列表);
router.get('/list', authAdmin, 列表);   // 别名，两个都留着省得前端记混

// GET /v1/api/card-uniques/stats — 表头汇总 + 不变量
router.get('/stats', authAdmin, async (req, res) => {
  try {
    const [data, 集合数, 卡密身份数, 编号身份数, 对账] = await Promise.all([
      review.computeReview(),
      CardUnique.countDocuments(),
      CardUnique.countDocuments({ keyType: 'extCode' }),
      CardUnique.countDocuments({ keyType: 'code' }),
      cardUniques.对账(),
    ]);

    const 用到的身份 = new Set([...data.identity.keys()]);
    let 未使用 = 0;
    const 未使用样本 = [];
    for (const d of await CardUnique.find({ keyType: 'extCode' }).select('key').lean()) {
      if (!用到的身份.has(d.key)) { 未使用++; if (未使用样本.length < 20) 未使用样本.push(d.key); }
    }

    res.json({
      目录: {
        总行数: data.total,
        有卡密: data.有卡密,
        无卡密: data.无卡密,
        零卡密行: data.零卡密行,
      },
      唯一目录: { 总条数: 集合数, 卡密身份: 卡密身份数, 编号身份: 编号身份数, 未使用: 未使用, 未使用样本 },
      官方数据: data.official,
      名字: data.name,
      中文名: data.cn,
      不变量: 对账,
      cachedAt: data.at,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/card-uniques/verify — 验收裁判：只读、可反复打
router.get('/verify', authAdmin, async (req, res) => {
  try {
    const force = String(req.query.force || '') === '1';
    const data = await review.computeReview({ force });
    const 对账 = await cardUniques.对账();

    const 断言 = [
      { 项: '名字不对劲的行 = 写法啰嗦 + 真要处理', 值: data.name.不对上, 期望: data.name.写法啰嗦 + data.name.真要处理, 过: data.name.不对上 === data.name.写法啰嗦 + data.name.真要处理 },
      { 项: '真要处理 = 卡密填错 + 名字短 + 名字空', 值: data.name.真要处理, 期望: data.name.byKind.wrongExtCode + data.name.byKind.shortName + data.name.byKind.emptyName, 过: data.name.真要处理 === data.name.byKind.wrongExtCode + data.name.byKind.shortName + data.name.byKind.emptyName },
      { 项: '卡密填错 = 能自证 + 多候选 + 零命中', 值: data.name.byKind.wrongExtCode, 期望: data.name.错拆.能自证 + data.name.错拆.多候选 + data.name.错拆.零命中, 过: data.name.byKind.wrongExtCode === data.name.错拆.能自证 + data.name.错拆.多候选 + data.name.错拆.零命中 },
      { 项: '有卡密 + 无卡密 = 总行数', 值: data.有卡密 + data.无卡密, 期望: data.total, 过: data.有卡密 + data.无卡密 === data.total },
      { 项: '唯一目录不变量', 值: 对账.ok, 期望: true, 过: 对账.ok },
    ];

    res.json({
      ok: 断言.every((a) => a.过),
      at: new Date().toISOString(),
      目录: { 总行数: data.total, 有卡密: data.有卡密, 无卡密: data.无卡密, 零卡密行: data.零卡密行 },
      官方数据: data.official,
      名字: { 不对上: data.name.不对上, 写法啰嗦: data.name.写法啰嗦, 真要处理: data.name.真要处理, byKind: data.name.byKind, 错拆: data.name.错拆 },
      中文名: data.cn,
      唯一目录: 对账,
      断言,
      cachedAt: data.at,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/card-uniques/rebuild — 重建唯一目录（默认 dryRun，只增不删）
router.post('/rebuild', authAdmin, async (req, res) => {
  try {
    const { dryRun = true, refresh = false, limit = 0 } = req.body || {};
    const 真跑 = dryRun === false || dryRun === 'false';

    const r = await cardUniques.rebuild({ dryRun: !真跑, refresh: !!refresh, limit: Number(limit) || 0 });

    if (真跑) {
      review.bumpReviewVersion();
      // 审计：rebuild 是幂等 upsert，不需要回滚快照，但每次都要留痕
      const stamp = cardAudit.makeStamp();
      const audit = cardAudit.openAudit(stamp, 'rebuild');
      audit.save({
        at: new Date().toISOString(),
        by: req.user && req.user.id,
        op: 'carduniques.rebuild',
        refresh: !!refresh,
        limit: Number(limit) || 0,
        result: r,
        backupDir: null,
      });
      r.auditId = audit.auditId;
    }

    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 表2 待处理 ====================

/**
 * GET /v1/api/card-uniques/pending — 待处理清单（现算，走 `cardReview` 的 60 秒缓存）
 *
 * 三个桶，前端就是三个筛选标签：
 *   待处理     名字或卡密对不上（`computePending` 的非 verbose 项）
 *   缺卡密     没有 extCode 的行，判不出对错，但必须看得见
 *   卡密查不到 有 extCode、官方源里却没有（34 行是假卡密 '0'，其余是位数敲错）
 *
 * 三桶不重叠：第一桶要求 extCode 能查到官方资料，第三桶正好相反，第二桶压根没 extCode。
 * 所以「合计」直接相加就是不重复的行数。
 *
 * 不分页 —— 三桶加起来现在 108 行，将来也就几百，一次给完省得前端还要管翻页。
 */
router.get('/pending', authAdmin, async (req, res) => {
  try {
    const data = await review.computeReview();
    const map = official.loadOfficialMap();

    // 名字骨架 → 用过的卡密。只给「缺卡密」的行猜建议卡密用。
    // 索引本身由 `computePending` 建过一份，但那是函数内部的，这里拿不到，只能重建。
    const 名索引 = new Map();
    for (const r of data.rows) {
      if (!r.extCode) continue;
      const k = official.skeleton(r.jpName, null);
      if (!k) continue;
      if (!名索引.has(k)) 名索引.set(k, new Set());
      名索引.get(k).add(String(r.extCode));
    }

    const 待处理 = data.pending
      .filter((p) => p.kind !== 'verboseName')   // 写法啰嗦不算待处理，是另一个按钮管的事
      .map((p) => ({
        _id: p._id,
        code: p.code,
        packCode: p.packCode || '',
        rarity: p.rarity || '',
        jpName: p.jpName || '',
        cnName: p.cnName || '',
        extCode: p.currentExtCode,
        key: p.currentExtCode,
        keyType: 'extCode',
        kind: p.kind,
        official: { jp: p.officialJp, ruby: p.officialRuby, cn: p.officialCn, en: '' },
        suggestion: p.suggestion || {},
      }));

    const 缺卡密 = data.rows.filter((r) => !r.extCode).map((r) => {
      const 骨 = official.skeleton(r.jpName, null);
      const 候 = 骨 ? [...(名索引.get(骨) || [])] : [];
      return {
        _id: r._id,
        code: r.code,
        packCode: r.packCode || '',
        rarity: r.rarity || '',
        jpName: r.jpName || '',
        cnName: r.cnName || '',
        extCode: '',
        key: String(r.code),
        keyType: 'code',
        kind: 'noExtCode',
        official: { jp: '', ruby: '', cn: '', en: '' },
        suggestion: 候.length === 1 ? { extCode: 候[0] } : (候.length ? { extCode: '', candidates: 候 } : {}),
      };
    });

    const 卡密查不到 = data.rows
      .filter((r) => {
        if (!r.extCode) return false;
        const o = map.get(String(r.extCode));
        return !o || o.status !== '有';
      })
      .map((r) => ({
        _id: r._id,
        code: r.code,
        packCode: r.packCode || '',
        rarity: r.rarity || '',
        jpName: r.jpName || '',
        cnName: r.cnName || '',
        extCode: String(r.extCode),
        key: String(r.extCode),
        keyType: 'extCode',
        // '0' 是历史占位符（34 张不同的卡共用它），跟「敲错了一位数」要分开，处理动作不一样
        kind: String(r.extCode) === '0' ? 'fakeExtCode' : 'badExtCode',
        official: { jp: '', ruby: '', cn: '', en: '' },
        suggestion: {},
      }));

    const 排序 = (a, b) =>
      String(a.packCode).localeCompare(String(b.packCode), 'ja')
      || String(a.code).localeCompare(String(b.code), 'ja');
    待处理.sort(排序);
    缺卡密.sort(排序);
    卡密查不到.sort(排序);

    res.json({
      摘要: {
        待处理: 待处理.length,
        缺卡密: 缺卡密.length,
        卡密查不到: 卡密查不到.length,
        合计: 待处理.length + 缺卡密.length + 卡密查不到.length,
      },
      待处理,
      缺卡密,
      卡密查不到,
      cachedAt: data.at,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 卡密的合法形态 —— 定义在 `services/cardPassword.js`（见文件顶上的 require）。 */

/**
 * PATCH /v1/api/card-uniques/row/:code — 改一行 `cardcatalogs`
 *
 * body: `{ set: { extCode?, jpName? }, expect: { extCode?, jpName? } }`
 *
 * 三条纪律：
 *   · **字段白名单**只有 `extCode` / `jpName`。`cnName` 不在这轮范围里（照换简中是批量按钮的事）。
 *   · **乐观锁**：`expect` 里带上前端看到的旧值，对不上说明别人先改了 → 409，别覆盖别人。
 *   · **快照先落盘**：单机 MongoDB 没有副本集，跨集合写入退不回来，快照写不成功就整个中止。
 *
 * 改完顺手 `确保身份()`：卡密一变，唯一目录的身份就跟着变，当场补上不变量才不会红。
 *
 * ⚠️ **`jpName` 不再写进 `cardcatalogs`**（那三个名字字段已删，写了也是被 strict 丢掉）。
 *    名字是「卡」的属性、不是「这一行」的，所以改名字实际改的是**这一行用的那个身份**
 *    （有卡密用卡密、没卡密用编号，和 `cardUniques` 一个口径）。想让同一张卡的所有行一起变名，
 *    去 `PATCH /unique/:key`（那才是按身份改的口）。
 */
router.patch('/row/:code', authAdmin, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    if (!code) return res.status(400).json({ error: '缺编号' });

    const { set = {}, expect = {} } = req.body || {};

    const 改 = {};
    if (set.extCode !== undefined) {
      const v = String(set.extCode == null ? '' : set.extCode).trim();
      if (!卡密可留空(v)) return res.status(400).json({ error: `卡密${卡密说明}，或者留空` });
      改.extCode = v;
    }
    // 名字不改这一行，改的是身份表 —— 先存着，等下面拿到身份再写
    let 改名 = null;
    if (set.jpName !== undefined) {
      const v = String(set.jpName == null ? '' : set.jpName).trim();
      if (v.length > 300) return res.status(400).json({ error: '名字超过 300 字了' });
      改名 = v;
    }
    if (!Object.keys(改).length && 改名 === null) return res.status(400).json({ error: '没有要改的字段' });

    // ⚠️ V1.2.39 起唯一索引是 `{code, rarity, altArtIndex}`，**一个编号本来就有好几行**
    // （一行一个罕贵度）。以前这里断言「必须命中 1 行」，拆行之后每张卡都会 409。
    //
    // 但卡密（extCode）是「这张卡」的属性 —— 同一个编号的几个罕贵度共用同一个卡密，
    // 所以按编号改卡密在语义上是对的，落到库里就是**整组一起改**。
    // 乐观锁拿整组的第一行来比（同组这几行的卡密本来就该是一致的）。
    const 组 = await CardCatalog.find({ code }).lean();
    if (!组.length) {
      return res.status(404).json({ error: '目录里没有这个编号：' + code });
    }
    const 原 = 组[0];
    // ⚠️ 必须回填：目录行里已经没有 jpName 了，不回填 `原.jpName` 恒为 ''，
    // 前端一带 `expect.jpName` 就必然 409（乐观锁误报，用户看到「刚被别人改过」）
    await 卡名.回填(原);

    // ⚠️ 校验 `expect` 里的**每一个**键，不是只校验「这次要改的那几个」。
    // 只校验要改的键会漏掉这种情况：前端载入后别人改了卡密，我只改名字 ——
    // 卡密那个键不在 `改` 里就被跳过了，于是在一行已经被动过的数据上照样写成功。
    // `expect` 的语义是「我看到的整行」，就该整行对。
    for (const k of Object.keys(expect)) {
      if (String(expect[k] == null ? '' : expect[k]) !== String(原[k] == null ? '' : 原[k])) {
        return res.status(409).json({
          error: '这一行刚被别人改过，请刷新后再试',
          现在: { extCode: 原.extCode || '', jpName: 原.jpName || '' },
        });
      }
    }

    const 旧 = { extCode: 原.extCode || '', jpName: 原.jpName || '' };
    const 新 = {
      extCode: 改.extCode !== undefined ? 改.extCode : 旧.extCode,
      jpName: 改名 !== null ? 改名 : 旧.jpName,
    };

    // 快照写不进去就抛 → 500 中止，一个字都不改
    const stamp = cardAudit.makeStamp();
    const snap = cardAudit.saveSnapshot(stamp, code + '-before', [
      ...组.map(r => ({ _id: r._id, code, rarity: r.rarity, extCode: r.extCode, jpName: 旧.jpName })),
    ]);
    const audit = cardAudit.openAudit(stamp, 'row', code);

    // 整组一起改：卡密是这张卡的属性，不是某一行的
    if (Object.keys(改).length) await CardCatalog.updateMany({ code }, { $set: 改 });

    // 卡密一变身份就变（清空 → 改用编号；填新的 → 多一个卡密身份）
    await cardUniques.确保身份({ ...原, ...改 });

    // 名字写到身份表上（用**改后**的卡密算身份：卡密和名字同一批发过来时不能写错人）
    if (改名 !== null) {
      const 身份 = official.identityOf({ extCode: 新.extCode, code });
      if (!身份 || !身份.key) {
        return res.status(400).json({ error: '这一行既没有卡密也没有编号，找不到要改的身份' });
      }
      await CardUnique.updateOne(
        { keyType: 身份.keyType, key: 身份.key },
        { $set: { 'official.jp': 改名 } }
      );
      卡名.失效();     // 名字变了，映射得重建（否则 10 分钟内读到旧名）
    }
    review.bumpReviewVersion();

    audit.save({
      at: new Date().toISOString(),
      by: req.user && req.user.id,
      op: 'cardcatalogs.patchRow',
      code,
      before: 旧,
      after: 新,
      backupDir: snap.dir,
    });

    res.json({ ok: true, code, before: 旧, after: 新, backupDir: snap.dir, auditId: audit.auditId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 表1 行内改名 / 改卡密 ====================

/** 名字字段白名单。**顺序就是页面上的顺序**（日文 → 读音 → 简中 → 英文），别乱调。 */
const 名字字段 = ['jp', 'ruby', 'cn', 'en'];

/**
 * PATCH /v1/api/card-uniques/unique/:key — 改一个身份的四个名字（顺带可改卡密）
 *
 * body:
 *   keyType             'extCode' | 'code'                    身份类型（**必填**）
 *   set                 { jp?, ruby?, cn?, en?, extCode? }    要改的字段
 *   expect              { jp?, ruby?, cn?, en?, extCode? }    乐观锁：前端看到的那份旧值
 *   keyChangeConfirmed  true                                  改卡密时必须显式带
 *
 * `keyType` 为什么必填：唯一索引是 `{keyType, key}`，卡密和编号是**两个命名空间**，
 * 一个编号完全可能长得跟某个卡密一样。少了它就得两选一猜，猜错就是改到别人头上。
 *
 * 三条纪律，和上面 `PATCH /row/:code` 一模一样：
 *   · **字段白名单**只有那五个，其余一律丢弃（`cnName` 不在这轮范围里）
 *   · **乐观锁**：`expect` 里**每一个**键都要对得上，对不上 409 —— 别在别人刚改过的数据上再写一遍
 *   · **快照先落盘**：单机 MongoDB 没有副本集，跨集合写入退不回来，快照写不成功就整个中止
 *
 * ---------- 改卡密为什么必须连带改 `cardcatalogs` ----------
 * 这张表的身份是**目录行算出来的**（`cardUniques.清点身份()` 数的是 `cardcatalogs.extCode`），
 * 只改这里不改目录，不变量 `在用身份数 = 不同卡密 + 无卡密行` 当场就红，
 * 「待处理」页也还是老样子 —— 等于没改。所以两处一起动，顺序是先目录后身份表。
 *
 * ⚠️ 卡密**不允许在这里清空**：清空 = 这一组行全变成「无卡密行」，
 * 而一个身份下面可能挂着几十行、每行各有各的编号，谁来当新身份是没有答案的。
 * 真要清，得去「待处理」页按行处理。
 */
router.patch('/unique/:key', authAdmin, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ error: '缺身份键' });

    const { keyType, set = {}, expect = {}, keyChangeConfirmed = false } = req.body || {};
    if (keyType !== 'extCode' && keyType !== 'code') {
      return res.status(400).json({ error: "keyType 只能是 'extCode' 或 'code'" });
    }

    const 原 = await CardUnique.findOne({ keyType, key }).lean();
    if (!原) return res.status(404).json({ error: '唯一目录里没有这个身份：' + key });

    // ---------- 收名字字段 ----------
    const 改 = {};
    for (const f of 名字字段) {
      if (set[f] === undefined) continue;
      const v = String(set[f] == null ? '' : set[f]).trim();
      if (v.length > 300) return res.status(400).json({ error: '名字超过 300 字了' });
      改['official.' + f] = v;
    }

    // ---------- 收卡密 ----------
    // `新卡密 === null` 表示"这次不动卡密"，和"卡密清空"区分开
    let 新卡密 = null;
    if (set.extCode !== undefined) {
      const v = String(set.extCode == null ? '' : set.extCode).trim();
      if (v === String(原.key)) {
        /* 和现在一样 —— 当没改，省得白走一趟确认 */
      } else if (!v) {
        return res.status(400).json({ error: '卡密不能在这里清空：清空会让这个身份下的所有行变成无卡密行，身份就散了。要清请去「待处理」页按行处理' });
      } else if (keyType !== 'extCode') {
        return res.status(400).json({ error: '这个身份本来就是「无卡密」（身份 = 编号），没有卡密可改' });
      } else if (!卡密合法(v)) {
        return res.status(400).json({ error: `卡密${卡密说明}` });
      } else {
        新卡密 = v;
      }
    }

    if (!Object.keys(改).length && !新卡密) return res.status(400).json({ error: '没有要改的字段' });

    const 现在 = {
      jp: (原.official && 原.official.jp) || '',
      ruby: (原.official && 原.official.ruby) || '',
      cn: (原.official && 原.official.cn) || '',
      en: (原.official && 原.official.en) || '',
      extCode: 原.keyType === 'extCode' ? String(原.key) : '',
    };

    // ---------- 乐观锁：expect 里每一个键都比，不是只比这次要改的 ----------
    // 只比要改的键会漏掉：前端载入后别人改了卡密、我只改名字 —— 卡密不在 `改` 里就被跳过，
    // 于是在一行已经被动过的数据上照样写成功。`expect` 的语义是「我看到的整条」，就该整条对。
    for (const k of Object.keys(expect)) {
      const v = k === 'extCode' ? 现在.extCode : String(现在[k] == null ? '' : 现在[k]);
      if (String(expect[k] == null ? '' : expect[k]).trim() !== v) {
        return res.status(409).json({ error: '这一条刚被别人改过，请刷新后再试', 现在 });
      }
    }

    // ---------- 改卡密：动的其实是别的行，先把该拦的全拦下 ----------
    let 要改的行 = [];
    if (新卡密) {
      // 先把**一定会失败**的拦掉，再让前端去弹确认框。
      // 顺序反过来的话，用户确认完才发现"这个卡密已经被占了"，那个确认框就成了白点一下。
      if (await CardUnique.countDocuments({ keyType: 'extCode', key: 新卡密 })) {
        return res.status(409).json({ error: '卡密 ' + 新卡密 + ' 已经是唯一目录里的一个身份了，不能并过去' });
      }
      const 撞行 = await CardCatalog.countDocuments({ extCode: 新卡密 });
      if (撞行) {
        return res.status(409).json({ error: '卡密 ' + 新卡密 + ' 已经被目录里 ' + 撞行 + ' 行用着了，并过去会把两拨卡混成一张' });
      }
      if (!keyChangeConfirmed) {
        // 前端拿到 `需要确认` 去弹框，用户点了确认再带 keyChangeConfirmed 回来
        return res.status(409).json({
          error: '改卡密会连带改掉目录里所有用这个卡密的行，需要再确认一次',
          需要确认: true,
          受影响行数: await CardCatalog.countDocuments({ extCode: key }),
        });
      }
      // 存 _id + code 就够回滚了：撤销 = 把这些行改回旧卡密
      要改的行 = await CardCatalog.find({ extCode: key }).select('_id code').lean();
    }

    // ---------- 快照（写不进去就抛 → 500 中止，一个字都不改） ----------
    const stamp = cardAudit.makeStamp();
    const snap = cardAudit.saveSnapshot(stamp, key + '-before', [
      { 种类: '唯一目录', keyType, key, 文档: 原 },
      { 种类: '目录行（卡密要改的）', 旧卡密: key, 新卡密: 新卡密 || '', 行: 要改的行 },
    ]);
    const audit = cardAudit.openAudit(stamp, 'unique', key);

    // ---------- 写：先目录后身份表 ----------
    if (新卡密) {
      await CardCatalog.updateMany({ extCode: key }, { $set: { extCode: 新卡密 } });
      改.key = 新卡密;
      改.extCode = 新卡密;
    }
    await CardUnique.updateOne({ _id: 原._id }, { $set: 改 });

    // 名字改了不影响不变量（不变量只数身份），但卡密一改 `computePending` 的判定就全变了
    review.bumpReviewVersion();
    // ⚠️ 名字映射有 10 分钟缓存，不失效就是「改了名字，目录页刷新还是旧名」——
    // 表现成改名没生效，最难查的一类。见 services/cardNames.js。
    卡名.失效();

    const 新 = {
      jp: 改['official.jp'] !== undefined ? 改['official.jp'] : 现在.jp,
      ruby: 改['official.ruby'] !== undefined ? 改['official.ruby'] : 现在.ruby,
      cn: 改['official.cn'] !== undefined ? 改['official.cn'] : 现在.cn,
      en: 改['official.en'] !== undefined ? 改['official.en'] : 现在.en,
      extCode: 新卡密 || 现在.extCode,
    };

    audit.save({
      at: new Date().toISOString(),
      by: req.user && req.user.id,
      op: 'carduniques.patchUnique',
      keyType,
      key,
      before: 现在,
      after: 新,
      改的目录行数: 要改的行.length,
      backupDir: snap.dir,
    });

    res.json({
      ok: true,
      key,
      改后: 新,
      卡密变了: !!新卡密,
      改的目录行数: 要改的行.length,
      backupDir: snap.dir,
      auditId: audit.auditId,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /v1/api/card-uniques/unique — **手工新增**一条身份。
 *
 * 页面：唯一目录右上的红钮「＋ 添加」。用户要的就是「我手上有张卡，库里还没有，
 * 先把它登记进来」，所以这条**只写 `carduniques`**，不动 `cardcatalogs`。
 *
 * ---------- 为什么不建编号目录行 ----------
 * 编号目录的一行 = 「某个卡包里的某个位置」，要编号 + 卡包 + 罕贵度才立得住，
 * 这页一个都没有。硬造一行会污染目录页、库存、缺号三处的统计。用户明确选的就是「只进唯一目录」。
 *
 * ---------- 副作用（用户知情） ----------
 * 这样建出来的身份不在编号目录里，`对账()` 会把它算成「未使用身份」。
 * 那个计数是**只报不判**的（见 `cardUniques.js`），所以不变量不会变红、`/verify` 也不会翻。
 * 手工身份也**不会被 `rebuild` 清掉**：rebuild 是纯 upsert（`$setOnInsert`），不删也不改已存在文档。
 * 但它下一次 `refresh: true` 也补不到它 —— 它不在「由目录行算出来的身份」那个集合里。
 *
 * ---------- keyType 一律 extCode ----------
 * 用户定的：卡密位置「输入 8 位卡牌编码或者是输入其他的一个代号」，**一律当卡密身份**，
 * 原样存。所以这里**不做形态校验**（`PATCH` 那里做，两者不一致是有意的：
 * 改名是改动已有身份，得守住既有形态；新增是开一个新身份，形态由用户定）。
 *
 * ⚠️ 以前这里后面还跟着一句「代价：非数字的 key 取图会 404（后端只认 `\d{1,12}` 的 password）」。
 * **那个代价已经消掉了（V1.2.73）** —— 卡密的形态规则放宽成「字母/数字/下划线/短横线」
 * （定义在 `services/cardPassword.js`，全仓 8 个校验点共用），所以 `AT03-JP009`
 * 这种编号形状的 key 现在既能当身份、也取得到图。
 * 「这里不校验」的现状没变：带 `/` `\` `.` 的 key 仍能存进来，只是取图那一步会被
 * `/card-thumbnail` 的卡密门挡成 400 —— 首尾同一道门，是自洽的。
 *
 * ---------- 名字不自动补 ----------
 * 用户定的「不自动补，全手填」。四个都允许空串（空串合法，缺字段才是故障）。
 */
router.post('/unique', authAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const key = String(b.key == null ? '' : b.key).trim();
    if (!key) return res.status(400).json({ error: '卡密不能为空' });
    // 64 是够用的上限：卡密最多 12 位，代号也没见过更长的。
    // 卡这个是因为 key 会进 URL（前端 `/unique/:key`）和图片查询串，太长没好处。
    if (key.length > 64) return res.status(400).json({ error: '卡密最多 64 个字' });
    // 空格会被前端 `.trim()` 悄悄吃掉、控制字符会污染 URL，一律挡在门外
    if (/\s/.test(key)) return res.status(400).json({ error: '卡密里不能有空格' });
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F\u007F]/.test(key)) return res.status(400).json({ error: '卡密里有控制字符' });

    // 卡密和编号是**两个命名空间**（见 CardUnique 模型）：撞到编号身份不算冲突，只挡卡密身份。
    if (await CardUnique.countDocuments({ keyType: 'extCode', key })) {
      return res.status(409).json({ error: '唯一目录里已经有这个身份了：' + key });
    }

    const 名 = {};
    for (const f of 名字字段) {
      const v = String(b[f] == null ? '' : b[f]).trim();
      if (v.length > 300) return res.status(400).json({ error: '名字超过 300 字了' });
      名[f] = v;
    }

    const 文档 = { key, keyType: 'extCode', extCode: key, code: '', official: 名, builtAt: new Date() };

    // 快照先落盘，写不进去就抛 → 500 中止。新增本来就不需要「回滚」（还没写进去），
    // 留这份是为了和其它写接口一个形状：审计里能回答「这条是谁什么时候加的、当时填了什么」。
    const stamp = cardAudit.makeStamp();
    const snap = cardAudit.saveSnapshot(stamp, key + '-new', [{ 种类: '新增唯一目录身份', 文档 }]);
    const audit = cardAudit.openAudit(stamp, 'unique', key);

    try {
      await CardUnique.create(文档);
    } catch (e) {
      // 上面那个 countDocuments 和这里之间有条缝：两个人同时加同一个卡密时，
      // 靠 `{keyType,key}` 那个唯一索引兜底 —— 让并发的那一次也拿到人话的 409，而不是 500。
      if (e && e.code === 11000) return res.status(409).json({ error: '唯一目录里已经有这个身份了：' + key });
      throw e;
    }

    // 新身份会让 `computePending`／列表的判定全变（60 秒缓存，不 bump 就得等它自己过期）
    review.bumpReviewVersion();
    卡名.失效();       // 同上：新身份带着名字，映射得重建

    audit.save({
      at: new Date().toISOString(),
      by: req.user && req.user.id,
      op: 'carduniques.createUnique',
      keyType: 'extCode',
      key,
      after: 名,
      backupDir: snap.dir,
    });

    res.json({ ok: true, key, keyType: 'extCode', 改后: 名, backupDir: snap.dir, auditId: audit.auditId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /v1/api/card-uniques/unique/:key — **删掉一条身份**。
 *
 * 页面：详细弹窗右上角的「删除」。用户点名要的确认语是「确认删除这张卡牌吗」。
 *
 * ---------- 只删 `carduniques`，而且**只删得掉没人用的** ----------
 * 这是本模块唯一一个**做减法**的写接口，规矩跟 `rebuild`「只增不删」相反，所以边界要写死：
 *
 *   · 还被编号目录（`cardcatalogs`）的行引用着的 → **一律 409 拒绝**，不让删。
 *     理由不是洁癖，是删了立刻出事：
 *       ① `对账()` 的不变量是「在用身份数 === 不同卡密数 + 无卡密行数」。身份一删，
 *          在用的那份少一个、目录行那份没变 → 不变量当场假红，右上角那条红线冒出来，
 *          而这是**用户自己点的删除**，不是故障。
 *       ② 路线图里 `cardcatalogs` 的名字要由 `carduniques` 按卡密反查（批次 2）。
 *          身份没了，那些行就永久失去名字来源 —— 那时候再发现就补不回来了。
 *     所以「想删一个还有行在用的身份」的正确顺序是：先去处理那些目录行（改卡密 / 删行），
 *     等它变成未使用身份，再回来删。服务端把行数报出来，用户知道卡在哪。
 *
 *   · 没有行引用的（就是「未使用身份」）→ 删得掉。这正是「＋ 添加」手工加的那类：
 *     只进唯一目录、没有目录行，加错了就得有地方删。删完不变量仍然 ok
 *     （孤儿本来就「只报不判」，少一个孤儿更不会翻）。
 *
 * ---------- 没有副本集，别指望「查完再删」是原子的 ----------
 * 本机是单 mongod，`session.withTransaction` 用不了（见 `cardUniques.js` 那段）。
 * 所以「数引用行」和「删文档」之间那条缝是**挡不住并发**的：理论上另一个人正好在这条缝里
 * 给这个卡密插一行目录，就会删出一个孤儿引用。这里不假装能防住，靠的是：
 *   · 先落快照再删 —— 真出了情况，`Server/Storage/card-audit/` 里有完整原文档可以捞回来
 *   · 这是个单人后台工具，不是高并发服务
 * 快照里存的是**整个原文档**（不是只存 key），就是为了能一字不差地恢复。
 */
router.delete('/unique/:key', authAdmin, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ error: '缺身份键' });

    // keyType 走查询串（DELETE 带 body 各家实现不一致，查询串最稳）；也兼容 body
    const keyType = String(
      (req.query && req.query.keyType) || (req.body && req.body.keyType) || ''
    ).trim();
    if (keyType !== 'extCode' && keyType !== 'code') {
      return res.status(400).json({ error: "keyType 只能是 'extCode' 或 'code'" });
    }

    const 原 = await CardUnique.findOne({ keyType, key }).lean();
    if (!原) return res.status(404).json({ error: '唯一目录里没有这个身份：' + key });

    // ---------- 底线：还被目录行引用着就不许删 ----------
    // 有卡密的按 `extCode` 找；无卡密的身份（keyType='code'）按「没有 extCode 的行的 code」找。
    // `无卡密条件` 从 cardUniques.js 拿，不自己写 `{extCode:''}` —— 那样匹配不到字段缺失的行，
    // 会把「无卡密行」漏掉（那段注释就是为这个写的）。
    const 引用行数 = keyType === 'extCode'
      ? await CardCatalog.countDocuments({ extCode: key })
      : await CardCatalog.countDocuments({ ...cardUniques.无卡密条件, code: key });

    if (引用行数) {
      return res.status(409).json({
        error: '删不了：编号目录里还有 ' + 引用行数 + ' 行用着这个身份（' + key + '）。'
          + '先去处理那些行 —— 改掉它们的卡密或者删掉行 —— 等它变成「未使用身份」再回来删。',
        引用行数,
      });
    }

    // ---------- 快照先落盘（整个原文档），写不进去就抛 → 500 中止，一条都不删 ----------
    const stamp = cardAudit.makeStamp();
    const snap = cardAudit.saveSnapshot(stamp, key + '-delete', [{ 种类: '删除唯一目录身份', 文档: 原 }]);
    const audit = cardAudit.openAudit(stamp, 'unique', key);

    // 按 _id 删，不按 {keyType,key} 再查一遍 —— 快照里存的就是这条文档，删的必须也是它
    const r = await CardUnique.deleteOne({ _id: 原._id });
    if (!r.deletedCount) return res.status(404).json({ error: '唯一目录里没有这个身份：' + key });

    review.bumpReviewVersion();
    卡名.失效();       // 身份没了 → 之前靠它换出来的名字也作废

    const 删掉的 = {
      jp: (原.official && 原.official.jp) || '',
      ruby: (原.official && 原.official.ruby) || '',
      cn: (原.official && 原.official.cn) || '',
      en: (原.official && 原.official.en) || '',
      extCode: keyType === 'extCode' ? key : '',
    };

    audit.save({
      at: new Date().toISOString(),
      by: req.user && req.user.id,
      op: 'carduniques.deleteUnique',
      keyType,
      key,
      before: 删掉的,
      backupDir: snap.dir,
    });

    res.json({ ok: true, key, keyType, 删掉的, backupDir: snap.dir, auditId: audit.auditId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
