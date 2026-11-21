/**
 * 「卡牌唯一目录」的建表与对账 —— `carduniques` 集合的**唯一**读写入口。
 *
 * 身份规则（用户定的，字面实现）：有卡密 → 身份 = 卡密；没卡密 → 身份 = 编号。
 * 见 `cardOfficial.identityOf()`。
 *
 * rebuild 是**只增不删**的：
 *   · 不删任何文档（库里多出来的陈旧身份留着，`/stats` 会报「未使用」让它们可见）
 *   · 默认不改已存在文档的 `official`（要刷新得显式 `refresh: true`）
 * 所以它可以直接重跑，跑两次结果一样 —— 这也是批次 2 的验收条件。
 *
 * 验收不变量（`/verify` 每次都算）：
 *     carduniques 里**在用的**身份数 === 不同卡密数 + 无卡密行数
 *
 * ⚠️ 为什么不直接比 `countDocuments()`：本模块「只增不删」，一旦某行的卡密被改掉、
 * 或者整行被删，旧身份就没人引用了，但仍留在集合里（设计如此，`/stats` 会报「未使用」）。
 * 拿全集合数去比，改一个卡密就会假红一次 —— 而那是**正常操作**，不是故障。
 * 所以这里只比「在用」的，孤儿另行计数上报。真实故障（身份该建没建）照样抓得到。
 */
const CardCatalog = require('../models/CardCatalog');
const CardUnique = require('../models/CardUnique');
const official = require('./cardOfficial');
// 卡密的形态规则全仓唯一一份（V1.2.73 从「1–12 位数字」放宽成字母/数字/下划线/短横线）。
// 这里只做转出，别的模块要用也 require `services/cardPassword` 本身。
const { 卡密合法 } = require('./cardPassword');
// 卡名映射有缓存（见 services/cardNames.js）—— 本模块是 carduniques 的**唯一**写入口，
// 所以失效集中放在这里：下面两个函数写完都调一次，别的地方不用各自记着。
const 卡名 = require('./cardNames');

/**
 * 「没有卡密」的唯一判定条件。**rebuild 和 verify 必须都走它**，
 * 不然两边的口径差一个字，不变量就会假报警。
 * 写 `{ extCode: '' }` 是不够的：那样匹配不到字段缺失的文档。
 */
const 无卡密条件 = { $or: [{ extCode: '' }, { extCode: null }, { extCode: { $exists: false } }] };

/** 卡密的合法形态 —— 定义在 `services/cardPassword.js`，这里只是转出（见文件顶上的 require）。 */

/**
 * 清点「库里现在有哪些身份」。
 * @returns {{ 卡密清单: string[], 无卡密行: Array<{_id:any, code:string}>, 有卡密行数: number }}
 */
async function 清点身份() {
  // distinct 走 extCode 索引，比全表投影便宜得多
  const 卡密清单 = (await CardCatalog.distinct('extCode'))
    .map((e) => String(e == null ? '' : e))
    .filter(Boolean)
    .sort();

  const 无卡密行 = await CardCatalog.find(无卡密条件).select('_id code').lean();
  const 总行数 = await CardCatalog.estimatedDocumentCount();

  return { 卡密清单, 无卡密行, 有卡密行数: 总行数 - 无卡密行.length };
}

/**
 * 把官方资料整成要写进文档的 `official` 子对象。
 *
 * ⚠️ **四个键一个都不能少**，没有值也要给空串 —— 见 `models/CardUnique.js` 那段的说明。
 * 宁可这里啰嗦一点，也不要靠 schema 默认值兜底：`$setOnInsert` 走原生 collection 时
 * 默认值不一定补上（`确保身份()` 就是走原生的），缺字段会让前端出现 undefined。
 */
function 官方子对象(o) {
  if (!o) return { jp: '', ruby: '', cn: '', en: '' };
  return {
    jp: o.jp || '',
    ruby: o.ruby || '',
    cn: o.cn || '',
    en: o.en || '',
  };
}

/**
 * 重建唯一目录。
 *
 * @param {{ dryRun?: boolean, refresh?: boolean, limit?: number }} opts
 *   dryRun   只报数（默认 true）
 *   refresh  连已存在文档的 `official` 一起刷新（默认 false = 只补新的）
 *   limit    只处理前 N 个身份，用来在真库上小步试
 */
