/**
 * 把全库卡密逐个对一遍官方源（ygocdb.com），结果追加进
 *   {仓库根}/Storage/card-official/all-cards.jsonl
 * 一行一个卡密，字段名是中文：卡密 / 状态 / 官方日 / ruby / 官方中 / 中文其他 / en。
 * `src/services/cardOfficial.js` 只读这个文件，不写。
 *
 * ⚠️ 输出文件**不进 git**（和 Storage/card-catalog 同待遇，见根目录 .gitignore）。
 *    它是本机数据；真正落库之后由数据库备份兜底，这个文件丢了重跑本脚本即可（全量约 43 分钟）。
 *
 * 特性（都是上一轮跑 13813 个卡密时踩出来的）：
 *   · **逐条追加**，启动时自动跳过已查过的卡密 —— 中途挂了直接重跑就是续跑
 *   · 进度同时写进 all-cards.log，可以另开一个窗口 tail
 *   · 3 路并发 + 每条之间 300ms 延时，不打扰人家的免费接口
 *   · 只读数据库，不写任何东西
 *
 * 用法（在 Server 目录下）：
 *   node scripts/fetch-official-cards.js           # 全量；已查过的跳过
 *   node scripts/fetch-official-cards.js --dry     # 只报「要查几个」，不发请求
 *
 * 结果里的「状态」有三种：
 *   有     查到官方资料
 *   查不到 官方源没有这个卡密（可能是笔误或还没收录）
 *   出错   网络重试两次仍失败 → **不要把它当成「查不到」**，
 *          下一次重跑本脚本会自动重查它（因为续跑只跳过「有」和「查不到」）
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const config = require('../src/config');

// __dirname = Server/scripts → 往上 2 级是仓库根
const DIR = path.join(__dirname, '..', '..', 'Storage', 'card-official');
const OUT = path.join(DIR, 'all-cards.jsonl');
const LOG = path.join(DIR, 'all-cards.log');

const 并发数 = 3;
const 每条延时 = 300;
const DRY = process.argv.includes('--dry');

const log = (msg) => {
  const line = '[' + new Date().toLocaleTimeString('zh-CN') + '] ' + msg;
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
  console.log(line);
};

/** 读已有的 jsonl，返回 卡密 → 记录。只把「有」和「查不到」当成已完成 */
function 读已完成的() {
  const m = new Map();
  if (!fs.existsSync(OUT)) return m;
  for (const line of fs.readFileSync(OUT, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch (_) { continue; }
    const k = String(o.卡密 || '');
    if (!k) continue;
    if (o.状态 !== '有' && o.状态 !== '查不到') continue;   // 「出错」的下次重查
    m.set(k, o);
  }
  return m;
}

async function 查一个(卡密) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch('https://ygocdb.com/api/v0/?search=' + encodeURIComponent(卡密), {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://ygocdb.com/' },
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      const 命中 = (j.result || []).find((x) => String(x.id) === String(卡密));
      return 命中
        ? {
            卡密,
            状态: '有',
            官方日: 命中.jp_name,
            ruby: 命中.jp_ruby,
            官方中: 命中.sc_name || '',
            中文其他: [命中.cn_name, 命中.nwbbs_n, 命中.cnocg_n, 命中.md_name]
              .filter(Boolean).filter((v, i2, a) => a.indexOf(v) === i2),
            en: 命中.en_name,
          }
        : { 卡密, 状态: '查不到' };
    } catch (e) {
      if (i === 1) return { 卡密, 状态: '出错', 错: String(e.message || e) };
      await new Promise((r2) => setTimeout(r2, 1500));
    }
  }
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });

  await mongoose.connect(config.mongodbUri);
  const 全部卡密 = (await mongoose.connection.db.collection('cardcatalogs').distinct('extCode'))
    .filter(Boolean).map(String);
  await mongoose.disconnect();

  // 只有纯数字才可能是卡密；4 个笔误（位数不对）会查不到，但也要跑一遍留证
  const 纯数字 = 全部卡密.filter((e) => /^\d{1,12}$/.test(e));
  const 非数字 = 全部卡密.filter((e) => !/^\d{1,12}$/.test(e));
  log('库里的卡密共 ' + 全部卡密.length + ' 个：纯数字（能查官方）' + 纯数字.length + ' 个，非纯数字 ' + 非数字.length + ' 个'
    + (非数字.length ? ' → ' + 非数字.slice(0, 10).join(' ') : ''));

  const 已完成 = 读已完成的();
  const 待查 = 纯数字.filter((c) => !已完成.has(c));
  log('已有记录 ' + 已完成.size + ' 个，本次要查 ' + 待查.length + ' 个');

  if (DRY) {
    log('--dry：只报数，不发请求。');
    return;
  }
  if (!待查.length) {
    log('没有要查的，收工。');
    return;
  }

  const 开始 = Date.now();
  let 完成数 = 0;
  const 统计 = { 有: 0, 查不到: 0, 出错: 0 };

  async function 工人() {
    for (;;) {
      const 卡密 = 待查.shift();
      if (!卡密) return;
      const r = await 查一个(卡密);
      统计[r.状态] = (统计[r.状态] || 0) + 1;
      fs.appendFileSync(OUT, JSON.stringify(r) + '\n');
      完成数++;
      if (完成数 % 100 === 0) {
        const 用时 = (Date.now() - 开始) / 1000;
        const 速度 = 完成数 / 用时 || 1;
        log('进度 ' + 完成数 + '/' + (完成数 + 待查.length)
          + ' 已用 ' + (用时 / 60).toFixed(1) + ' 分钟，剩约 ' + (待查.length / 速度 / 60).toFixed(0) + ' 分钟');
      }
      await new Promise((r2) => setTimeout(r2, 每条延时));
    }
  }

  log('开始 ' + 并发数 + ' 路并发…');
  await Promise.all(Array.from({ length: 并发数 }, 工人));

  log('===== 完成 =====');
  log('本次查 ' + 完成数 + ' 个：查到 ' + 统计.有 + '，查不到 ' + 统计.查不到 + '，出错 ' + 统计.出错);
  if (统计.出错) log('⚠️ 有 ' + 统计.出错 + ' 个出错 —— 再跑一次本脚本会自动重查它们。');
  log('总耗时 ' + ((Date.now() - 开始) / 60000).toFixed(1) + ' 分钟；结果在 ' + OUT);
})().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
