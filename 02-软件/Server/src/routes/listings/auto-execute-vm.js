/**
 * VM 一键上架批量执行 — ADB 自动化 + ListingQueue 状态同步 + 断点续跑
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const auth = require('../../middleware/auth');
const sc = require('../listing-agent-vm/screen');
// 注意：急停**不从这里发**。终止端点在 routes/listing-agent-vm/index.js 的 POST /execute/stop，
// 这里只需要在开跑前把上一轮遗留的旗子清掉（见下面 `resetAbort(batchId)`）。
const { executeSteps, resetAbort } = require('../listing-agent-vm/executor');
const ListingQueue = require('../../models/ListingQueue');
const ListingBatch = require('../../models/ListingBatch');
const listingLock = require('../../services/listingRunLock');
const { 提取: 提取输出, 摊回: 摊回输出, 给上架价打底 } = require('../../services/listingOutputs');
const { 标记已上架 } = require('../../services/listingMarkListed');
// 「一键上架」那两条运行时设置：连续失败熔断（V1.2.106）+ 每卡最多尝试遍数（V1.2.108）。
// 默认值 / 取值范围都在 services/appSettings.js，别处不要再写一份。
const { 读设置 } = require('../../services/appSettings');
// WS 实时同步: 一键上架进度广播给各端 (主机面板/手机/网页)
const wss = require('../../ws');

const CONFIG_DIR = path.join(__dirname, '../../config/listing-flows-vm');

// 加载 VM 流程配置。
// **VM 侧只有 A 和 B 两份**（V1.2.69 起）。这里原来还有一份 `流程C-更新.json`，
// 但从来没被读过 —— 下面选流程的地方是「A → A，其余（含 C）→ B」。用户拍板：VM 上
// C 没有用了，A/B 就够，所以那份死配置已经删掉。PC 侧的 `listing-flows/流程C-更新.json`
// 是真在用的（auto-execute.js 读），那份不动。
const FLOW_A = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, '流程A-新建.json'), 'utf-8'));
const FLOW_B = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, '流程B-更新.json'), 'utf-8'));

const STRIP_BRACES = (s) => (s || '').replace(/[{}]/g, '');

// 没带 successCode 的流程只提醒一次（不然一批 50 张就刷 50 行同样的日志）
const 已提醒过没成功码的流程 = new Set();

/** 展开 VM 流程步骤 + 处理 stepVariable（对齐 panel-vm.vue 逻辑） */
function flattenSteps(steps, variables = {}) {
  const flat = [];
  for (const step of (steps || [])) {
    const t = step.type || step.stepType || 'click';
    const d = step.stepDuration || step.duration || 0.5;
    const actions = step.actions || [];

    if (step.stepVariable) {
      const varName = STRIP_BRACES(step.stepVariable);
      const varVal = variables[varName];

      if (['click', 'dblclick', 'tplclick'].includes(t)) {
        if (varVal) {
          // 变量有值 → 匹配 action name → 固化为坐标
          const match = actions.find(a => a.name === varVal);
          if (match) {
            flat.push({ type: t, x: match.x, y: match.y, duration: d, desc: step.desc || step.name });
          }
        } else {
          // 变量无值 → 运行时动态解析（如行数(输出)等）
          flat.push({ type: t, _varName: varName, _actions: actions, duration: d, desc: step.desc || step.name });
        }
      } else if (t === 'input') {
        if (actions.length === 0) {
          flat.push({ type: 'input', text: step.stepVariable || '', x: 0, y: 0, duration: d, desc: step.desc });
        } else {
          for (const a of actions) {
            flat.push({ type: 'input', text: a.text || '', x: a.x || 0, y: a.y || 0, duration: d, desc: step.desc });
          }
        }
      } else if (t === 'ocr-find-row') {
        const act = actions[0] || {};
        flat.push({ type: 'ocr-find-row', x1: act.x1, y1: act.y1, x2: act.x2, y2: act.y2,
          ocrPrompt: act.ocrPrompt || '', duration: d, desc: step.desc });
      } else if (t === 'extract') {
        if (actions.length === 0) {
          flat.push({ type: 'extract', actions: [{ keyword: step.stepVariable || '', outputVar: step.stepVariable || '' }], duration: d, desc: step.desc });
        } else {
          flat.push({ type: 'extract', actions, duration: d, desc: step.desc });
        }
      } else if (t === 'extract-row') {
        const eractions = (actions.length > 0) ? actions : [{ keyword: step.stepVariable || '', offset: 0 }];
        flat.push({ type: 'extract-row', actions: eractions, duration: d, desc: step.desc });
      } else if (t === 'press') {
        flat.push({ type: 'press', text: actions[0]?.text || step.stepVariable || '', duration: d, desc: step.desc });
      } else if (t === 'scroll') {
        flat.push({ type: 'scroll', scroll_clicks: actions[0]?.scroll_clicks || -500, duration: d, desc: step.desc });
      } else if (t === 'find-click') {
        flat.push({ type: 'find-click', keyword: actions[0]?.keyword || step.stepVariable || '', duration: d, desc: step.desc });
      } else {
        // 默认处理
        const action = actions[0] || null;
        flat.push({ type: t, x: action?.x || step.x, y: action?.y || step.y,
          text: action?.text || step.text, duration: d, desc: step.desc || step.name });
      }
    } else {
      // 无 stepVariable → 正常展开
      const action = actions[0] || null;
      // find-click 特殊处理
      if (t === 'find-click') {
        flat.push({ type: 'find-click', keyword: (action?.keyword || step.keyword || ''), duration: d, desc: step.desc || step.name });
      } else {
        flat.push({
          type: t,
          x: action ? action.x : step.x,
          y: action ? action.y : step.y,
          text: action ? action.text : step.text,
          duration: d,
          desc: step.desc || step.name || `步骤${flat.length + 1}`,
          // ===== compare/jump/setvar 字段（剥掉 {{}}） =====
          compareVar: STRIP_BRACES(step.compareVar),
          compareRightVar: STRIP_BRACES(step.compareRightVar),
          compareOp: step.compareOp, compareValue: step.compareValue,
          trueJump: step.trueJump, falseJump: step.falseJump,
          jumpTo: step.jumpTo,
          leftVar: STRIP_BRACES(step.leftVar),
          rightVar: STRIP_BRACES(step.rightVar),
          template: step.template,
          // ===== 其他 =====
          actions: actions.length > 0 ? actions : (action ? [action] : []),
          scroll_clicks: action ? (action.scroll_clicks || step.scroll_clicks) : (step.scroll_clicks || -500),
          _varName: step._varName, _actions: step._actions,
          x1: step.x1 || (action ? action.x1 : null), y1: step.y1 || (action ? action.y1 : null),
          x2: step.x2 || (action ? action.x2 : null), y2: step.y2 || (action ? action.y2 : null),
          ms: step.ms || (action ? action.ms : null),
        });
      }
    }
  }
  return flat;
}

