/**
 * 应用设置的读写口（对应 models/AppSetting.js 那张 key/value 表）。
 *
 * **默认值只在这儿写一份。** 页面上显示的数字、后端跑起来用的数字，都从 读设置() 出来，
 * 不然迟早出现「设置页写 5、执行时按 3 跑」这种谁也看不出来的走散。
 */
const AppSetting = require('../models/AppSetting');

// 出厂默认值。加新设置项：在这儿加一行 + 在 取值范围 里加一行，别处不用动。
const 默认值 = {
  // 一键上架：连着这么多个「没跑成」就自动停下 + 弹窗警告，交人工复核。
  // 口径（用户 2026-10-04 拍板）：**整批里跨包连着数**，换个包不清零 ——
  // 这玩意儿是用来抓「模拟器断了 / 流程配错了」这类系统性故障的，包内数只抓得住坏包。
  // 任意一张跑成 → 归零。
  连续失败熔断: 5,

  // 一键上架：**一张卡最多跑几遍**（V1.2.108）。1 = 不重试（就是从前那个样子），
  // 2 = 原样跑一遍 + 没跑成再立刻试一遍。用户 2026-10-04 拍的第一条就是它，
  // 起因是 ADB 那边「点一下没点中」这类抖动 —— 同一张卡整条流程**从头重跑**，
  // 不是从断掉那一步接着跑（流程对模拟器来说是一整个动作，中间态没法续）。
  // ⚠️ 重试的中间那些遍**不落 failed**（落了前端当场按终态渲染、接口也不再捞它，
  //    第二遍就没地方落脚了），所以整张卡在跑完之前一直停在 running ——
  //    「试到第几遍」只写在 ListingQueue.重试次数 上。
  // ⚠️ 急停（人手按的）**不重试**：那是人叫停的，再试一遍是跟人对着干。
  // ⚠️ PC 那条链（auto-execute.js）**不读这一条** —— 用户 2026-10-04 拍板只做 VM 这条。
  每卡最多尝试遍数: 2,
};

// 取值范围。熔断的 0 = 关掉（明确写 0 才行，空字符串不算 —— 别让人手滑清空输入框就把它关了）
const 取值范围 = {
  连续失败熔断: { 最小: 0, 最大: 999 },
  // 1 = 关掉重试。上限 5 是"ADB 抖一下没点中"的兜底，不是"试到成为止" ——
  // 调太大只会让一张真坏掉的卡把整批拖住（何况中间还不等待、连着跑）。
  每卡最多尝试遍数: { 最小: 1, 最大: 5 },
};

/** 读全部设置（缺的用默认值补上）。读不到就返回默认值 —— 设置丢了不该把上架整个卡住。 */
async function 读设置() {
  const 出 = { ...默认值 };
  try {
    const 行 = await AppSetting.find({ key: { $in: Object.keys(默认值) } }).lean();
    for (const r of 行) {
      if (Object.prototype.hasOwnProperty.call(默认值, r.key) && typeof r.value === 'number') {
        出[r.key] = r.value;
      }
    }
  } catch (e) {
    console.warn('[appSettings] 读设置失败，按默认值走:', e.message);
  }
  return 出;
}

/**
 * 写设置（只写传进来的那几项，其余不动）。返回实际落库的值。
 * 不认识的名字、非数字、空值一律**跳过**（不报错也不写默认）——
 * 前端多传一个字段不该把整次保存弄挂。
 */
async function 写设置(部分) {
  const 已存 = {};
  for (const [k, v] of Object.entries(部分 || {})) {
    if (!Object.prototype.hasOwnProperty.call(默认值, k)) continue;
    if (v === '' || v === null || v === undefined) continue;
    let n = Number(v);
    if (!Number.isFinite(n)) continue;
    n = Math.round(n);
    const { 最小, 最大 } = 取值范围[k];
    n = Math.min(最大, Math.max(最小, n));
    已存[k] = n;
    await AppSetting.updateOne({ key: k }, { $set: { value: n } }, { upsert: true });
  }
  return 已存;
}

module.exports = { 读设置, 写设置, 默认值, 取值范围 };
