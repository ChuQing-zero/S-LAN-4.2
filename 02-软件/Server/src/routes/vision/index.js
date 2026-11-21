const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const Card = require('../../models/Card');
const ApiKey = require('../../models/ApiKey');
const CardCatalog = require('../../models/CardCatalog');
const MissingCode = require('../../models/MissingCode');
const VisionUsageLog = require('../../models/VisionUsageLog');
const { recognizeImage } = require('../../services/ocrService');
const { extractCardCodes } = require('../../services/llmService');
const { getBalance } = require('../../services/billingService');
const { callArkVision } = require('../../services/arkVisionService');
const recogPrompt = require('../../services/recognitionPrompt');

// ── 工具函数 ──
const round = (n) => Math.round(n * 10000) / 10000;

/** 掩码 apiKey：前4 + **** + 后4 */
const maskKey = (k) => {
  if (!k) return '';
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '****' + k.slice(-4);
};

// ── 卡牌编号正则 ──
// 匹配卡牌编号（不要求前缀边界，OCR 粘连也能提取）
// 核心特征: XXXX-XXNNN —— 中划线 + 字母段 + 数字段
// 示例: QCAC-JP059, 55SAST-CN071(粘连), RC03-JP039, LOB-EN124
const CARD_CODE_REGEX = /[A-Z0-9]{2,5}-[A-Z]{2,3}\d{2,5}\b/gi;

/**
 * 正则提取卡牌编号（零成本，无需 LLM）
 * @param {string} text - OCR 识别文字
 * @returns {string[]}
 */
function regexExtractCodes(text) {
  const matches = text.match(CARD_CODE_REGEX) || [];
  return [...new Set(matches.map((m) => m.trim().toUpperCase()))];
}

