// 批量并发修正 — 简单有效
const mongoose = require('mongoose');
const MONGO = 'mongodb://root:test123456@127.0.0.1:28018/s-lan?authSource=admin';

async function search(code) {
  const r = await fetch('https://ygocdb.com/api/v0/?search=' + encodeURIComponent(code), {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const d = await r.json();
  return d?.result?.[0] || null;
}

async function main() {
  await mongoose.connect(MONGO);
  const db = mongoose.connection.db;
  const col = db.collection('cardinfos');
  const all = await col.find({ versionId: 1 }).toArray();
  console.log(`${all.length} 张, 批量并发`);

  let fixed = 0, same = 0, nf = 0, err = 0;

  // 每批 20 个并发
  for (let i = 0; i < all.length; i += 20) {
    const batch = all.slice(i, i + 20);
    const results = await Promise.all(batch.map(async (card) => {
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
    results.forEach(r => { if (r==='fixed') fixed++; if (r==='same') same++; if (r==='nf') nf++; if (r==='err') err++; });
    if ((i/20) % 25 === 0) console.log(`  ${i+20}/${all.length} 修正:${fixed} 相同:${same} 未收录:${nf}`);
    await new Promise(r => setTimeout(r, 200)); // 批次间稍等
  }

  console.log(`\n完成! ${fixed}修正 ${same}相同 ${nf}未收录 ${err}错误`);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
