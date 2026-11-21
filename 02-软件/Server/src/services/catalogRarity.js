/**
 * 罕贵度串 ↔ 行 的拆合规则 —— **只有这一份实现**。
 *
 * 卡牌编号目录（`cardcatalogs`）从 V1.2.39 起是「一行 = 编号 × 罕贵度 × 后缀序号」，
 * 而外部世界（Excel 模板、磁盘包 JSON、V1.1、备份包、界面上那个整串输入框）
 * 一直是「一个编号一行、多个罕贵度用「、」连起来」。两边来回换就靠这里。
 *
 * ── 拆的规则（`拆()`）────────────────────────────
 *   1. **只按「、」拆**。
 *   2. 拆出来的每一段，`X(N)` → 罕贵度 `X` + 后缀序号 `N`；其余段后缀序号记 0。
 *
 *   ⚠️ 横杠和空格**不是分隔符**。库里真实存在这些**单个罕贵度**的名字：
 *      `UR-OF`、`Normal Monster`、`Quick-Play Spell`、`Effect Monster`
 *      把它们也拆开就废了。
 *
 * ── 后缀序号是什么 ───────────────────────────────
 *   它直接就是图源文件名的最后一段：`{编号}-{罕贵}.jpg` / `{编号}-{罕贵}-{序号}.jpg`。
 *   0 表示原画（文件名不带 `-N`）。所以 `SER(1)` 在图源里是 `XX-JP001-SER-1.jpg`。
 *   以前这个序号只以 `(N)` 的形式写在罕贵度串里，`altArtIndex` 那一列全库恒为 0 —— 拆行
 *   之后它才第一次真正被用起来。
 *
 * ── 合回去（`合()`）──────────────────────────────
 *   按传入顺序拼，后缀序号 > 0 的写成 `X(N)`。用 `拆()` 拆出来的数组原样喂回去，
 *   必然逐字节等于原串（迁移脚本拿这一条做验收）。
 */

/** `X(N)` / `SER(1)` 里的括号序号。注意只认**整个字符串末尾**的括号，`A(B)(1)` 这种不认。 */
const 带序号 = /^(.+?)\((\d+)\)$/;

/**
 * 罕贵度串 → [{ rarity, altArtIndex }]
 * 空串/空值 → `[ { rarity: '', altArtIndex: 0 } ]`（保留一行，不要返回空数组 ——
 * 调用方要 upsert，返回空数组会让本来存在的那行凭空消失）
 */
function 拆(串) {
  const 段 = String(串 ?? '').split('、').map(s => s.trim()).filter(Boolean);
  if (!段.length) return [{ rarity: '', altArtIndex: 0 }];
  return 段.map((p) => {
    const m = p.match(带序号);
    return m
      ? { rarity: m[1], altArtIndex: parseInt(m[2], 10) }
      : { rarity: p, altArtIndex: 0 };
  });
}

/**
 * 「磁盘 / Excel / 数据包里那一条」→ 行数组。
 *
 * 比 `拆()` 多认一个东西：条目**自带的 `alt_art_index` 字段**。优先级是
 * **token 自己写的 `(N)` 赢，没有 `(N)` 才用条目那个字段** —— 因为磁盘上两种写法都真实存在：
 *   · 老包 JSON：`{ rarity: "UR、SER、SER(1)", }`（没有 alt_art_index）—— 全靠 `(N)`
 *   · 导出/新写的行：`{ rarity: "SER", alt_art_index: 1 }` —— 靠字段
 * 两种都得能原样进库，而且**都能原样回去**（`合()` 出来的串 + 这个函数是互逆的）。
 */
function 展开(rarityStr, 条目序号 = 0) {
  const 基准 = parseInt(条目序号) || 0;
  return 拆(rarityStr).map(r => ({
    rarity: r.rarity,
    altArtIndex: r.altArtIndex > 0 ? r.altArtIndex : 基准,
  }));
}

/** [{ rarity, altArtIndex }] → 罕贵度串。`拆()` 的逆运算。 */
function 合(rows) {
  return (rows || [])
    .map(r => (r && r.altArtIndex > 0 ? `${r.rarity}(${r.altArtIndex})` : (r && r.rarity) || ''))
    .filter(Boolean)
    .join('、');
}

/** 图源文件名里那一段：`SER` / `SER-1`。和 `findOcgExact()` 的拼法必须一致。 */
function 文件段(rarity, altArtIndex) {
  const r = String(rarity || '').trim();
  if (!r) return '';
  return altArtIndex > 0 ? `${r}-${altArtIndex}` : r;
}

module.exports = { 拆, 合, 展开, 文件段 };
