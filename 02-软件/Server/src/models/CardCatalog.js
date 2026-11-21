const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { 拆 } = require('../services/catalogRarity');

const cardCatalogSchema = new mongoose.Schema({
  code: { type: String, required: true, index: true },
  // 卡面上实际印的编号。绝大多数卡跟 code 一致，留空即可。
  // 只有 DL1~DL5 这 5 个包不一致：卡面印 3 位补零（DL1-000），目录用「最少 2 位」（DL1-01），
  // 且目录号 = 卡面号 + 1。识别时 AI 读的是卡面号，所以查目录要拿这一列兜一次。
  // 注意：POST /api/tcg/import 会先清空重建，那里有专门的保护把这一列贴回去，改导入逻辑时别漏掉。
  faceCode: { type: String, default: '' },
  packCode: { type: String, default: '' },
  // ⚠️ 卡名（jpName / cnName / enName）**故意不在这里** —— 这一张表是**商品行**
  // （一行 = 一个卡包里的一个位置），卡名是「卡」的属性、不是商品行的属性。
  // 以前每行各存一份，同一个卡密在几十行里叫几十个名字（全半角连接号、HTML 实体没解码…）。
  // 名字现在只存一份，在 `carduniques`（卡牌唯一目录）里，按卡密换。
  // **要名字就 `await 卡名.回填(rows)`** —— 见 `services/cardNames.js` 顶上那段，
  // 它会把 jpName / cnName / enName 原地补回 lean 文档上，所以下游读法一个字不用改。
  // 注意 schema 是 strict 的：往这里写 jpName 会被**静默丢掉**，不会报错。
  extCode: { type: String, default: '' },
  // ⚠️ 从 V1.2.39 起**一行 = 一个 (编号, 罕贵度, 后缀序号)**，不再是「一个编号一行、
  // 多个罕贵度用「、」串起来」。`rarity` 这里是**单个**罕贵度（`UR` / `Normal Monster`…），
  // 外面那个整串由 `services/catalogRarity.js` 的 `合()` 拼、`拆()` 拆。
  // 唯一索引因此是 {code, rarity, altArtIndex} 三元组。
  rarity: { type: String, default: '' },
  hasAltArt: { type: Boolean, default: false },
  // 后缀序号，就是图源文件名的最后一段：`{编号}-{罕贵}.jpg` / `{编号}-{罕贵}-{序号}.jpg`。
  // 0 = 原画（文件名不带 `-N`）。以前只在罕贵度串里以 `SER(1)` 的写法存在，这一列全库恒 0。
  altArtIndex: { type: Number, default: 0 },
  // 异画标签：这一行是「原画」「异画」「初版」还是别的叫法。**人工填的**，空着就是没标。
  // 以前是 altLabels 一整份映射挂在编号上（`{ "SER|1": "异画" }`），拆行之后
  // 「罕贵度 + 后缀序号」本来就是一整行的主键，键不用再拼，直接落成字符串。
  altLabel: { type: String, default: '' },
  cnSource: { type: String, default: '' },
  versionId: { type: Number, default: 1 },
}, { timestamps: true, collection: 'cardcatalogs' });

cardCatalogSchema.index({ code: 1, rarity: 1, altArtIndex: 1 }, { unique: true });
cardCatalogSchema.index({ faceCode: 1 });
cardCatalogSchema.index({ extCode: 1 });
cardCatalogSchema.index({ packCode: 1 });
// 原来这里有个 `{ jpName, cnName, enName, code }` 的 text 索引：字段没了，索引跟着删。
// 它本来就是**死索引**（实测全库 `$text` 查询为零），按名字搜走的是 `services/cardNames.js`
// 的 `按名字找卡密()`。留在库里不会自动消失 —— `CardCatalog` 已经加进
// `index.js` 的 `syncIndexes()` 名单，启动时会对齐掉。

const CardCatalog = mongoose.model('CardCatalog', cardCatalogSchema);

// Auto-import from JSON on startup
const CATALOG_DIR = process.env.CARD_CATALOG_PATH || path.join(__dirname, '../../../data/card-catalog');

async function importFromJson() {
  const count = await CardCatalog.countDocuments();
  if (count > 0) return; // Already imported

  if (!fs.existsSync(CATALOG_DIR)) return;

  const indexFile = path.join(CATALOG_DIR, '_index.json');
  let index = { packs: [] };
  if (fs.existsSync(indexFile)) {
    try { index = JSON.parse(fs.readFileSync(indexFile, 'utf-8')); } catch (_) { return; }
  }

  console.log('[Local] Importing card catalog from JSON...');
  let imported = 0;
  for (const entry of index.packs) {
    const file = entry.file || (entry.code + '.json');
    const fp = path.join(CATALOG_DIR, file);
    if (!fs.existsSync(fp)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      for (const c of (data.cards || [])) {
        const code = (c.code || '').toUpperCase();
        const 来源标签 = c.altLabels || c.alt_labels || {};
        // 磁盘 JSON 里罕贵度还是「、」串（V1.1 也在读那个文件，格式不能动），
        // 进库时按 `拆()` 展开成一行一个罕贵度。
        for (const 行 of 拆(c.rarity)) {
          const doc = {
            code,
            faceCode: (c.faceCode || c.face_code || '').toUpperCase(),
            packCode: data.code || '',
            // 卡名不在这一张表里（见 schema 顶上的说明）。这条导入只在**空库**（count === 0）
            // 时才会跑，是给全新环境铺底用的 —— 名字交给 `services/cardNames.收下()`，
            // 但这里刻意不接：空库必然也没有 carduniques，两边都是空的，收了也留不住。
            // 真正会带名字进来的是 `POST /api/tcg/import`，那条路径接了。
            extCode: String(c.extCode || c.ext_code || ''),
            rarity: 行.rarity,
            hasAltArt: c.hasAltArt || c.has_alt_art || false,
            altArtIndex: 行.altArtIndex,
            // 老写法是一份映射（`{"SER|1": "异画"}`），新写法是行上的一个字符串
            altLabel: typeof c.altLabel === 'string' ? c.altLabel : (来源标签[`${行.rarity}|${行.altArtIndex}`] || ''),
            cnSource: c.cnSource || c.cn_source || '',
            versionId: c.versionId || 1,
          };
          await CardCatalog.updateOne(
            { code: doc.code, rarity: doc.rarity, altArtIndex: doc.altArtIndex },
            { $set: doc },
            { upsert: true }
          );
          imported++;
        }
      }
    } catch (_) {}
  }
  console.log('[Local] Imported ' + imported + ' cards from JSON');
}

// Run import
importFromJson().catch(e => console.error('[Local] Import error:', e.message));

module.exports = CardCatalog;
