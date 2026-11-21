// CardCrop 数据一键导入 MongoDB
// 用法: node src/scripts/import-cardcrop.js
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MONGO_URI = 'mongodb://root:test123456@127.0.0.1:28018/s-lan?authSource=admin';
const DATA_DIR = 'C:/Users/17761/Desktop/CardCrop/card-importer/OCG-日文';
const IMG_SRC = 'C:/Users/17761/Desktop/CardCrop/card-importer/YGOPRODeck图源';
const IMG_DST = path.join(__dirname, '../../uploads/cards');

const CardInfoSchema = new mongoose.Schema({
  cardCode: { type: String, required: true, unique: true },
  versionId: { type: Number, required: true },
  jpName: { type: String, default: '' },
  cnName: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  rarity: { type: String, default: '' },
  extCode: { type: String, default: '' }
});

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected');
  const CardInfo = mongoose.model('CardInfo', CardInfoSchema);

  if (!fs.existsSync(IMG_DST)) fs.mkdirSync(IMG_DST, { recursive: true });

  // 索引所有图片
  const imgFiles = new Set();
  if (fs.existsSync(IMG_SRC)) {
    fs.readdirSync(IMG_SRC).forEach(f => {
      if (/\.(jpg|png|webp)$/i.test(f)) imgFiles.add(f);
    });
  }
  console.log(`${imgFiles.size} images found`);

  const jsonFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  console.log(`${jsonFiles.length} series JSON files`);

  let total = 0, imported = 0, withImg = 0, skipped = 0;

  for (const file of jsonFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
      const cards = data.cards || [];
      for (const card of cards) {
        total++;
        const cardCode = (card.code || '').trim();
        if (!cardCode) continue;

        const extCode = (card.ext_code || '').trim();
        let imageUrl = '';

        // 匹配图片
        if (extCode) {
          for (const ext of ['jpg', 'png', 'webp']) {
            const fn = extCode + '.' + ext;
            if (imgFiles.has(fn)) {
              const src = path.join(IMG_SRC, fn);
              const dst = path.join(IMG_DST, fn);
              if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
              imageUrl = '/uploads/cards/' + fn;
              withImg++;
              break;
            }
          }
        }

        try {
          await CardInfo.findOneAndUpdate(
            { cardCode },
            {
              cardCode,
              versionId: 1, // 游戏王日文
              jpName: card.jp_name || '',
              cnName: card.cn_name || '',
              imageUrl,
              rarity: card.rarity || '',
              extCode
            },
            { upsert: true, new: true }
          );
          imported++;
        } catch (e) {
          if (e.code === 11000) { skipped++; continue; }
          console.error(`  Error: ${cardCode} - ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`  JSON error: ${file}`);
    }
    if (imported % 1000 === 0) process.stdout.write(`\r  ${imported}/${total}...`);
  }

  console.log(`\nDone! Total:${total} Imported:${imported} WithImg:${withImg} Skipped:${skipped}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