// POST /v1/api/vision/recognize - 拍照识别卡牌
router.post('/recognize', auth, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'image is required' });
    }

    const { versionId, libraryCode } = req.body;
    const imageBuffer = req.file.buffer;

    // ═══ 步骤1：OCR 识别 ═══
    let ocrTextList = [];
    let ocrAllText = '';
    let ocrError = null;

    try {
      const ocrResult = await recognizeImage(imageBuffer);
      ocrTextList = ocrResult.textList;
      ocrAllText = ocrResult.allText;
    } catch (err) {
      ocrError = err.message;
      console.error('[Vision] OCR failed:', ocrError);
    }

    // ═══ 步骤2：提取卡牌编号（正则优先 + LLM 兜底）═══
    let cardCodeList = [];
    let extractionMethod = 'none';
    let llmError = null;

    if (ocrAllText && !ocrError) {
      // 2a. 先用正则提取（零成本）
      cardCodeList = regexExtractCodes(ocrAllText);

      if (cardCodeList.length > 0) {
        extractionMethod = 'regex';
        console.log(`[Vision] 正则提取成功: ${cardCodeList.length} 个编号`);
      } else {
        // 2b. 正则没匹配到，兜底调 LLM
        console.log('[Vision] 正则未匹配，兜底调用 LLM...');
        try {
          cardCodeList = await extractCardCodes(ocrAllText);
          extractionMethod = 'llm';
          console.log(`[Vision] LLM 提取: ${cardCodeList.length} 个编号`);
        } catch (err) {
          llmError = err.message;
          console.error('[Vision] LLM fallback failed:', llmError);
        }
      }
    }

    // ═══ 步骤3：数据库匹配 ═══
    let matchedCards = [];
    if (cardCodeList.length > 0) {
      const query = { code: { $in: cardCodeList } };
      if (libraryCode) query.libraryCode = libraryCode;
      matchedCards = await Card.find(query).lean();
    }

    // ═══ 成本明细 ═══
    const OCR_UNIT_COST = 0.015;                          // OCR ¥0.015/次
    const LLM_INPUT_COST_PER_1K = 0.0008;                  // 豆包1.6 ¥0.80/百万tokens = ¥0.0008/1K tokens
    const LLM_OUTPUT_COST_PER_1K = 0.008;                  // 豆包1.6 ¥8.00/百万tokens = ¥0.008/1K tokens

    // Token 估算（中文 ~1.5 字/token，英文 ~4 字符/token）
    const estimatedInputTokens = extractionMethod === 'llm'
      ? Math.ceil(ocrAllText.length / 1.5) + 80   // OCR 文字 + system prompt
      : 0;
    const estimatedOutputTokens = extractionMethod === 'llm'
      ? Math.max(cardCodeList.length * 5, 10)     // 每个编号 ~5 tokens + 开销
      : 0;

    const ocrCost = ocrError ? 0 : OCR_UNIT_COST;
    const llmInputCost = extractionMethod === 'llm'
      ? (estimatedInputTokens / 1000) * LLM_INPUT_COST_PER_1K
      : 0;
    const llmOutputCost = extractionMethod === 'llm'
      ? (estimatedOutputTokens / 1000) * LLM_OUTPUT_COST_PER_1K
      : 0;
    const llmTotalCost = llmInputCost + llmOutputCost;
    const totalCost = ocrCost + llmTotalCost;

    const cost = {
      currency: 'CNY',
      ocr: {
        called: !ocrError,
        unit_price: OCR_UNIT_COST,
        cost: round(ocrCost),
      },
      llm: {
        called: extractionMethod === 'llm',
        model: 'doubao-seed-2-0-mini-260428',
        estimated_input_tokens: estimatedInputTokens,
        estimated_output_tokens: estimatedOutputTokens,
        input_cost: round(llmInputCost),
        output_cost: round(llmOutputCost),
        total_cost: round(llmTotalCost),
      },
      extraction_algorithm: extractionMethod === 'regex'
        ? '正则匹配 (0成本)'
        : extractionMethod === 'llm'
          ? 'LLM 兜底 (正则未匹配到)'
          : '未提取',
      saved_vs_pure_llm: extractionMethod === 'regex'
        ? round(0.0002 - 0)  // 省掉了 LLM 费用
        : 0,
      total: round(totalCost),
      total_yuan: round(totalCost),
    };

    // 是否在 1 分钱以内
    const underOneCent = totalCost <= 0.01;

    // ═══ 响应 ═══
    res.json({
      ocr_text_list: ocrTextList,
      ocr_all_text: ocrAllText,
      card_code_list: cardCodeList,
      matched_cards: matchedCards,
      extraction_method: extractionMethod,
      cost,
      under_one_cent: underOneCent,
      errors: { ocr: ocrError, llm: llmError },
      summary: ocrError
        ? 'OCR 识别失败'
        : cardCodeList.length === 0
          ? `OCR 识别到 ${ocrTextList.length} 段文字，未提取到卡牌编号`
          : `识别到 ${cardCodeList.length} 张卡牌，${extractionMethod === 'regex' ? '正则提取(0成本)' : 'LLM兜底'} | ¥${round(totalCost)} | ${underOneCent ? '✅ 1分内' : '⚠️ 超1分'}`,
    });
  } catch (error) {
    console.error('[Vision] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /v1/api/vision/balance - 查询火山引擎账户余额
router.get('/balance', auth, async (req, res) => {
  try {
    const result = await getBalance();
    res.json(result);
  } catch (error) {
    console.error('Balance query error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /v1/api/vision/keys - 当前可用钥匙列表（普通账号可见，掩码；识别页选择用哪把钥匙）
router.get('/keys', auth, async (req, res) => {
  try {
    const keys = await ApiKey.find({ enabled: true }).sort({ isDefault: -1, createdAt: 1 }).lean();
    res.json({
      list: keys.map((k) => ({
        id: k._id,
        name: k.name || '未命名',
        maskedKey: maskKey(k.apiKey),
        model: k.model,
        isDefault: !!k.isDefault,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /v1/api/vision/doubao-recognize - 豆包视觉识别代理（base64 dataURL，走后端管理的钥匙）
// body: { image, versionId, versionName, versionLang, promptId?, rarity?, source, keyId? }
//
// 提示词**由后端按当前生效方案拼**（客户端不再传 prompt）—— 这样「提示词方案」页上
// 显示的那段必然就是实际发出去的那段，不可能对不上。
// promptId 用于批量识别锁定：整批强制用同一套，不受中途切换影响。
router.post('/doubao-recognize', auth, async (req, res) => {
  const started = Date.now();
  let plan = null;
  try {
    const { image, versionId, versionName, versionLang, promptId, rarity, source, keyId } = req.body || {};
    if (!image) return res.status(400).json({ error: 'image is required' });

    plan = recogPrompt.getActivePrompt({ versionId, versionName, versionLang, promptId });

    const query = keyId ? { _id: keyId, enabled: true } : { isDefault: true, enabled: true };
    const key = await ApiKey.findOne(query).lean();
    if (!key) return res.status(400).json({ error: '未配置可用的豆包钥匙，请到后台管理添加' });

    const result = await callArkVision({
      apiKey: key.apiKey,
      apiUrl: key.apiUrl,
      model: key.model,
      imageDataUrl: image,
      prompt: plan.text,
    });

    const cardCode = String(result.text || '').replace(/[\n\r]/g, '');
    // 判定规则跟客户端 upload.vue / batch-recognize.vue **一字不差**，
    // 否则统计出来的成功率会跟你在屏幕上看到的对不上。
    const recognized = !!cardCode
      && /^[A-Za-z0-9]+-[A-Za-z0-9]+(-[A-Za-z0-9]+)?$/.test(cardCode)
      && cardCode !== 'FAIL';

    // 认出来了 → 顺手比一次目录。查不到就是"成功返回但目录没有"：
    // 记进缺失清单（同一编号只留一行），并标 catalogHit=false。
    let catalogHit = false;
    let matchedBy = '';   // faceCode=靠卡面编号命中 / code=靠目录号命中 / suspect=可疑
    if (recognized) {
      const code = cardCode.trim().toUpperCase();
      try {
        // DL1~DL5 的卡面号跟目录号整体错一位（卡面 DL1-000 ↔ 目录 DL1-01）。
        // AI 读的是**卡面**，所以先拿 faceCode 查；查不到再退回 code 查。
        //
        // 必须 faceCode 优先、不能写成 $or 一起查：DL1-100 既是一张卡的目录号，
        // 又是另一张卡的卡面号，两边一起查会同时命中两条、结果不确定。
        let hit = await CardCatalog
          .findOne({ faceCode: code })
          .select('_id code faceCode')
          .lean();
        if (hit) {
          matchedBy = 'faceCode';
        } else {
          hit = await CardCatalog
            .findOne({ code })
            .select('_id code faceCode')
            .lean();
          if (hit) {
            // 这个包有卡面编号、却只在目录号上命中 → 很可能是 AI 少读了前导零
            // （卡面 DL1-099 被读成 DL1-99，会落到另一张卡上）。标出来，别让它悄悄过去。
            matchedBy = hit.faceCode ? 'suspect' : 'code';
            if (hit.faceCode) {
              console.warn(`[Vision] 编号可疑: AI 报 "${code}"，只在目录号命中(${hit.code})，` +
                `该卡卡面号应为 "${hit.faceCode}" —— 可能少读了前导零`);
            }
          }
        }
        catalogHit = !!hit;
        if (!hit) {
          const upd = {
            $setOnInsert: { firstSeenAt: new Date(), codePrefix: code.split('-')[0] || '' },
            $set: {
              lastSeenAt: new Date(),
              versionId: versionId == null ? null : Number(versionId),
              versionName: versionName || '',
            },
            $inc: { seenCount: 1 },
          };
          if (rarity) upd.$set.rarity = String(rarity);
          await MissingCode.updateOne({ code }, upd, { upsert: true });
        }
      } catch (e) {
        // 目录比对/登记失败不影响识别本身
        console.warn('[Vision][doubao-recognize] 目录比对失败:', e.message);
      }
    }

    const costYuan = round((result.totalTokens / 1000) * (key.unitPricePerK || 0));

    await VisionUsageLog.create({
      keyId: key._id,
      keyName: key.name,
      ownerId: req.user.id,
      tokens: result.totalTokens,
      costYuan,
      // test 也要留着：后台「测试」调用不该算进用量统计和方案成功率对比
      source: source === 'batch' ? 'batch' : source === 'test' ? 'test' : 'single',
      ok: true,
      latencyMs: result.latencyMs,
      promptKey: plan.promptKey,
      recognized,
      catalogHit,
      codeMatchedBy: matchedBy,
    });

    res.json({
      cardCode,
      recognized,
      catalogHit,
      matchedBy,
      promptKey: plan.promptKey,
      promptName: plan.name,
      tokens: result.totalTokens,
      costYuan,
      latencyMs: result.latencyMs,
      keyId: key._id,
      keyName: key.name,
    });
  } catch (error) {
    const detail = error.response?.data
      ? JSON.stringify(error.response.data).slice(0, 400)
      : (error.message || error);
    console.error('[Vision][doubao-recognize] Error:', detail);
    // 失败也记一条（ok=false），便于排查钥匙问题
    try {
      await VisionUsageLog.create({
        keyId: null,
        keyName: '',
        ownerId: req.user.id,
        tokens: 0,
        costYuan: 0,
        source: ['batch', 'test'].includes((req.body || {}).source) ? (req.body || {}).source : 'single',
        ok: false,
        latencyMs: Date.now() - started,
        error: String(detail).slice(0, 300),
        promptKey: plan ? plan.promptKey : '',
        recognized: false,
      });
    } catch (_) { /* 日志失败不影响主流程 */ }
    res.status(500).json({ error: detail || '豆包识别失败' });
  }
});

// ══════════════ 提示词方案 ══════════════

// GET /v1/api/vision/prompt?versionId=1&versionName=游戏王日文&versionLang=日文
// 返回「当前生效的方案 + 这个版本的全部方案」（原文已把 {lang} 换成实际语种码）
router.get('/prompt', auth, async (req, res) => {
  try {
    const { versionId, versionName, versionLang } = req.query;
    const view = recogPrompt.getGroupView({ versionId, versionName, versionLang });
    const cur = recogPrompt.getActivePrompt({ versionId, versionName, versionLang });
    res.json({ ...view, active: { promptKey: cur.promptKey, promptId: cur.promptId, name: cur.name, text: cur.text, fallback: cur.fallback } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /v1/api/vision/prompt/active  { versionId, versionName, promptId }
router.put('/prompt/active', auth, async (req, res) => {
  try {
    const { versionId, versionName, promptId } = req.body || {};
    if (!promptId) return res.status(400).json({ error: '需要 promptId' });
    const r = recogPrompt.setActive(versionId, promptId, versionName);
    if (!r.ok) return res.status(400).json({ error: r.error });
    console.log(`[提示词] 版本 ${r.versionKey} 当前启用 → ${r.activeId}（${r.name}）`);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/vision/prompt/stats?versionId=1&days=7
// 各方案的成功率对比。只统计有 promptKey 的新记录，改造前的旧记录不算。
router.get('/prompt/stats', auth, async (req, res) => {
  try {
    const { versionId, versionName, days } = req.query;
    // 版本 key 可能不是 versionId（比如按名字兜底命中），统一从视图里取
    const view = recogPrompt.getGroupView({ versionId, versionName });
    const vk = view.versionKey || String(versionId == null ? '' : versionId);
    const since = new Date(Date.now() - (parseInt(days, 10) || 7) * 86400000);

    const rows = await VisionUsageLog.aggregate([
      { $match: { promptKey: { $regex: '^' + vk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':' }, createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$promptKey',
          calls: { $sum: 1 },
          recognized: { $sum: { $cond: ['$recognized', 1, 0] } },
          catalogHit: { $sum: { $cond: ['$catalogHit', 1, 0] } },
          costYuan: { $sum: '$costYuan' },
        },
      },
      { $sort: { calls: -1 } },
    ]);

    const nameOf = {};
    (view.list || []).forEach((p) => { nameOf[vk + ':' + p.id] = p.name; });

    res.json({
      versionKey: vk,
      days: parseInt(days, 10) || 7,
      list: rows.map((r) => {
        const id = r._id.slice(vk.length + 1);
        return {
          promptKey: r._id,
          promptId: id,
          name: nameOf[r._id] || id,
          calls: r.calls,
          recognized: r.recognized,
          recognizedRate: r.calls ? Math.round((r.recognized / r.calls) * 1000) / 10 : 0,
          catalogHit: r.catalogHit,
          catalogHitRate: r.calls ? Math.round((r.catalogHit / r.calls) * 1000) / 10 : 0,
          costYuan: round(r.costYuan),
        };
      }),
      empty: rows.length === 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/vision/usage - 当前用户豆包用量 + 当前默认钥匙（识别页 API 栏显示）
router.get('/usage', auth, async (req, res) => {
  try {
    const [myAgg, defKey] = await Promise.all([
      VisionUsageLog.aggregate([
        { $match: { ownerId: req.user.id, source: { $ne: 'test' } } },
        {
          $group: {
            _id: null,
            tokens: { $sum: '$tokens' },
            calls: { $sum: 1 },
            costYuan: { $sum: '$costYuan' },
          },
        },
      ]),
      ApiKey.findOne({ isDefault: true, enabled: true }).lean(),
    ]);

    const bySourceAgg = await VisionUsageLog.aggregate([
      { $match: { ownerId: req.user.id } },
      { $group: { _id: '$source', tokens: { $sum: '$tokens' }, calls: { $sum: 1 }, costYuan: { $sum: '$costYuan' } } },
    ]);

    const totals = myAgg[0] || { tokens: 0, calls: 0, costYuan: 0 };
    res.json({
      key: defKey
        ? { id: defKey._id, name: defKey.name || '未命名', model: defKey.model, maskedKey: maskKey(defKey.apiKey) }
        : null,
      totals: { tokens: totals.tokens, calls: totals.calls, costYuan: round(totals.costYuan) },
      bySource: Object.fromEntries(
        bySourceAgg.map((b) => [b._id, { tokens: b.tokens, calls: b.calls, costYuan: round(b.costYuan) }])
      ),
    });
  } catch (error) {
    console.error('Vision usage query error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
