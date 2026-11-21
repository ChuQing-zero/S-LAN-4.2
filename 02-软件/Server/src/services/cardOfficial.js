/**
 * 官方卡牌资料的公共入口 —— 全项目判「一行目录的名字对不对」的唯一口径。
 *
 * 数据从哪来：用 ygocdb.com 的公开接口把全库卡密逐个查了一遍（13813 个），
 * 结果落在 `{仓库根}/Storage/card-official/all-cards.jsonl`，一行一个卡密。
 * 生成脚本是 `Server/scripts/fetch-official-cards.js`；本模块**只读它，不写**。
 *
 * 对外三样东西：
 *   loadOfficialMap()  卡密 → { jp, ruby, cn, cnAlts, en, status }
 *   skeleton()         名字归一化
 *   compareName()      一行目录的名字和它卡密的官方名，到底是哪一种不符
 *   identityOf()       一行目录属于哪个「唯一目录身份」
 *   computePending()   全库扫一遍挑出名字对不上的行（纯函数，不碰数据库）
 *
 * ⚠️ skeleton 是**唯一被 13813 条数据验证过**的实现，别顺手"优化"：
 *   · 直插式注音（死し者しゃ蘇そ生せい）用字符串替换剥不掉 → 只能整段删读音
 *   · 逐段对消读音会把「呼び声」的 び 当成注音吃掉（よび 的 び 和名字里的 び 是同一个字符）
 *   · 纯片假名卡名（サイバー・ドラゴン）的读音就是它自己，无脑删会把名字整个删空，
 *     反而把「同名」判成「不同名」→ 所以先判有没有汉字
 */

const fs = require('fs');
const path = require('path');

// __dirname = Server/src/services → 往上 3 级是仓库根。
// 官方数据和 Storage/card-catalog 同级放在根的 Storage 里（那两个目录都在 .gitignore 里，
// 属本机运行时数据 —— 和卡牌目录 JSON 源的待遇一致）。
const OFFICIAL_FILE = path.join(__dirname, '..', '..', '..', 'Storage', 'card-official', 'all-cards.jsonl');

// ---------- 名字归一化 ----------

const 去括号 = (s) => String(s || '').replace(/[（(][^）)]*[）)]/g, '');
const 去引号 = (s) => s.replace(/[「」『』〈〉《》【】]/g, '');
const 化半角 = (s) => String(s || '').replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const 去空白 = (s) => s.replace(/[\s　]+/g, '');

/** 最轻的规范化：只是全角转半角 + 去空白。比中文名、比卡密时用它 */
const normalize = (s) => 去空白(化半角(s));

/** 平假名折成片假名（ぁ→ァ）。官方名和库里的名字常常一个用平假名一个用片假名写同一个音 */
const 折叠假名 = (s) => String(s || '').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

const 是假名 = (c) => /[ァ-ヶー]/.test(c || '');

/** 注音段里会出现的连接符（アダマシア・クリスタ / ＺＷゼアル・ウェポン－…） */
const 是注音标点 = (c) => /[・＝\-－]/.test(c || '');

const 是注音字符 = (c) => 是假名(c) || 是注音标点(c);

/** 实字：假名和连接符之外的字（汉字 / 拉丁 / 数字 / 「」这类）。读音只注在实字后面 */
const 实字 = (c) => !!c && !是注音字符(c);

const 罗马 = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/**
 * 标点归一：同一张卡在不同地方会写成不同的标点，实测踩到的有
 *   `Ｅｖｉｌ★Ｔｗｉｎ＇ｓ` / `Evil★Twin’s`（全角撇号 vs 弯撇号）
 *   `ギアギアーノ Mk-II` / `ギアギアーノ Mk－Ⅱ`（半角连字符+字母 I vs 全角连字符+罗马数字）
 *   `･`（半角中点）vs `・`（全角中点）
 * ⚠️ 只在**新口径**（字面）里折，不动 normalize / skeleton —— 那两个的老行为已经被 13813 条数据验过。
 */
const 折标点 = (s) => String(s || '')
  .replace(/[’‘‛′＇]/g, "'")
  .replace(/[“”″]/g, '"')
  .replace(/･/g, '・')
  .replace(/ｰ/g, 'ー')
  .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]/g, (c) => 罗马[c.charCodeAt(0) - 0x2160]);

/**
 * 字面形：去掉括号里的注音、「」引号、空白、全角差异，折掉标点差异，再把平假名折成片假名。
 * 用来判「两个名字是不是同一张卡的两种写法」。
 */
const 字面 = (s) => 折叠假名(折标点(去引号(去括号(normalize(s)))));

