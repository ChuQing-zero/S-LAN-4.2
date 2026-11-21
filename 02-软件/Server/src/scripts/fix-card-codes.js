// 用百鸽 API 修正所有卡牌编号和卡密
// 用法: node src/scripts/fix-card-codes.js
const mongoose = require('mongoose');
const MONGO_URI = 'mongodb://root:test123456@127.0.0.1:28018/s-lan?authSource=admin';

async function searchYGOCDB(code) {
  const resp = await fetch('https://ygocdb.com/api/v0/?search=' + encodeURIComponent(code), {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const data = await resp.json();
  return data?.result?.[0] || null;
}

async function main() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const col = db.collection('cardinfos');

  const all = await col.find({ versionId: 1 }).toArray();
  console.log(`共 ${all.length} 张卡牌，开始逐张查询百鸽...`);

  let fixed = 0, same = 0, notFound = 0, errors = 0;
  const batch = [];

  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    const code = c.cardCode;
    if (!code) continue;

    try {
      const result = await searchYGOCDB(code);
      if (!result) {
        notFound++;
        continue;
      }

      const correctId = String(result.id);
      const currentId = String(c.extCode || '');
      const correctJp = result.jp_name || '';
      const correctCn = result.cn_name || '';

      if (correctId === currentId && correctJp === c.jpName && correctCn === c.cnName) {
        same++;
      } else {
        // 需要修正
        await col.updateOne(
          { _id: c._id },
          { $set: { extCode: correctId, jpName: correctJp, cnName: correctCn } }
        );
        fixed++;
        if (fixed <= 5) console.log(`  ${code}: ${c.jpName} → ${correctJp} | ${currentId} → ${correctId}`);
      }
    } catch (e) {
      errors++;
      if (errors <= 3) console.error(`  Error: ${code} - ${e.message}`);
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  进度: ${i + 1}/${all.length} (修正:${fixed} 相同:${same} 未找到:${notFound})`);
    }

    // 延迟避免请求太快
    if ((i + 1) % 5 === 0) await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n完成! 修正:${fixed} 相同:${same} 未找到:${notFound} 错误:${errors}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
