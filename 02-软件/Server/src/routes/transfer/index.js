const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const Card = require('../../models/Card');
const { nextSerialNum, makeSerial, assertNoOpenPicks } = require('../../services/librarySerials');

// POST /v1/api/libraries/transfer/upload - 上传到云端 (本地库 -> 云端库)
router.post('/upload', auth, async (req, res) => {
  try {
    const { fromCode, toCode, cardIds } = req.body;

    if (!fromCode || !toCode || !cardIds || !Array.isArray(cardIds)) {
      return res.status(400).json({ error: 'fromCode, toCode and cardIds are required' });
    }

    // 本地库属于当前用户，云端库属于所有人
    const StockCode = require('../../models/StockCode');
    const fromSC = await StockCode.findOne({ fullCode: fromCode, libraryType: 'local', assignedTo: req.user.id });
    const toSC = await StockCode.findOne({ fullCode: toCode, libraryType: 'cloud' });

    if (!fromSC) {
      return res.status(404).json({ error: 'Source library not found' });
    }
    if (!toSC) {
      return res.status(404).json({ error: 'Target library not found' });
    }

    // 源库上有没拣完的拣货单就不许往外搬：`OrderPick.position` 指着具体卡位，
    // 卡被搬到别的库，那张单子就永远拣不到了（而单子自己不会知道）。
    // 只守**源库** —— 往目标库追加是在最大号后面接，不动别人已有的卡位，不用拦。
    try { await assertNoOpenPicks(fromCode); } catch (e) {
      return res.status(e.status || 409).json({ error: e.message });
    }

    // 从本地库获取卡牌（必须是当前用户的）
    const cards = await Card.find({ _id: { $in: cardIds }, libraryCode: fromCode, userId: req.user.id });
    if (cards.length !== cardIds.length) {
      return res.status(404).json({ error: 'Some cards not found' });
    }

    // 追加点到目标库的**现有最大号 +1**（不是 countDocuments+1 —— 目标库有空洞时会撞号，
    // 见 services/librarySerials.js 的 nextSerialNum）。目标库是云端库，卡牌 userId=null。
    const baseSerial = await nextSerialNum(toCode, { userId: null });
    const newCards = [];

    for (let i = 0; i < cards.length; i++) {
      const original = cards[i];
      const newSerial = makeSerial(toCode, baseSerial + i);
      
      const newCard = new Card({
        jpName: original.jpName,
        cnName: original.cnName,
        code: original.code,
        rarity: original.rarity,
        condition: original.condition,
        serial: newSerial,
        libraryCode: toCode,
        versionId: original.versionId,
        img: original.img,
        userId: null  // 云端库卡牌 userId=null
      });
      await newCard.save();
      newCards.push(newCard);
    }

    // 从本地库删除卡牌
    await Card.deleteMany({ _id: { $in: cardIds } });

    res.json({ success: true, count: newCards.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /v1/api/libraries/transfer/download - 下载到本地 (云端库 -> 本地库)
router.post('/download', auth, async (req, res) => {
  try {
    const { fromCode, toCode, cardIds } = req.body;

    if (!fromCode || !toCode || !cardIds || !Array.isArray(cardIds)) {
      return res.status(400).json({ error: 'fromCode, toCode and cardIds are required' });
    }

    // 云端库属于所有人，本地库属于当前用户
    const StockCode = require('../../models/StockCode');
    const fromSC = await StockCode.findOne({ fullCode: fromCode, libraryType: 'cloud' });
    const toSC = await StockCode.findOne({ fullCode: toCode, libraryType: 'local', assignedTo: req.user.id });

    if (!fromSC) {
      return res.status(404).json({ error: 'Source library not found' });
    }
    if (!toSC) {
      return res.status(404).json({ error: 'Target library not found' });
    }

    // 源库上有没拣完的拣货单就不许往外搬（同 /upload）
    try { await assertNoOpenPicks(fromCode); } catch (e) {
      return res.status(e.status || 409).json({ error: e.message });
    }

    // 从云端库获取卡牌
    const cards = await Card.find({ _id: { $in: cardIds }, libraryCode: fromCode, userId: null });
    if (cards.length !== cardIds.length) {
      return res.status(404).json({ error: 'Some cards not found' });
    }

    const baseSerial = await nextSerialNum(toCode, { userId: req.user.id });

    for (let i = 0; i < cards.length; i++) {
      const original = cards[i];
      const newSerial = makeSerial(toCode, baseSerial + i);
      
      const newCard = new Card({
        jpName: original.jpName,
        cnName: original.cnName,
        code: original.code,
        rarity: original.rarity,
        condition: original.condition,
        serial: newSerial,
        libraryCode: toCode,
        versionId: original.versionId,
        img: original.img,
        userId: req.user.id  // 本地库卡牌绑定当前用户
      });
      await newCard.save();
    }

    // 从云端库删除卡牌
    await Card.deleteMany({ _id: { $in: cardIds } });

    res.json({ success: true, count: cards.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