/**
 * 库里的名字大多写成「官方名 + 各段假名读音」的内联注音，例如：
 *   库 `Ｅ・ＨＥＲＯエレメンタルヒーロー エアーマン`  官方 `E・HERO エアーマン`
 *   库 `Ｎｏ．ナンバーズ１５ ギミック・パペット－…`  官方 `No.15 ギミック・パペット－…`
 * 所以判据是：**官方名是不是「库名删掉若干段假名」之后剩下的** ——
 * 顺序一致、没匹配上的字符全是假名，就说明多出来的只是读音，卡本身没填错。
 *
 * 但光这样会把「官名 + 另一个词」也吞掉：
 *   `クリボートークン`  → `クリボー`      （多出来的「トークン」也是假名）
 *   `サイバー・エンド・ドラゴン` → `サイバー・ドラゴン`（多出来的「エン」也是假名）
 * 所以再加一条：**每个多出来的假名段，前面必须紧挨着一个实字**。
 * 读音是注在被注音的那个字后面的（`魔救の奇石` + `アダマシア・クリスタ`），
 * 而上面两个反例里，多出来的段前面分别是 `ー` 和 `・`，都不是实字 → 挡掉。
 * 这条也顺手解决了「读音整串缀在名字尾巴上」：
 *   `ビクトリー・バイパー XX０３` + `ダブルエックスゼロスリー`（前面是数字 ３）→ 仍然算注音。
 *
 * ⚠️ 不能用「从左往右贪心配」：`Ｅ・ＨＥＲＯエレメンタルヒーロー エアーマン` 里，
 * 第一个「エ」会被贪心配给官方名末尾的「エアーマン」，剩下那一段前面就不是实字了。
 * 换成一个带回溯的对齐：只要**存在**一种「哪些字算读音」的切法满足条件就算同一张卡。
 */
function 是注音写法(库, 官) {
  if (!官) return false;
  const n = 库.length;
  const m = 官.length;
  const 记 = new Map();   // `${i},${j},${前一个是实字 ? 1 : 0}` → bool

  // i：已用掉库里的前 i 个字；j：已配上官方名的前 j 个字。
  // 到了这里说明 i-1 那个字是配上的（i>0 时），前一个是实字由参数带进来。
  function 走(i, j, 前一个是实字) {
    if (i === n) return j === m;
    const key = i + ',' + j + ',' + (前一个是实字 ? 1 : 0);
    if (记.has(key)) return 记.get(key);
    记.set(key, false);   // 防环（本题不会成环，顺手挡一下）

    let ok = false;
    // ① 库里这个字正好是官方名的下一个字 → 直接配上
    if (j < m && 库[i] === 官[j]) ok = 走(i + 1, j + 1, 实字(库[i]));
    // ② 官方名的下一个字还没出现 → 把它当成一段读音，长度从 1 开始逐个试
    if (!ok && 前一个是实字 && 是注音字符(库[i])) {
      for (let k = i + 1; k <= n; k++) {
        if (走(k, j, 前一个是实字)) { ok = true; break; }
        if (k < n && !是注音字符(库[k])) break;   // 段必须由注音字符连成
      }
    }
    记.set(key, ok);
    return ok;
  }

  // 开头没有实字可注（前一个是实字 = false），所以库名不可能以「凭空一段读音」开头
  return 库 !== 官 && 走(0, 0, false);
}

/**
 * 名字骨架：去括号 → 去引号 → 全角转半角 → 去空白 →（含汉字时）删掉读音 → 删掉所有平假名。
 * 两边骨架一致 = 同一张卡。验：
 *   青眼の白龍(ブルーアイズ…) 与 青眼の白龍        → 都是「青眼白龍」✓
 *   死し者しゃ蘇そ生せい     与 死者蘇生          → 都是「死者蘇生」✓
 *   サイバー・エンド・ドラゴン 与 サイバー・ドラゴン  → 骨架不同 ✗（正确地判为不同卡）
 */
function skeleton(s, ruby) {
  let t = 去引号(去括号(normalize(s)));
  // 纯片假名卡名的读音就是它自己，无脑删会把名字删空 → 反而把「同名」判成「不同名」
  if (ruby && /[一-鿿]/.test(t)) t = t.split(normalize(ruby)).join('');
  return t.replace(/[ぁ-ゖ]/g, '');
}

/**
 * 一行目录属于哪个「唯一目录身份」。
 * 用户定的规则：有卡密用卡密，没卡密用编号。字面实现，不做任何"聪明"处理 ——
 * 特别是别给 extCode='0' 那种加"无效卡密回退编号"，那会一次性把 34 行拆成 34 个身份。
 */
function identityOf(row) {
  return row && row.extCode
    ? { keyType: 'extCode', key: String(row.extCode) }
    : { keyType: 'code', key: String((row && row.code) || '') };
}

// ---------- 官方资料 ----------

let _map = null;

/**
 * 卡密 → 官方资料。整份 jsonl 解析一次后缓存在模块里（3.3 MB，13813 条）。
 * jsonl 里的字段名是中文（卡密/状态/官方日/ruby/官方中/中文其他/en），这里统一转成英文键，
 * 后面的代码就不用到处写中文 key 了。
 */
