/**
 * 一键上架批量执行 — 支持断点续跑 + ListingQueue 状态同步
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const auth = require('../../middleware/auth');
// 急停**不从这里发**（终止端点在 routes/listing-agent/index.js 的终止接口），
// 这里只负责开跑前把上一轮遗留的旗子清掉 —— 见下面 `resetAbort(batchId)`。
const { executeSteps, resetAbort } = require('../listing-agent/executor');
const ListingQueue = require('../../models/ListingQueue');
const ListingBatch = require('../../models/ListingBatch');
const listingLock = require('../../services/listingRunLock');
const { 提取: 提取输出, 给上架价打底 } = require('../../services/listingOutputs');
const { 标记已上架 } = require('../../services/listingMarkListed');
// WS 实时同步: 一键上架进度广播给各端 (主机面板/手机/网页)
// PC 版原先一条都不发 —— 手机端切到「屏幕点击」模式时整趟跑完屏幕上一个字都不动，
// 只有最后那个弹窗。现在跟 VM 版同一个事件契约（四个事件、同名同形）。
const wss = require('../../ws');

// 加载流程配置
const FLOW_A = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/listing-flows/流程A-新建.json'), 'utf-8'));
const FLOW_B = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/listing-flows/流程B-更新.json'), 'utf-8'));
const FLOW_C = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/listing-flows/流程C-更新.json'), 'utf-8'));

/** 根据流程配置 + 变量构建步骤数组 */
function buildSteps(flow, variables) {
  const steps = [];
  const stepMap = {};
  let stepNum = 0;

  for (const s of flow.steps) {
    stepNum++;
    stepMap[stepNum] = steps.length + 1;
    const t = s.stepType, d = s.stepDuration || 0.5;

    if (s.stepVariable) {
      const varName = s.stepVariable.replace(/[{}]/g, '');
      if (['click', 'dblclick', 'tplclick'].includes(t)) {
        steps.push({
          type: '_dynamic_click',
          _varName: varName,
          _actions: s.actions,
          _clickType: t,
          duration: d,
          description: s.desc
        });
      } else if (t === 'input') {
        for (const a of s.actions) {
          steps.push({ type: 'input', text: a.text || '', x: a.x || 0, y: a.y || 0, duration: d, description: s.desc });
        }
      } else if (t === 'ocr-find-row') {
        const act = s.actions[0];
        steps.push({
          type: 'ocr-find-row',
          x1: act.x1, y1: act.y1, x2: act.x2, y2: act.y2,
          ocrPrompt: act.ocrPrompt || '',
          variable: '对应行数',
          duration: d,
          description: s.desc
        });
      }
    } else if (t === 'compare') {
      steps.push({ type: 'compare', compareVar: s.compareVar, compareRightVar: s.compareRightVar || '', compareOp: s.compareOp, compareValue: s.compareValue, trueJump: s.trueJump, falseJump: s.falseJump, duration: d, description: s.desc });
    } else if (t === 'jump') {
      steps.push({ type: 'jump', jumpTo: s.jumpTo, duration: d, description: s.desc });
    } else if (t === 'setvar') {
      const lv = (s.leftVar || '').replace(/[{}]/g, '');
      steps.push({ type: 'setvar', leftVar: lv, rightVar: (s.rightVar || '').replace(/[{}]/g, ''), template: s.template || '', duration: d, description: s.desc });
    } else {
      for (const a of s.actions) {
        const ss = { duration: d, description: s.desc };
        if (t === 'tplclick') { ss.type = 'tplclick'; ss.x = a.x; ss.y = a.y; }
        else if (t === 'click') { ss.type = 'click'; ss.x = a.x; ss.y = a.y; }
        else if (t === 'press') { ss.type = 'press'; ss.text = a.text || a.key || ''; }
        else if (t === 'input') {
          ss.type = 'input'; ss.text = a.text || ''; ss.x = a.x || 0; ss.y = a.y || 0;
        }
        else if (t === 'wait') ss.type = 'wait';
        else if (t === 'scroll') { ss.type = 'scroll'; ss.scroll_clicks = a.scroll_clicks || -500; }
        else continue;
        steps.push(ss);
      }
    }
  }

  // 修正跳转目标
  for (const step of steps) {
    if (step.type === 'compare') {
      if (step.trueJump && stepMap[step.trueJump]) step.trueJump = stepMap[step.trueJump];
      if (step.falseJump && stepMap[step.falseJump]) step.falseJump = stepMap[step.falseJump];
    }
    if (step.type === 'jump' && step.jumpTo && stepMap[step.jumpTo]) step.jumpTo = stepMap[step.jumpTo];
  }
  return steps;
}