async function rebuild({ dryRun = true, refresh = false, limit = 0 } = {}) {
  const t0 = Date.now();
  const { 卡密清单, 无卡密行 } = await 清点身份();
  const map = official.loadOfficialMap();

  const 上限 = Number(limit) > 0 ? Number(limit) : Infinity;

  // 先拼出「应该有哪些身份」，dryRun 和真跑共用这一段
  const ops = [];
  let 官方查到 = 0;
  for (const 卡密 of 卡密清单) {
    if (ops.length >= 上限) break;
    const o = map.get(卡密);
    if (o && o.status === '有') 官方查到++;
    const 官 = 官方子对象(o);
    ops.push({
      updateOne: {
        filter: { keyType: 'extCode', key: 卡密 },
        update: refresh
          ? { $set: { official: 官, builtAt: new Date() }, $setOnInsert: { extCode: 卡密, code: '' } }
          : { $setOnInsert: { extCode: 卡密, code: '', official: 官, builtAt: new Date() } },
        upsert: true,
      },
    });
  }
  for (const r of 无卡密行) {
    if (ops.length >= 上限) break;
    const code = String(r.code || '');
    if (!code) continue;
    // 没卡密 → 没有官方资料可查，official 全空、状态照抄「查不到」
    ops.push({
      updateOne: {
        filter: { keyType: 'code', key: code },
        update: { $setOnInsert: { extCode: '', code, official: 官方子对象(null), builtAt: new Date() } },
        upsert: true,
      },
    });
  }

  // ops 里前一段是卡密身份、后一段是编号身份，分界点就是 min(卡密清单.length, 上限)
  const 用掉的卡密 = 卡密清单.slice(0, 上限 === Infinity ? 卡密清单.length : 上限);
  const 用掉的编号 = 无卡密行.slice(0, Math.max(ops.length - 用掉的卡密.length, 0))
    .map((r) => String(r.code || '')).filter(Boolean);

  const 应有 = ops.length;
  const 已有 = 应有
    ? await CardUnique.countDocuments({
        $or: [
          { keyType: 'extCode', key: { $in: 用掉的卡密 } },
          { keyType: 'code', key: { $in: 用掉的编号 } },
        ],
      })
    : 0;

  if (dryRun) {
    return {
      ok: true, dryRun: true, refresh: !!refresh,
      计划: {
        卡密身份: 用掉的卡密.length,
        编号身份: 用掉的编号.length,
        合计: 应有,
        其中官方查得到: 官方查到,
      },
      当前: { 集合里已有: 已有, 估计新增: Math.max(应有 - 已有, 0) },
      耗时毫秒: Date.now() - t0,
    };
  }

  // ---------- 真跑：分批 500，ordered:false ----------
  // rebuild 是幂等的纯 upsert，中途断了重跑即可，不需要事务也不需要回滚快照。
  const 批大小 = 500;
  let 新增 = 0;
  let 改了 = 0;
  let 已存在 = 0;
  const 失败 = [];
  for (let i = 0; i < ops.length; i += 批大小) {
    const 批 = ops.slice(i, i + 批大小);
    // ⚠️ `timestamps: false` 不能省：schema 开了 timestamps，Mongoose 会给每个 upsert
    // 自动补一条 `$set: { updatedAt }`，于是**已经存在、一个字段都没变**的文档也会被算成 modified
    // —— 实测第二次 rebuild 报「改了 13883」，等于每次重跑都把 13883 个文档白写一遍，
    // 也违背「绝不改已存在文档」这句承诺（审计里那个「改了」会变成假信号）。
    const r = await CardUnique.bulkWrite(批, { ordered: false, timestamps: false });
    新增 += r.upsertedCount || 0;
    改了 += r.modifiedCount || 0;
    已存在 += r.matchedCount || 0;
    // ordered:false 下个别失败不会中断整批，但必须记下来
    const w = r.getWriteErrors ? r.getWriteErrors() : [];
    for (const e of w) 失败.push({ 第几批: i / 批大小, 错: e.errmsg || String(e) });
  }

  const 总数 = await CardUnique.countDocuments();
  // rebuild 会新建身份（`refresh: true` 还会改名字）→ 名字映射必须重建，否则页面读到旧名
  卡名.失效();
  return {
    ok: true, dryRun: false, refresh: !!refresh,
    写入: { 新增, 改了, 已存在, 失败: 失败.length, 失败样本: 失败.slice(0, 10) },
    集合里现在共: 总数,
    耗时毫秒: Date.now() - t0,
  };
}

/**
 * 补齐**一个**身份（不存在才建，存在就什么都不做）。
 *
 * 为什么需要它：单行改卡密之后，不变量
 *   `carduniques 条数 === 不同卡密数 + 无卡密行数`
 * 立刻就变了 —— 清空卡密会让「无卡密行」多一行，填个新卡密会让「不同卡密」多一个。
 * 如果等下次手工点 rebuild 才补，这中间的 `/stats` 会一直红着，看着像出了故障。
 * 所以单行写入路径改完顺手把新旧两个身份都补上。
 *
 * ⚠️ 走**原生 collection** 而不是 `CardUnique.updateOne`：schema 开了 `timestamps`，
 * Mongoose 会给更新自动补 `$set: { updatedAt }`，于是已经存在、什么都没变的文档
 * 也会被算成 modified —— 和 `rebuild` 里那个 `timestamps: false` 是同一个坑。
 *
 * @param {{extCode?: string, code?: string}} row 目录行（改过之后的）
 * @returns {{keyType: string, key: string}|null}
 */
