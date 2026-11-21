// 从断点继续修正卡牌
const mongoose = require('mongoose');
const MONGO = 'mongodb://root:test123456@127.0.0.1:28018/s-lan?authSource=admin';
const START_INDEX = 8540; // 断点

async function search(code) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch('https://ygocdb.com/api/v0/?search=' + encodeURIComponent(code), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal
    });
    const d = await r.json();
    return d?.result?.[0] || null;
  } catch (e) {
    return null; // timeout/network error → treat as not found
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  await mongoose.connect(MONGO);
  const db = mongoose.connection.db;
  const col = db.collection('cardinfos');
  const all = await col.find({ versionId: 1 }).toArray();
  console.log(`${all.length} 张, 从第 ${START_INDEX + 1} 张继续, 批量并发\n`);

  let fixed = 0, same = 0, nf = 0, err = 0;
  const remaining = all.slice(START_INDEX);

  for (let i = 0; i < remaining.length; i += 20) {
    const batch = remaining.slice(i, i + 20);
    let results;
    try {
      results = await Promise.all(batch.map(async (card) => {
        if (!card.cardCode) return null;
        try {
          const r = await search(card.cardCode);
          if (!r) return 'nf';
          const rid = String(r.id);
          if (rid === String(card.extCode||'') && r.jp_name === card.jpName && r.cn_name === card.cnName) return 'same';
          await col.updateOne({ _id: card._id }, { $set: { extCode: rid, jpName: r.jp_name||'', cnName: r.cn_name||'' } });
          return 'fixed';
        } catch (e) { return 'err'; }
      }));
    } catch (batchErr) {
      console.error(`  批次异常: ${batchErr.message}, 跳过重试...`);
      err += batch.length;
      continue;
    }
    results.forEach(r => { if (r==='fixed') fixed++; if (r==='same') same++; if (r==='nf') nf++; if (r==='err') err++; });

    const globalIdx = START_INDEX + i + batch.length;
    if ((i / 20) % 25 === 0) {
      const pct = (globalIdx / all.length * 100).toFixed(1);
      console.log(`  ${globalIdx}/${all.length} (${pct}%) 修正:${fixed} 相同:${same} 未收录:${nf} 错误:${err}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n完成! 修正:${fixed} 相同:${same} 未收录:${nf} 错误:${err}`);
  await mongoose.disconnect();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
