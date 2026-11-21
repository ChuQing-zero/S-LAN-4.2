/**
 * 一次性回填：给 cardmarks 里所有老记录补上 `rarity: ''`（不限罕贵度）。
 *
 * 为什么需要它：
 *   信息登记原本是**按编号唯一**的，记录里根本没有 rarity 这个键。
 *   现在改成按 (编号, 罕贵度) 唯一，唯一的键是 `{code:1, rarity:1}`，
 *   而「键不存在」在索引里算 `null`、和 `''` 是**两个不同的索引项** ——
 *   混着的话唯一索引挡不住重复，同一条记录能并存两份。
 *   所以上线前先把 92 条老记录统一补成 `''`。
 *
 * 为什么不塞进服务启动流程：
 *   同 backfill-cardmarks.js —— 一次性的事，跑完就没用了；
 *   而且它必须在**新唯一索引建起来之前**跑完，启动流程里做不到这个先后。
 *
 * 安全：
 *   · 只补 `rarity` 这一个键，其余字段一个字不动（用 $set 单字段）
 *   · 条件写死 `{ rarity: { $exists: false } }` —— 已经有值的记录**碰都不碰**
 *   · 幂等，重复跑第二次就是 0 条
 *   · 先跑 --dry 看数量，确认了再去掉 --dry
 *
 * ⚠️ 这里刻意**不 require CardMark 模型**：mongoose 一编译模型就可能按新 schema
 *    去建唯一索引，那就跑到迁移前面去了。全程只用原生 collection。
 *
 * 用法（在 Server 目录下）：
 *   node scripts/backfill-cardmark-rarity.js --dry    # 只看会改几条
 *   node scripts/backfill-cardmark-rarity.js          # 真的写
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const config = require('../src/config');

const DRY = process.argv.includes('--dry');

(async () => {
  console.log(`连接 ${config.mongodbUri}`);
  await mongoose.connect(config.mongodbUri);

  const col = mongoose.connection.db.collection('cardmarks');
  const 缺键 = { rarity: { $exists: false } };

  const total = await col.countDocuments({});
  const todo = await col.countDocuments(缺键);
  console.log(`cardmarks 共 ${total} 条，其中缺 rarity 键的 ${todo} 条`);

  if (!todo) {
    console.log('✅ 没有要补的，已经是统一形状了');
    await mongoose.disconnect();
    return;
  }

  // 打印几条样本，肉眼确认这些就是那批老记录（都是 auto 的 DL1~DL5 之类）
  const 样本 = await col.find(缺键, { projection: { code: 1, source: 1, markedAt: 1 } })
    .sort({ code: 1 }).limit(8).toArray();
  console.log('待补样本:', JSON.stringify(样本.map((r) => ({
    code: r.code, source: r.source, markedAt: r.markedAt,
  }))));

  if (DRY) {
    console.log(`\n--dry：只报数，没写库。去掉 --dry 才会真写 ${todo} 条。`);
    await mongoose.disconnect();
    return;
  }

  const r = await col.updateMany(缺键, { $set: { rarity: '' } });
  console.log(`✅ 补了 ${r.modifiedCount} 条（matched ${r.matchedCount}）`);

  const 剩余 = await col.countDocuments(缺键);
  console.log(`复查：仍缺 rarity 键的 ${剩余} 条${剩余 === 0 ? ' ✅' : ' ❌'}`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
