/**
 * 一次性回填：把「编号在目录里查不到」的卡补登记进 cardmarks（source=auto）。
 *
 * 为什么需要它：
 *   自动登记是挂在**写路径**上的（识别出编号 / 新建卡 / 改编号）。这个功能上线之前
 *   就已经录进库里的那些卡 —— 比如 DL1~DL5 那批数据有问题的 —— 不会自己回过头去登记，
 *   上传页上它们会是没有绿块的白卡。跑一次这个脚本补上，之后新卡就都自动了。
 *
 * 为什么是手动脚本、不塞进服务启动流程：
 *   启动时扫全库会拖慢每次重启；而且这是一次性的事，跑完就没用了。
 *
 * 安全：
 *   · 幂等 —— 用 $setOnInsert，重复跑不会覆盖任何已有记录（人手动登记过的原样保留）
 *   · 只增不删 —— 不会改动任何一张卡，也不会删任何记录
 *   · 先跑 --dry 看数量，确认了再去掉 --dry
 *
 * 用法（在 Server 目录下）：
 *   node scripts/backfill-cardmarks.js --dry     # 只看会登记哪些，不写库
 *   node scripts/backfill-cardmarks.js           # 真的写
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const config = require('../src/config');
const Card = require('../src/models/Card');
const CardCatalog = require('../src/models/CardCatalog');
const CardMark = require('../src/models/CardMark');

const DRY = process.argv.includes('--dry');
const norm = (v) => String(v || '').trim().toUpperCase();

(async () => {
  console.log(`连接 ${config.mongodbUri}`);
  await mongoose.connect(config.mongodbUri);

  // 1) 库里所有卡用到的编号（规范化后去重）
  const rawCodes = await Card.distinct('code');
  const codes = [...new Set(rawCodes.map(norm).filter((c) => c && c !== '...' && c !== '---'))];
  console.log(`库里共有 ${codes.length} 个去重编号`);

  // 2) 目录里有的编号
  const rawCat = await CardCatalog.distinct('code');
  const catSet = new Set(rawCat.map(norm));
  console.log(`目录里有 ${catSet.size} 个编号`);

  // 3) 查不到目录的 = 该登记的
  const misses = codes.filter((c) => !catSet.has(c));
  console.log(`其中 ${misses.length} 个编号在目录里查不到 → 要登记\n`);

  if (!misses.length) {
    console.log('没有要补的，收工。');
    await mongoose.disconnect();
    return;
  }

  // 4) 每个编号拿一张代表卡，用于首次建档的快照（库名/卡名/卡图）
  const reps = await Card.find({ code: { $in: misses } })
    .select('code libraryCode jpName cnName img')
    .lean();
  const repMap = new Map();
  for (const r of reps) {
    const c = norm(r.code);
    if (!repMap.has(c)) repMap.set(c, r);
  }

  // 5) 逐条登记。走的是跟线上完全同一个 autoRegister —— 判定口径不会跑偏。
  let added = 0;
  let skipped = 0;
  const byPrefix = {};

  for (const code of misses) {
    byPrefix[code.split('-')[0] || '(无前缀)'] = (byPrefix[code.split('-')[0] || '(无前缀)'] || 0) + 1;

    if (DRY) continue;

    const rep = repMap.get(code) || {};
    const ok = await CardMark.autoRegister(code, {
      libraryCode: rep.libraryCode,
      jpName: rep.jpName,
      cnName: rep.cnName,
      img: rep.img,
    });
    ok ? added++ : skipped++;
  }

  console.log('按卡包分组：');
  Object.entries(byPrefix)
    .sort((a, b) => b[1] - a[1])
    .forEach(([p, n]) => console.log(`   ${p.padEnd(8)} ${n}`));

  if (DRY) {
    console.log('\n[--dry] 只统计没写库。去掉 --dry 再跑一次就真写。');
  } else {
    console.log(`\n新登记 ${added} 条，已存在跳过 ${skipped} 条`);
    console.log(`cardmarks 现在共 ${await CardMark.countDocuments()} 条`);
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