async function 确保身份(row) {
  const { keyType, key } = official.identityOf(row);
  if (!key) return null;
  const o = keyType === 'extCode' ? official.loadOfficialMap().get(key) : null;
  const 现在 = new Date();
  await CardUnique.collection.updateOne(
    { keyType, key },
    {
      $setOnInsert: {
        keyType,
        key,
        extCode: keyType === 'extCode' ? key : '',
        code: keyType === 'code' ? key : String((row && row.code) || ''),
        official: 官方子对象(o),
        builtAt: 现在,
        createdAt: 现在,
        updatedAt: 现在,
      },
    },
    { upsert: true }
  );
  // 新身份带着名字进来（也可能什么都没变）→ 一律失效，宁可多重建一次也不让页面显示旧名
  卡名.失效();
  return { keyType, key };
}

/**
 * 验收裁判要的那几个不变量。只读。
 * @returns {{ ok: boolean, 检查项: Array<{项:string, 值:any, 期望:any, 过:boolean}> }}
 */
async function 对账() {
  const { 卡密清单, 无卡密行 } = await 清点身份();
  const 集合数 = await CardUnique.countDocuments();
  const 编号数 = 无卡密行.map((r) => String(r.code || '')).filter(Boolean).length;

  const 应有 = 卡密清单.length + 编号数;

  // 把「库里正在引用的身份」摊成一个 Set，再和集合里的逐条对照。
  // 集合只有 1 万多条，一次投影比在库里做两次 count 更直接，也顺手拿到孤儿名单。
  const 编号清单 = 无卡密行.map((r) => String(r.code || '')).filter(Boolean);
  const 在用 = new Set([
    ...卡密清单.map((k) => 'extCode:' + k),
    ...编号清单.map((c) => 'code:' + c),
  ]);
  const 全部身份 = await CardUnique.find({}, { keyType: 1, key: 1 }).lean();
  let 在用数 = 0;
  let 孤儿数 = 0;
  for (const d of 全部身份) {
    if (在用.has(d.keyType + ':' + d.key)) 在用数++;
    else 孤儿数++;
  }

  const 检查项 = [
    { 项: '在用身份数 = 不同卡密 + 无卡密行', 值: 在用数, 期望: 应有, 过: 在用数 === 应有 },
    // 孤儿是「只增不删」的正常副产物，只报不判 —— 判了就会因为改卡密、删行这类正常操作假红
    { 项: '未使用身份（只增不删的副产物，不判过）', 值: 孤儿数, 期望: '—', 过: true },
  ];

  // 逐类再确认一遍没漏：有卡密的身份必须都在、没卡密的编号身份必须都在
  const 有卡密已建 = await CardUnique.countDocuments({ keyType: 'extCode', key: { $in: 卡密清单 } });
  检查项.push({ 项: '卡密身份已建齐', 值: 有卡密已建, 期望: 卡密清单.length, 过: 有卡密已建 === 卡密清单.length });

  const 编号已建 = 编号清单.length
    ? await CardUnique.countDocuments({ keyType: 'code', key: { $in: 编号清单 } })
    : 0;
  检查项.push({ 项: '无卡密行的编号身份已建齐', 值: 编号已建, 期望: 编号清单.length, 过: 编号已建 === 编号清单.length });

  // 四个名字字段必须**存在**（空串合法，空串就是「官方和目录都没有」）。
  // 这是用户明确要的不变量：页面和导出拿到的东西形状永远一致，前端不用到处判 undefined。
  // 判的是「缺字段 / null」，不是「有没有值」—— 有值是内容问题，缺字段是结构问题，只有后者算故障。
  const 缺字段 = await CardUnique.countDocuments({
    $or: ['jp', 'ruby', 'cn', 'en'].flatMap((f) => [
      { ['official.' + f]: { $exists: false } },
      { ['official.' + f]: null },
    ]),
  });
  检查项.push({ 项: '四个名字字段都存在（空串合法）', 值: 缺字段, 期望: 0, 过: 缺字段 === 0 });

  return {
    ok: 检查项.every((c) => c.过),
    检查项,
    不变量: '在用 ' + 在用数 + ' = ' + 卡密清单.length + ' + ' + 编号数 + '（共 ' + 集合数 + '，其中未使用 ' + 孤儿数 + '）',
  };
}

module.exports = { rebuild, 清点身份, 对账, 确保身份, 无卡密条件, 卡密合法, 官方子对象 };