// POST /v1/api/listings/auto-execute — 一键上架（支持断点续跑）
router.post('/', auth, async (req, res) => {
  const batchId = (req.body && req.body.batchId) || '';
  if (!batchId) {
    return res.status(400).json({ error: 'batchId is required' });
  }
  // 起点 / 单包，可选。两个都不传 = 整批（跟从前一样）。
  const packCode = (req.body && req.body.packCode) || '';
  const rawStart = req.body ? req.body.startIndex : null;
  const startIndex = (rawStart === null || rawStart === undefined || rawStart === '')
    ? null : Number(rawStart);
  if (startIndex !== null && !Number.isFinite(startIndex)) {
    return res.status(400).json({ error: 'startIndex must be a number' });
  }

  // ===== 执行互斥，两道（和 VM 版逐字一样，双保险：PC 版和 VM 版抢的是同一批） =====
  if (!listingLock.acquire(batchId)) {
    return res.status(409).json({ error: '这一批正在执行中，请勿重复点击' });
  }
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
    // 从 ListingQueue 加载待执行队列
    const queueItems = await ListingQueue.find({
      batchId,
      userId: req.user.id,
    }).sort({ index: 1 }).lean();

    if (queueItems.length === 0) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    // ===== 档案：归档过的不许再跑，已确认的包整包不跑（V1.2.76）=====
    // 包级只读原先只挡在**行级接口**上（queues.js 的 取条目），而真正批量改行的是这里 ——
    // 这条路不走 取条目，于是整批那枚「一键上架」照样会把「已确认包」里跑红的行重新拉起来跑。
    // 跑崩了 finally 会把 running 打回 pending，那个包就成了「已确认、却有一行没跑完」：
    // 被 包们 滤出待上架屏、又进不了归档判据，只剩「放回」一条路自救 ——
    // 正是 V1.2.75 想堵掉的软死锁。守卫必须跟 取条目 同口径地补齐（VM 版逐字一样）。
    const 档案 = await ListingBatch.findOne({ batchId, userId: req.user.id })
      .select('state donePacks').lean();
    if (档案 && 档案.state === 'listed') {
      return res.status(409).json({ error: '这一批已经确认完成（归档）了，不能再跑' });
    }
    const 已确认包 = new Set(((档案 && 档案.donePacks) || []).map(d => d.pack));
    if (packCode && 已确认包.has(packCode)) {
      return res.status(409).json({
        error: `「${packCode}」这个包已经确认完成了，先把它「放回待上架包」再跑`,
      });
    }

    // ===== 起点 / 单包：先圈「这次要看哪些行」=====
    // 包名口径跟前端 组包() 一字不差：packCode 为空时回退到编号前缀。
    const 取包名 = (it) => it.packCode || String(it.code || '').split('-')[0] || '未知';
    let 范围 = queueItems;
    if (packCode) 范围 = 范围.filter(it => 取包名(it) === packCode);
    // index 批内唯一、删行不重编号，queueItems 又已按 index 升序 —— `>=` 就是「这行及其之后」。
    if (startIndex !== null) 范围 = 范围.filter(it => it.index >= startIndex);

    // 已确认完成的包整包滤掉 —— 整批那枚按钮（只发 batchId）就是走到这里的。
    // 放在圈范围**之后**：上面那句 packCode 的 409 已经先把话说清楚了。
    const 被跳过的包 = [...new Set(范围.filter(it => 已确认包.has(取包名(it))).map(取包名))];
    范围 = 范围.filter(it => !已确认包.has(取包名(it)));
    const totalCount = 范围.length;

    // 只执行 pending 或 failed 的 item（跳过已 success 的）
    const pendingItems = 范围.filter(
      item => item.itemStatus === 'pending' || item.itemStatus === 'failed'
    );

    // 一行都不剩、而且是因为包被确认掉的 —— 直说，别回一句「已跳过」让人以为跑完了
    if (pendingItems.length === 0 && 被跳过的包.length > 0) {
      return res.status(409).json({
        error: `没剩下可跑的行 —— ${被跳过的包.join('、')} 已经确认完成了，`
          + '要跑就先把它「放回待上架包」',
      });
    }

    if (pendingItems.length === 0) {
      return res.json({
        success: true,
        total: totalCount,
        ok: totalCount,
        fail: 0,
        results: 范围.map(item => ({
          code: item.code, rarity: item.rarity,
          flow: item.flow, success: true, message: '已跳过（之前已完成）',
          skipped: true,
        })),
      });
    }

    // 按罕贵度排序
    //
    // 注意：这里是**既有行为**，本次没动 —— PC 版历来是「一批内按罕贵度从小到大」跑，
    // 不是照着屏幕上的行序跑。所以 PC 版点了起点之后，「从这行往下」指的是
    // **筛选出这批行**（index >= 起点的那一段），跑起来仍按罕贵度排。
    // 排序必须放在圈范围**之后** —— 先排再筛，筛出来的还是同一集合，但读起来容易误以为
    // 起点的「往下」是集合内的位置，其实它比的是 index。
    const rarityOrder = ['N', 'NR', 'R', 'SR', 'UR', 'UTR', 'SER', 'QCSER', 'PSER', '20SER', 'HR', 'CR', 'PR'];
    const rRank = r => { const i = rarityOrder.indexOf(r); return i >= 0 ? i : 99; };
    pendingItems.sort((a, b) => rRank(a.rarity) - rRank(b.rarity) || a.code.localeCompare(b.code));

    // 构造完整结果（包含已跳过的 item）
    const allResults = [];
    const successItems = 范围.filter(item => item.itemStatus === 'success');
    for (const item of successItems) {
      allResults.push({
        code: item.code, rarity: item.rarity, flow: item.flow,
        success: true, message: '', skipped: true,
      });
    }

    let oldRarity = '';
    let abortFlag = false;

    // 整批开跑前清一次中止旗子。理由跟 VM 版一字不差，见 routes/listing-agent/executor.js 的 keepAbort 那段。
    resetAbort(batchId);

    // WS: 批次开始
    wss.emit('execution-start', { batchId, total: pendingItems.length }, batchId);

    for (let i = 0; i < pendingItems.length; i++) {
      const item = pendingItems[i];
      let flow, flowName;

      if (item.flow === 'A') { flow = FLOW_A; flowName = 'A'; }
      else if (item.flow === 'B') { flow = FLOW_B; flowName = 'B'; }
      else if (item.flow === 'C') { flow = FLOW_C; flowName = 'C'; }
      else { flow = FLOW_A; flowName = 'A'; }

      const variables = {
        '卡牌编号': item.code,
        '罕贵度': item.rarity || '',
        '价格': '',
        '数量': String(item.totalQty || 1),
        '集换价': 'true',
        '卡牌品相': item.condition || '流通品相',
        '品相备注': item.note || '9品',
        '旧罕贵度': oldRarity,
        '对应行数': '1',
        '异画': item.altLabel || '',
      };

      // 这一张开始跑 → 库里标成 running（和 VM 版同一个口径）
      await ListingQueue.updateOne(
        { batchId, index: item.index, userId: req.user.id },
        { $set: { itemStatus: 'running', errorMessage: '' } }
      );

      // WS: 单条开始
      wss.emit('item-progress', {
        batchId, index: item.index, code: item.code, rarity: item.rarity,
        step: 0, stepName: '开始执行', detail: item.code + ' ' + item.rarity + ' 数量' + item.totalQty,
      }, batchId);

      const steps = buildSteps(flow, variables);
      const logs = [];
      let result;
      try {
        result = await executeSteps(steps, (msg) => { logs.push(msg) }, variables, batchId, { keepAbort: true });
      } catch (execErr) {
        result = { success: false, message: execErr.message, aborted: false };
      }

      // 更新 ListingQueue 状态
      // 输出参数只写**这次真的取到的**：PC 那几份流程配置（config/listing-flows/*.json）里
      // 一个「(输出)」变量都没有，提取出来必是 14 个空串。要是照写不误，用 PC 重跑一遍
      // 就会把上一次 VM 跑出来的 14 项**冲成空白** —— 那不是「落库」，是把已有的记录抹了。
      const 输出 = 提取输出(variables);
      const 非空输出 = Object.fromEntries(Object.entries(输出).filter(([, v]) => v !== ''));

      if (result.success) {
        await ListingQueue.updateOne(
          { batchId, index: item.index, userId: req.user.id },
          { $set: { itemStatus: 'success', errorMessage: '', ...非空输出 } }
        );
        if (非空输出.outputJhj) {
          await 给上架价打底({ batchId, index: item.index, userId: req.user.id }, 非空输出.outputJhj);
        }
        // 店里已经挂出去了 → 把这一行压着的实体卡标成已上架 = **进订单凑库池**（V1.2.78；
        // 口径 V1.2.87 改正：凑库只认 listed:true，不标就凑不到这张卡）
        // 带上 batchId：撤回时照它精确收回**这一批**标的卡（V1.2.82）
        await 标记已上架({
          serialList: item.serialList, userId: req.user.id, batchId,
          位置: `PC 批次 ${batchId} 第 ${item.index} 行`,
        });
        oldRarity = item.rarity;
        // WS: 单条成功（PC 流程没有「运行状态(输出)」这类变量，outputStatus 只能是空）
        wss.emit('queue-update', {
          batchId, index: item.index, code: item.code, itemStatus: 'success', outputStatus: '',
        }, batchId);
      } else {
        await ListingQueue.updateOne(
          { batchId, index: item.index, userId: req.user.id },
          { $set: { itemStatus: 'failed', errorMessage: result.message || '执行失败', ...非空输出 } }
        );
        // WS: 单条失败
        wss.emit('queue-update', {
          batchId, index: item.index, code: item.code, itemStatus: 'failed',
          outputStatus: result.message || '执行失败',
        }, batchId);
      }

      allResults.push({
        code: item.code, rarity: item.rarity, flow: flowName,
        success: result.success,
        message: result.message || '',
        aborted: result.aborted || false,
        allOutputs: 输出,
        logs: logs.slice(-3),
      });

      // 没跑成 —— 分两种，跟 VM 版（auto-execute-vm.js）一个口径：
      //   · **信号中止**（`result.aborted`，用户按了急停）→ 整批停。
      //   · **真失败** → 只红这一行，接着跑下一行（用户 2026-10-04 拍板「不要中断，标红就可以」）。
      //   ⚠️ 原来这两件事被 `!result.success || result.aborted` 合成了一条，一张卡挂了整批全停。
      if (result.aborted) { abortFlag = true; break }
    }

    // 按 index 排序结果
    allResults.sort((a, b) => {
      const ai = queueItems.find(q => q.code === a.code && q.flow === a.flow)?.index || 0;
      const bi = queueItems.find(q => q.code === b.code && q.flow === b.flow)?.index || 0;
      return ai - bi;
    });

    const okCount = allResults.filter(r => r.success).length;
    const failCount = allResults.filter(r => !r.success).length;
    // totalCount 在上面圈范围时已定（没带起点/包 = 整批行数）

    // 归档不在这儿做了 —— 这里原先那句 `okCount === totalCount` 是拿「本次执行成功的张数」
    // 跟「整批张数」比，口径不同；只要失败过一次就永远凑不齐，门永远开不了。
    // 现在归档只有一个入口：人在页面上点「确认完成」（POST /listings/batches/:batchId/complete）。
    // 跑完这里只回状态。

    // WS: 批次结束
    wss.emit('execution-end', {
      batchId, success: okCount, failed: failCount, aborted: abortFlag,
    }, batchId);

    res.json({
      success: okCount === totalCount,
      total: totalCount,
      ok: okCount,
      fail: failCount,
      aborted: abortFlag,
      results: allResults,
    });
  } catch (e) {
    console.error('Auto-execute error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    // 同 VM 版：把没拿到结论的行放回 pending，别让它永远卡在 running
    await ListingQueue.updateMany(
      { batchId, userId: req.user.id, itemStatus: 'running' },
      { $set: { itemStatus: 'pending', errorMessage: '执行中断，没有拿到结果，可以重跑' } }
    ).catch(() => {});
    listingLock.release(batchId);
  }
});

module.exports = router;
