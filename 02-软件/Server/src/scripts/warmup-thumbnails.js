/**
 * 缩略图全量预热脚本
 *
 * 遍历 OCG + YGOPro 两个图源的全部原图，生成 200px WebP 缩略图：
 *   Storage\tcg-data\images\Thumbnails\OCG\{code}-{rarity}(-{N}).webp
 *   Storage\tcg-data\images\Thumbnails\YGOPro\{password}.webp
 *
 * 已存在的缩略图跳过 → 支持断点续跑。
 *
 * 用法: node src/scripts/warmup-thumbnails.js [--only=ocg|ygopro]
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const tcgPaths = require('../services/tcgPaths');

const THUMB_W = 200;
const THUMB_QUALITY = 75;

const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';

let stats = { total: 0, generated: 0, skipped: 0, failed: 0 };

async function processFile(srcFile, subDir) {
  stats.total++;
  const fname = path.basename(srcFile).replace(/\.(jpg|jpeg|png)$/i, '.webp');
  const outDir = path.join(tcgPaths.get().thumbDir, subDir);
  const outFile = path.join(outDir, fname);
  try {
    if (fs.existsSync(outFile)) { stats.skipped++; return; }
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    await sharp(srcFile)
      .resize(THUMB_W, null, { withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toFile(outFile);
    stats.generated++;
  } catch (e) {
    stats.failed++;
  }
  if (stats.total % 2000 === 0) {
    console.log(`进度: ${stats.total} | 新生成 ${stats.generated} | 跳过 ${stats.skipped} | 失败 ${stats.failed}`);
  }
}

async function walkDir(dir, subDir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let st;
    try { st = fs.statSync(full); } catch (_) { continue; }
    if (st.isDirectory()) {
      if (entry.startsWith('_')) continue;
      await walkDir(full, subDir);
    } else if (/\.(jpg|jpeg|png)$/i.test(entry)) {
      await processFile(full, subDir);
    }
  }
}

async function main() {
  const { ocgDir, ygoproDir, thumbDir } = tcgPaths.get();
  console.log('缩略图预热开始');
  console.log('  OCG 图源:', ocgDir);
  console.log('  YGOPro 图源:', ygoproDir);
  console.log('  缩略图输出:', thumbDir);
  console.log('');

  const t0 = Date.now();
  if (!only || only === 'ocg') {
    console.log('--- 预热 OCG (详细图源) ---');
    await walkDir(ocgDir, 'OCG');
    console.log('OCG 完成: ' + JSON.stringify(stats));
  }
  if (!only || only === 'ygopro') {
    console.log('--- 预热 YGOPro (保底图源) ---');
    await walkDir(ygoproDir, 'YGOPro');
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log('');
  console.log('================ 完成 ================');
  console.log('总文件: ' + stats.total + ' | 新生成: ' + stats.generated + ' | 跳过: ' + stats.skipped + ' | 失败: ' + stats.failed);
  console.log('耗时: ' + Math.floor(secs / 60) + ' 分 ' + (secs % 60) + ' 秒');
  process.exit(0);
}

main();