// POST /v1/api/listings/auto-execute-vm — VM 一键上架
router.post('/', auth, async (req, res) => {
  const batchId = (req.body && req.body.batchId) || '';
  if (!batchId) {
    return res.status(400).json({ error: 'batchId is required' });
  }
  // 起点 / 单包，都是可选的。**两个都不传 = 整批**，跟从前一模一样。
  // 详情屏那枚「自动上架」会带上 packCode（+ 选了起点才带的 startIndex）；
  // 包列表那枚不带 —— 它就是用来跑整批的。
  const packCode = (req.body && req.body.packCode) || '';
  const rawStart = req.body ? req.body.startIndex : null;
  const startIndex = (rawStart === null || rawStart === undefined || rawStart === '')
    ? null : Number(rawStart);
  if (startIndex !== null && !Number.isFinite(startIndex)) {
    return res.status(400).json({ error: 'startIndex must be a number' });
  }
  // 熔断计数要不要接着上一趟数（V1.2.106）。整批是前端**一个包发一次请求**（V1.2.104），
  // 所以「跨包不清零」只能靠前端在第一个包之后的每一次请求里带 true 来说。
  // 不带 = 这是一趟新的开始 → 计数归零。老客户端不带这个字段，行为就是"每包归零"，
  // 比"一路继承"安全（继承了的话，一趟跑完留下的尾数会让下一趟刚开跑就熔断）。
  const 连败继续 = !!(req.body && req.body.连败继续);

  // ===== 执行互斥，两道 =====
  // 第一道：进程内的锁。双击「一键上架」、或者局域网里两台设备同时点，
  // 第二次直接 409 —— 不能让同一批在模拟器上把 ADB 动作做两遍。
  if (!listingLock.acquire(batchId)) {
    return res.status(409).json({ error: '这一批正在执行中，请勿重复点击' });
  }
  // 第二道：看库里的痕迹。上一次跑到一半进程没了的话，会留下 running 的行 ——
  // 那种行**不会自己变回 pending**（宁可停在那儿让人看见，也不能装作没事），
  // 得人去点「重跑」把它放回去。这里先拦下来。
  let 僵尸行 = 0;
  try {
    僵尸行 = await ListingQueue.countDocuments({ batchId, userId: req.user.id, itemStatus: 'running' });
  } catch (e) {
    listingLock.release(batchId);   // 查库都炸了，锁不能攥着不放
    return res.status(500).json({ error: e.message });
  }
  if (僵尸行 > 0) {
    listingLock.release(batchId);
    return res.status(409).json({
      error: `这一批有 ${僵尸行} 张停在「执行中」（上次没跑完留下的），先把它们点「重跑」再启动`,
    });
  }

  try {
    const queueItems = await ListingQueue.find({ batchId, userId: req.user.id }).sort({ index: 1 }).lean();
    if (queueItems.length === 0) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    // ===== 档案：归档过的不许再跑，已确认的包整包不跑（V1.2.76）=====
    // 跟 PC 版逐字同一条守卫。**放在 ensureConnected 之前** —— 被拒绝的请求不该去碰 ADB。
    // 包级只读原先只挡在行级接口（queues.js 的 取条目）上，而真正批量改行的是这里。
    const 档案 = await ListingBatch.findOne({ batchId, userId: req.user.id })
      .select('state donePacks 连败').lean();
    if (档案 && 档案.state === 'listed') {
      return res.status(409).json({ error: '这一批已经确认完成（归档）了，不能再跑' });
    }
    const 已确认包 = new Set(((档案 && 档案.donePacks) || []).map(d => d.pack));
    if (packCode && 已确认包.has(packCode)) {
      return res.status(409).json({
        error: `「${packCode}」这个包已经确认完成了，先把它「放回待上架包」再跑`,
      });
    }

    // ===== 连续失败熔断（V1.2.106）=====
    // 阈值人在「设置」里改。**每次请求都重新读一遍** —— 改完不用重启后端、也不用重开这一批。
    // 0 = 关掉熔断。
    // 两条设置读一次就够（都在 services/appSettings.js，默认值与取值范围也只在那儿写一份）。
    const 设置 = await 读设置();
    const 阈值 = Math.max(0, Number(设置.连续失败熔断) || 0);
    // 一张卡最多跑几遍（V1.2.108）。1 = 不重试。这里再夹一次是兜底 ——
    // 库里万一躺着一个脏值（绕过 services 直接写进去的），别让它把整批拖住。
    const 每卡遍数 = Math.max(1, Math.min(5, Math.round(Number(设置.每卡最多尝试遍数) || 1)));
    // 上一趟留下的连败数 —— 只有前端明说要接着数（连败继续）才继承。
    let 连败 = 连败继续 ? Math.max(0, Number((档案 && 档案.连败) || 0)) : 0;
    let 熔断 = false;   // 这一趟是不是被熔断掐掉的（跟人手按的急停不是一回事，弹窗文案不一样）
    // 「这是一趟新的开始」要立刻落库：后面几条提前 return 的分支（没行可跑 / 包被确认掉）
    // 不经过结尾那次落库，留着旧尾数的话，这一趟的第二个包会把它当成"接着数"吃进来。
    if (!连败继续 && 档案) {
      await ListingBatch.updateOne({ batchId, userId: req.user.id }, { $set: { 连败: 0 } }).catch(() => {});
    }

    // 确保 ADB 连接 + 输入法
    sc.ensureConnected();
    sc.adb('shell settings put secure default_input_method com.android.adbkeyboard/.AdbIME');

    // ===== 起点 / 单包：把「这次要看哪些行」先圈出来 =====
    // 包名口径**必须跟前端 组包() 一字不差**（auto-listing.vue）：packCode 为空时回退到编号前缀，
    // 「QCAC-JP001」→「QCAC」。两边算得不一样的话，页面上明明是这个包，后端却挑不出任何一行。
    const 取包名 = (it) => it.packCode || String(it.code || '').split('-')[0] || '未知';
    let 范围 = queueItems;
    if (packCode) 范围 = 范围.filter(it => 取包名(it) === packCode);
    // index 是批内唯一、且删行**不重编号**，而 queueItems 已按 index 升序排过 ——
    // 所以 `index >= startIndex` 就是屏幕上「这一行及其之后」，不是「编号比它大」。
    if (startIndex !== null) 范围 = 范围.filter(it => it.index >= startIndex);

    // 已确认完成的包整包滤掉 —— 整批那枚按钮（只发 batchId）就是走到这里的。
    const 被跳过的包 = [...new Set(范围.filter(it => 已确认包.has(取包名(it))).map(取包名))];
    范围 = 范围.filter(it => !已确认包.has(取包名(it)));
    // 进度条分母跟着收窄，否则站在一个 8 行的包里点，会显示 0/57。
    // 两个参数都没传时 范围 === queueItems，totalCount 与从前完全相同。
    const totalCount = 范围.length;

    // 只执行 pending 或 failed 的 item
    const pendingItems = 范围.filter(
      item => item.itemStatus === 'pending' || item.itemStatus === 'failed'
    );

    // 一行都不剩、而且是包被确认掉造成的 —— 直说
    if (pendingItems.length === 0 && 被跳过的包.length > 0) {
      return res.status(409).json({
        error: `没剩下可跑的行 —— ${被跳过的包.join('、')} 已经确认完成了，`
          + '要跑就先把它「放回待上架包」',
      });
    }

    if (pendingItems.length === 0) {
      return res.json({
        success: true, total: totalCount,
        ok: totalCount, fail: 0, results: []
      });
    }

    // 构造完整结果
    const allResults = [];
    let abortFlag = false;

    // 整批开跑前**清一次**中止旗子（清掉上一轮遗留的那面）。
    // ⚠️ 必须在这儿清，**不能**交给 executeSteps 每张卡去清 —— 见 executor.js 的 keepAbort 那段：
    //    整批里每张卡都调一次 executeSteps、runKey 全是同一个 batchId，
    //    急停若落在「上一张跑完、下一张刚进去」之间，那一下就会把刚落下的急停清掉、吞掉。
    resetAbort(batchId);

    // WS: 批次开始
    wss.emit('execution-start', { batchId, total: pendingItems.length }, batchId);

    for (let i = 0; i < pendingItems.length; i++) {
      const item = pendingItems[i];

      // VM 选流程：A → 流程A，其余（B，以及理论上不会再出现的 C）→ 流程B。
      // 兜底留给 C 是为了老队列条目 —— 解析时标成 C 的行还在库里，别让它落到「没有流程」上。
      let flow;
      if (item.flow === 'A') flow = FLOW_A;
      else flow = FLOW_B;

      // 解析运行状态
      //
      // 判据从「拿自然语言去猜」改成「读流程自己声明的成功码」：
      // 原先写的是 `status.includes('成功99')` / `status.startsWith('报错')` —— 流程文案一改
      // （比如把「输入成功99」写成「上架成功」）就会静默误判，整批都标成失败，而且看日志都看不出来。
      // 现在流程 JSON 顶层带一个 `successCode`，那一张跑完吐出来的状态**等于**它才算成功，
      // 其余一律算失败。于是「加一条新的报错码」不用改后端，改文案也只要在同一份流程里改一处。
      // 没带 successCode 的老流程退回 '成功99'，并打一行日志提醒（别让它悄悄按旧规则跑）。
      const 成功码 = String(flow.successCode || '成功99');
      if (!flow.successCode && !已提醒过没成功码的流程.has(flow.name)) {
        已提醒过没成功码的流程.add(flow.name);
        console.warn(`[listing] 流程「${flow.name || '(无名)'}」没有 successCode，退回按「成功99」判成功 —— 建议在流程 JSON 里补上`);
      }

      // 这一张开始跑 → 库里标成 running（别人看得见「正跑着」，崩了也留得下痕迹）。
      // 重试次数清回 0：这一趟是这张卡的**新开始**，上一趟留下的「试过 1 次」不该接着算。
      await ListingQueue.updateOne(
        { batchId, index: item.index, userId: req.user.id },
        { $set: { itemStatus: 'running', errorMessage: '', 重试次数: 0 } }
      );

      // ★ 一张卡最多跑 `每卡遍数` 遍（V1.2.108，设置项见 services/appSettings.js）。
      //   一遍没跑成**不落 failed** —— 落了这一行当场就有"结论"了（前端按终态渲染、
      //   pendingItems 也不再捞它），第二遍没地方落脚。所以整张卡在出结论之前一直停在 running，
      //   「已经试过几遍」只写在 重试次数 上（崩在第二遍时全靠它才分得出来）。
      //   ⚠️ 每一遍都**重建 variables / flatSteps**：executeSteps 会把 14 项输出写回 variables，
      //      而 flattenSteps 是照着 variables 里"这一项有没有值"来决定固化坐标还是运行时解析的 ——
      //      拿上一遍的输出当这一遍的输入，第二遍的解析就跟第一遍不是一回事了。
      //   ⚠️ 急停（result.aborted）**不重试**：那是人叫停的，再试一遍是跟人对着干。
      //   ⚠️ 中间不等（用户 2026-10-04 拍板：立刻重试）—— 来回试的是同一张卡、整条流程从头跑。
      let result = { success: false, message: '', aborted: false };
      let outputVars = {};
      let execLogs = [];
      let status = '';
      let isSuccess = false;
      let 试过 = 0;   // 这一行**重试了几次**（不含第一遍）。第 1 遍 0，第 2 遍 1，依此类推。

      for (let 遍 = 1; 遍 <= 每卡遍数; 遍++) {
        试过 = 遍 - 1;

        // 从第二遍起：**开跑前**先把「重试过几次」落库。崩在这一遍上的话，光看 itemStatus
        // 只是个 running，看不出它已经试过一遍了 —— 落在前面才有痕迹。
        if (试过 > 0) {
          await ListingQueue.updateOne(
            { batchId, index: item.index, userId: req.user.id },
            { $set: { 重试次数: 试过 } }
          );
        }

        const variables = {
          '卡牌编号': item.code,
          '罕贵度': item.rarity || '',
          '价格': '',
          '数量': String(item.totalQty || 1),
          '集换价': 'true',
          '卡牌品相': item.condition || '流通品相',
          '品相备注': item.note || '9品',
          '旧罕贵度': '',
          '对应行数': '1',
          '异画': item.altLabel || '',
          '游戏版本': '游戏王',          // extract 关键字锚点
          '语种': '日',                 // extract 关键字锚点
        };

        const flatSteps = flattenSteps(flow.steps, variables);

        // WS: 单条开始 / 重试开始。带上 `遍`，前端「当前卡」那枚方框才说得出
        // 「重试中（第 N 遍）」—— 只看 itemStatus 的话第 2 遍和第 1 遍长得一模一样。
        wss.emit('item-progress', {
          batchId, index: item.index, code: item.code, rarity: item.rarity,
          step: 0, 遍,
          stepName: 遍 === 1 ? '开始执行' : ('重试中（第 ' + 遍 + ' 遍）'),
          detail: item.code + ' ' + item.rarity + ' 数量' + item.totalQty
            + (遍 === 1 ? '' : '（第 ' + 遍 + ' 遍）'),
        }, batchId);

        // 执行（捕获日志）
        execLogs = [];
        try {
          result = await executeSteps(flatSteps, (msg) => { execLogs.push(msg); }, variables, batchId, { keepAbort: true });
          outputVars = variables;  // VM executor 直接修改 variables 对象
        } catch (execErr) {
          result = { success: false, message: execErr.message, aborted: false };
          execLogs.push('❌ 异常: ' + execErr.message);
        }

        status = String(outputVars['运行状态(输出)'] || '');
        isSuccess = status === 成功码;
        // 跑成了 / 人按了急停 / 已经是最后一遍 → 出结论，别再多跑。
        // 这三条**缺一不可**：少了 aborted 会把人的急停当成"再试一遍"，
        // 少了 遍 >= 每卡遍数 会无限跑下去。
        if (isSuccess || result.aborted || 遍 >= 每卡遍数) break;
      }

      // 14 项输出参数，原样落库（从前只落 4 项，其余 10 项算完就扔，页面上「详细」点开是空的）
      const 输出 = 提取输出(outputVars);

      // 更新 ListingQueue
      if (isSuccess) {
        await ListingQueue.updateOne(
          { batchId, index: item.index, userId: req.user.id },
          // 重试次数照实留下：成了也记一笔「试了几次才成」，页面上看得出这张卡是第二遍才过的
          { $set: { itemStatus: 'success', errorMessage: '', 重试次数: 试过, ...输出 } }
        );
        // 上架价打底：只在这一行还没有价的时候拿集换价填（手改过的价不许被冲掉）
        await 给上架价打底({ batchId, index: item.index, userId: req.user.id }, 输出.outputPrice);
        // 店里已经挂出去了 → 把这一行压着的实体卡标成已上架 = **进订单凑库池**（V1.2.78；
        // 口径 V1.2.87 改正：凑库只认 listed:true，不标就凑不到这张卡）
        // 带上 batchId：撤回时照它精确收回**这一批**标的卡（V1.2.82）
        await 标记已上架({
          serialList: item.serialList, userId: req.user.id, batchId,
          位置: `VM 批次 ${batchId} 第 ${item.index} 行`,
        });
        // WS: 单条成功
        wss.emit('queue-update', {
          batchId, index: item.index, code: item.code, itemStatus: 'success', outputStatus: status,
        }, batchId);
      } else {
        // 失败：错误码 + 最后5条执行日志
        const lastLogs5 = execLogs.slice(-5).join(' | ');
        // 流程吐了状态字（没对上成功码，所以那就是它的报错码）就用它；一个字都没吐
        // （中止、或流程里压根没有设置状态的步骤）才退回执行器自己的 message。
        const errMsg = status || result.message || '执行失败';
        // 试过好几遍才红的，把这件事接在**同一行最前面** —— 行上那行红字只显示首行
        // （前端 首行() 取第一行、截 40 字），单起一行就看不见了。
        // 接在同一行而不是换行，是为了报错码也留在首行上（截断时先丢的是它，别丢「已跳过」）。
        // 没重试过（每卡遍数 = 1）就一个字不加 —— 那时候「重试 0 次仍失败」是句废话，
        // 而且首行得原样是报错码，跟从前一样。
        const 重试前缀 = 试过 > 0 ? ('重试 ' + 试过 + ' 次仍失败 · 已跳过 · ') : '';
        const fullErrMsg = (重试前缀 + errMsg) + (lastLogs5 ? '\n日志: ' + lastLogs5 : '');
        await ListingQueue.updateOne(
          { batchId, index: item.index, userId: req.user.id },
          { $set: { itemStatus: 'failed', errorMessage: fullErrMsg, 重试次数: 试过, ...输出 } }
        );
        // WS: 单条失败
        wss.emit('queue-update', {
          batchId, index: item.index, code: item.code, itemStatus: 'failed', outputStatus: errMsg,
        }, batchId);
      }

      const lastLogs = execLogs.slice(-5).join(' | ');
      const allOutputs = 摊回输出(输出);

      allResults.push({
        code: item.code, rarity: item.rarity, flow: item.flow,
        success: isSuccess,
        message: isSuccess ? status : (status || result.message || ''),
        outputJhj: 输出.outputJhj, outputLowest: 输出.outputLowest,
        outputPrice: 输出.outputPrice, outputStatus: 输出.outputStatus,
        allOutputs,
        logs: lastLogs,
      });

      // 没跑成 —— 分两种，别混在一起：
      //   · **信号中止**（`result.aborted`，用户按了「急停」）→ 整批停。这是人叫停的，
      //     后面不该再跑；当前这张下面还会落一次 failed（'手动终止'），
      //     剩下没跑到的留在 running，由 finally 放回 pending。
      //   · **真失败**（流程吐了别的状态码 / 执行器抛异常）→ **只红这一行，接着跑下一行**。
      //     用户 2026-10-04 拍板：「不要中断，标红就可以，我人工看」，所以红本身就是标记，
      //     不做失败清单；人要么点「重跑」，要么走包详情那两条人工出口。
      //   ⚠️ 原来这里是无条件 `abortFlag = true; break` —— 一张卡挂了**整批全停**，
      //      而且后面那些行连 failed 都落不下（保持 pending），事后看不出是"没跑"还是"跑过挂了"。
      //   ⚠️ 顺带记一笔：上面 pendingItems 会把 failed 也捞进来，
      //      所以失败之后再点一次「一键上架」**会自动重跑这些红的**。这是好事，
      //      但界面上要说清，否则人会以为它卡在那儿反复重试。
      //   · **连续失败熔断**（V1.2.106）→ 也停，但停的原因是"连着好几张都没跑成"，
      //     这是自动的，所以还要弹窗告诉人。它跟上面两条**不冲突**：单张失败照旧
      //     只红这一行接着跑，「连着」红到阈值才停 —— 这正是用户 2026-10-04 要的
      //     「单张失败不中断，连续 5 张才熔断」。
      //   ⚠️ 跟「每卡最多尝试遍数」（V1.2.108）的关系：走到这儿的已经是**这张卡的最后一遍**了
      //      （重试都在上面那个内层循环里耗完了），所以此处 连败 只 +1 —— **按卡算，不按遍算**。
      //      用户 2026-10-04 拍板就是这个口径：一张卡试 2 遍都挂算 1 次，阈值 5 仍然是"5 张卡"。
      //      按遍算的话阈值 5 会缩成 2.5 张，人会以为程序数错了。
      if (!isSuccess) {
        if (result.aborted) { abortFlag = true; break }
        连败++;
        if (阈值 > 0 && 连败 >= 阈值) { 熔断 = true; abortFlag = true; break }
        continue
      }
      // 任意一张跑成 → 连着数归零。放在这儿（成功那一支的末尾）而不是循环开头，
      // 是因为「连着」指的是**结果**的连续，不是「走了几行」。
      连败 = 0;
    }

    const okCount = allResults.filter(r => r.success).length;
    const failCount = allResults.filter(r => !r.success).length;
    // totalCount 在上面圈范围时就定了（没带起点/包 = 整批行数）

    // 归档不在这儿做了 —— 这里原先那句 `okCount === totalCount` 是拿「本次执行成功的张数」
    // 跟「整批张数」比，口径不同；只要失败过一次就永远凑不齐，门永远开不了。
    // 现在归档只有一个入口：人在页面上点「确认完成」（POST /listings/batches/:batchId/complete）。
    // 跑完这里只回状态、发 WS。

    // 连败数落库 —— 下一次请求（同一个批次的下一个包）要接着数。
    // 档案不存在就落不下去（正常批次一定在）；这种情况计数退化成"每包归零"，
    // 不是"数错了"，别为此把整次执行弄挂。
    if (档案) {
      await ListingBatch.updateOne({ batchId, userId: req.user.id }, { $set: { 连败 } }).catch(() => {});
    }

    // WS: 批次结束
    wss.emit('execution-end', {
      batchId, success: okCount, failed: failCount, aborted: abortFlag,
      // 熔断与急停都走 aborted（都是"这一趟停了"），靠这两个字段区分是谁停的
      ...(熔断 ? { 熔断: true, 连败, 阈值 } : {}),
    }, batchId);

    res.json({
      success: okCount === totalCount,
      total: totalCount, ok: okCount, fail: failCount,
      aborted: abortFlag,
      // 熔断掐的，把「连着几张」「阈值多少」一并报回去 —— 弹窗要照着说人话
      ...(熔断 ? { 熔断: true, 连败, 阈值 } : {}),
      results: allResults,
    });
  } catch (e) {
    console.error('VM Auto-execute error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    // 跑完（或中途炸了）把这个批次里还没拿到结论的行放回 pending。
    // 不这么做的话它会永远停在 running，下次进来就被上面那道「僵尸行」检查挡在门外，谁也跑不了。
    await ListingQueue.updateMany(
      { batchId, userId: req.user.id, itemStatus: 'running' },
      { $set: { itemStatus: 'pending', errorMessage: '执行中断，没有拿到结果，可以重跑' } }
    ).catch(() => {});
    listingLock.release(batchId);
  }
});

module.exports = router;
