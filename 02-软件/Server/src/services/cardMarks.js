/**
 * 信息登记（cardmarks）的**匹配口径**，一处定义、处处引用。
 *
 * 为什么要有这个文件：登记现在按 (编号, 罕贵度) 唯一，而且 `rarity: ''` 是个**通配**
 * （不限罕贵度，92 条老记录全是它）。于是"这张卡登记过没有"这句话，从
 * 「code 在不在集合里」变成了「(code, rarity) 这一对在不在集合里，或者这个 code 有没有通配记录」。
 * 这个判断散在 4 个读点上（libraries ×2、cards ×1、路由 ×1），
 * 只要有一处漏了通配分支，症状就是"老记录突然不标红了"—— 很难一眼看出来。
 * 所以口径只写在这儿。
 *
 * ⚠️ 归一化只有一套：**去空格 + 转大写，其余一字不差**。
 *    不要往这里加去前导零、去 `(N)` 后缀之类的容错：
 *    · 编号侧本来就有"位数对不上"要标出来（那是 catalog.vue 的 normCode，**显示**用）；
 *    · 罕贵度侧实测全库 38767 行 cards / 39399 行 cardcatalogs **没有一行带后缀**，
 *      不需要归一化；真加了反而会把不同印刷混成一档。
 */

const norm = (v) => String(v || '').trim().toUpperCase();

// 这两个是"还没识别出来"的占位符，不是编号。三处写路径都不认它们，读侧也得一致地不认，
// 否则一张 code='...' 的卡会去跟一条同样莫名其妙的登记记录对上。
const 无效 = (c) => !c || c === '...' || c === '---';

/** 成对键。通配那条的键是 `CODE|`，和 `CODE|N` 天然分得开。 */
const 键 = (code, rarity) => norm(code) + '|' + norm(rarity);

/** 把 `CardMark.find(...).select('code rarity').lean()` 的结果变成一个判定函数。 */
const 造匹配器 = (rows) => {
  const 通配 = new Set();
  const 成对 = new Set();
  for (const r of rows || []) {
    const c = norm(r.code);
    if (无效(c)) continue;
    if (norm(r.rarity)) 成对.add(c + '|' + norm(r.rarity));
    else 通配.add(c);
  }
  // 命中条件：这个编号有通配记录，或者 (编号, 罕贵度) 这一对精确存在。
  return (code, rarity) => {
    const c = norm(code);
    if (无效(c)) return false;
    return 通配.has(c) || 成对.has(c + '|' + norm(rarity));
  };
};

/** 和 造匹配器 等价，但用在 Mongo 聚合里的两路 $or（见 routes/libraries 的问题计数）。 */
const 分组 = (rows) => {
  const 通配 = [];
  const 成对 = [];
  for (const r of rows || []) {
    const c = norm(r.code);
    if (无效(c)) continue;
    if (norm(r.rarity)) 成对.push(c + '|' + norm(r.rarity));
    else 通配.push(c);
  }
  return { 通配, 成对 };
};

module.exports = { norm, 键, 造匹配器, 分组 };