function loadOfficialMap() {
  if (_map) return _map;
  const m = new Map();
  if (!fs.existsSync(OFFICIAL_FILE)) {
    console.error('[cardOfficial] 找不到官方数据：' + OFFICIAL_FILE);
    console.error('[cardOfficial] 先跑 node scripts/fetch-official-cards.js 生成（约 43 分钟）。');
    _map = m;
    return _map;
  }
  for (const line of fs.readFileSync(OFFICIAL_FILE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch (_) { continue; }
    const extCode = String(r.卡密 || '');
    if (!extCode) continue;
    m.set(extCode, {
      extCode,
      status: r.状态 === '有' ? '有' : '查不到',
      jp: r.官方日 || '',
      ruby: r.ruby || '',
      cn: r.官方中 || '',
      cnAlts: Array.isArray(r.中文其他) ? r.中文其他 : [],
      en: r.en || '',
    });
  }
  _map = m;
  return _map;
}

const officialFile = () => OFFICIAL_FILE;
const hasOfficialFile = () => fs.existsSync(OFFICIAL_FILE);

// ---------- 判定 ----------

/**
 * 一行目录的名字 vs 它卡密的官方名字。
 * 返回：
 *   'ok'           对得上（含「写法啰嗦但同一张卡」以外的一切正常情况）
 *   'noOfficial'   官方源没有这个卡密（查不到）→ 无从判断，别当成错
 *   'emptyName'    库里这行名字是空的
 *   'verboseName'  库里把官方名写成了带内联注音的啰嗦写法 → 同一张卡，只是写法该清一清
 *   'shortName'    库里的名字是官方名的开头（少了一截）
 *   'wrongExtCode' 名字其实是另一张卡 → 卡密填错了
 */
function compareName(rowJp, official) {
  if (!official || !official.jp) return 'noOfficial';

  const 库 = 字面(rowJp);
  if (!库) return 'emptyName';
  const 官 = 字面(official.jp);
  if (库 === 官) return 'ok';

  // 老口径（括号注音 / 读音整段删掉后一致）也还留着，两条只要中一条就算同一张卡
  if (skeleton(rowJp, official.ruby) === skeleton(official.jp, null)) return 'ok';

  if (是注音写法(库, 官)) return 'verboseName';   // 官方名 = 库名删掉若干假名读音
  if (官.startsWith(库)) return 'shortName';       // 库名是官方名的开头
  return 'wrongExtCode';
}

const 有卡密 = (r) => !!(r && r.extCode);

/**
 * 全库扫一遍，挑出「名字和官方对不上」的行。**纯函数** —— 不碰数据库，输入输出都是普通对象，
 * 所以离线脚本、接口、复核脚本能共用同一套判定，数字不会各说各话。
 *
 * @param {Array} rows 目录行，需含 { _id, code, packCode, jpName, cnName, extCode, rarity }
 * @param {{ indexSymmetric?: boolean }} opts
 *   indexSymmetric：查「这行名字其实是哪张卡」时，索引键和查询键用不用同一个骨架。
 *   默认 false = 上一轮离线统计（78/69/186）的写法，先原样保留以便对得上数；
 *   复核脚本会两种都算一遍做对照。
 */
function computePending(rows, opts = {}) {
  const official = loadOfficialMap();
  const 索引对称 = !!opts.indexSymmetric;

  // 全库「名字骨架 → 用过的卡密」。判「这行的名字其实是哪张卡」全靠它，
  // 唯一命中才能当建议值；多命中说明库里自己就分不清，零命中说明这张卡没在别处出现过。
  const 名索引 = new Map();
  for (const r of rows) {
    if (!有卡密(r)) continue;
    const k = skeleton(r.jpName, null);
    if (!k) continue;
    if (!名索引.has(k)) 名索引.set(k, new Set());
    名索引.get(k).add(String(r.extCode));
  }

  const out = [];
  for (const r of rows) {
    if (!有卡密(r)) continue;                       // 没卡密 → 判不出对错，走「缺卡密」另列
    const o = official.get(String(r.extCode));
    const kind = compareName(r.jpName, o);
    if (kind === 'ok' || kind === 'noOfficial') continue;

    const item = {
      _id: r._id,
      code: r.code,
      packCode: r.packCode,
      rarity: r.rarity || '',
      jpName: r.jpName || '',
      cnName: r.cnName || '',
      currentExtCode: String(r.extCode),
      altArtIndex: r.altArtIndex || 0,
      kind,
      officialJp: (o && o.jp) || '',
      officialRuby: (o && o.ruby) || '',
      officialCn: (o && o.cn) || '',
      suggestion: {},
    };

    if (kind === 'emptyName' || kind === 'shortName' || kind === 'verboseName') {
      // 名字不对（或写得太啰嗦）、卡密是对的 → 换成官方日文名就完事
      item.suggestion = { jpName: o.jp };
    } else {
      // 名字其实是另一张卡 → 去全库找这张卡自己用过的卡密
      const 库里骨 = 索引对称 ? skeleton(r.jpName, null) : skeleton(r.jpName, (o && o.ruby) || '');
      const 候选 = [...(名索引.get(库里骨) || [])].filter((e) => e !== String(r.extCode));
      item.suggestion = 候选.length === 1
        ? { extCode: 候选[0] }
        : { extCode: '', candidates: 候选 };
    }
    out.push(item);
  }
  return out;
}

module.exports = {
  skeleton,
  normalize,
  字面,
  折叠假名,
  是注音写法,
  identityOf,
  compareName,
  computePending,
  loadOfficialMap,
  officialFile,
  hasOfficialFile,
};
