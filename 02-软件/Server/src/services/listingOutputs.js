/**
 * 上架输出参数 —— 模拟器跑完往 variables 里回填的那 14 项，落库/回传共用这一张表。
 *
 * 为什么要抽出来：这 14 个键原先在 `auto-execute-vm.js` 里手抄了两遍 ——
 * 一遍是落库（只挑 4 项写）、一遍是回传给前端的 `allOutputs`（抄全 14 项）。
 * 两处不同步的话，前端「详细」面板显示得出来、库里却查不到（或者反过来），
 * 而且加一项就得记得改两个地方。现在改这一张表就够了。
 */
const ListingQueue = require('../models/ListingQueue');

// 中文键 = 模拟器回填时用的名字（改不了，VM 流程 JSON 里就是这么写的）
// field   = ListingQueue 的字段名
const 字段表 = [
  { key: '集换价(输出)',     field: 'outputJhj' },
  { key: '最低价(输出)',     field: 'outputLowest' },
  { key: '价格(输出)',       field: 'outputPrice' },
  { key: '编号(输出)',       field: 'outputCode' },
  { key: '罕贵度(输出)',     field: 'outputRarity' },
  { key: '中文卡名(输出)',   field: 'outputCnName' },
  { key: '中文别名(输出)',   field: 'outputCnAlias' },
  { key: '语种(输出)',       field: 'outputLang' },
  { key: '游戏版本(输出)',   field: 'outputGameVersion' },
  { key: '行数(输出)',       field: 'outputRows' },
  { key: '数量(输出)',       field: 'outputQty' },
  { key: '备注(输出)',       field: 'outputNote' },
  { key: '输入框编号(输出)', field: 'outputInputCode' },
  { key: '运行状态(输出)',   field: 'outputStatus' },
];

/**
 * 从执行变量里抠出 14 项输出。
 * 没跑到的项给**空串**而不是 undefined —— 落库和 JSON 回传都只认字符串。
 */
const 提取 = (variables) => {
  const 出 = {};
  for (const { key, field } of 字段表) {
    出[field] = String((variables || {})[key] || '');
  }
  return 出;
};

/** 反过来：把库里存的那 14 项摊回中文键，给前端「详细」面板原样显示 */
const 摊回 = (item) => {
  const 出 = {};
  for (const { key, field } of 字段表) {
    出[key] = String((item || {})[field] || '');
  }
  return 出;
};

/**
 * 跑完之后给「上架价格」打底：**仅当它还空着**，才拿集换价填上。
 *
 * 「空才填」这个判断得放在查询条件里、交给数据库做，不能先读出来在 JS 里比 ——
 * 用户完全可能在这一张正跑着的时候手填了价，先读后写会把他刚填的值冲掉。
 * 老版本的队列行里压根没有 listingPrice 这个字段，所以 `$exists:false` 也得算空。
 *
 * @returns {Promise<boolean>} 真的填进去了才返回 true
 */
const 给上架价打底 = async (filter, 集换价) => {
  const 价 = String(集换价 || '').trim();
  if (!价) return false;   // 集换价都没取到，别拿空串去当上架价
  const r = await ListingQueue.updateOne(
    { ...filter, $or: [{ listingPrice: '' }, { listingPrice: null }, { listingPrice: { $exists: false } }] },
    { $set: { listingPrice: 价 } }
  );
  return (r.modifiedCount || r.nModified || 0) > 0;
};

module.exports = { 字段表, 提取, 摊回, 给上架价打底 };
