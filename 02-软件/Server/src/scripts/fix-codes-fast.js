// 高并发修正卡牌编号 — Promise pool 批量并发
const mongoose = require('mongoose');
const MONGO = 'mongodb://root:test123456@127.0.0.1:28018/s-lan?authSource=admin';
const POOL_SIZE = 15; // 15个并发请求

async function searchYGOCDB(code) {
  const resp = await fetch('https://ygocdb.com/api/v0/?search=' + encodeURIComponent(code), {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const data = await resp.json();
  return data?.result?.[0] || null;
}

async function main() {
  await mongoose.connect(MONGO);
  const db = mongoose.connection.db;
  const col = db.collection('cardinfos');

  const all = await col.find({ versionId: 1 }).toArray();
  console.log(`共 ${all.length} 张，${POOL_SIZE} 并发`);

  let fixed = 0, same = 0, notFound = 0, errors = 0;
  let i = 0;

  async function process(card) {
    const code = card.cardCode;
    if (!code) return;
    try {
      const result = await searchYGOCDB(code);
      if (!result) { notFound++; return; }
      const correctId = String(result.id);
      const currentId = String(card.extCode || '');
      const correctJp = result.jp_name || '';
      const correctCn = result.cn_name || '';

      if (correctId === currentId && correctJp === card.jpName && correctCn === card.cnName) {
        same++;
      } else {
        await col.updateOne({ _id: card._id }, { $set: { extCode: correctId, jpName: correctJp, cnName: correctCn } });
        fixed++;
      }
    } catch (e) { errors++; }
  }

  // Promise pool: 保持 POOL_SIZE 个并发
  const pool = new Set();
  for (const card of all) {
    const p = process(card).then(() => { pool.delete(p); i++; if (i % 500 === 0) console.log(`  ${i}/${all.length} 修正:${fixed} 相同:${same} 未找到:${notFound}`); });
    pool.add(p);
    if (pool.size >= POOL_SIZE) await Promise.race(pool);
  }
  await Promise.all(pool);

  console.log(`\n完成! 修正:${fixed} 相同:${same} 未找到:${notFound} 错误:${errors}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
