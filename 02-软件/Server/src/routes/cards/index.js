const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const auth = require('../../middleware/auth');
const Card = require('../../models/Card');
const CardMark = require('../../models/CardMark');
const { 造匹配器 } = require('../../services/cardMarks');
const { nextSerialNum, makeSerial, assertNoOpenPicks } = require('../../services/librarySerials');

// 原图存储目录（S-LAN-Local/uploads/orig）
const origDir = path.join(__dirname, '../../../uploads/orig');

// GET /v1/api/cards/pending - 待上架卡牌(所有pending StockCode的Card)
router.get('/pending', auth, async (req, res) => {
  try {
    const StockCode = require('../../models/StockCode');
    const pending = await StockCode.find({ status: 'pending' }).lean();
    const codes = pending.map(s => s.fullCode);
    if (codes.length === 0) return res.json({ list: [] });
    const cards = await Card.find({ libraryCode: { '$in': codes } }).sort({ code: 1 }).lean();
    res.json({ list: cards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/cards/archived - 已上架卡牌汇总
router.get('/archived', auth, async (req, res) => {
  try {
    const StockCode = require('../../models/StockCode');
    const archived = await StockCode.find({ status: 'archived' }).lean();
    const codes = archived.map(s => s.fullCode);
    if (codes.length === 0) return res.json({ list: [] });
    const cards = await Card.find({ libraryCode: { '$in': codes } }).sort({ code: 1 }).lean();
    res.json({ list: cards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/cards/search - 搜索卡牌
router.get('/search', auth, async (req, res) => {
  try {
    const { q, libraryCode, type } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'q is required' });
    }

    const query = {
      $or: [
        { extCode: q },
        { jpName: { $regex: q, $options: 'i' } },
        { cnName: { $regex: q, $options: 'i' } },
        { code: { $regex: q, $options: 'i' } },
        { serial: { $regex: q, $options: 'i' } }
      ]
    };

    if (libraryCode) {
      query.libraryCode = libraryCode;
    }

    if (type) {
      const userIdFilter = type === 'cloud' ? null : req.user.id;
      const StockCode = require('../../models/StockCode');
      const stockCodes = await StockCode.find({ libraryType: type }).lean();
      const codes = stockCodes.map(sc => sc.fullCode);
      query.libraryCode = { $in: codes };
      query.userId = userIdFilter;
    }

    const cards = await Card.find(query).limit(50);

    // 已登记的卡 → 前端画绿色「信息已登记」+ 纯红底。
    // 以前这里不带 marked：上传页用搜索框搜完之后，整页的绿块全掉回蓝、要刷新才回来。
    // 口径跟 GET /libraries/:code/cards 一致（都是去 cardmarks 现查一次）。
    // 粒度是 (编号, 罕贵度)，通配口径统一在 services/cardMarks.js。
    const searchCodes = cards
      .map(c => String(c.code || '').trim().toUpperCase())
      .filter(c => c && c !== '...' && c !== '---');
    const markHits = searchCodes.length
      ? await CardMark.find({ code: { $in: searchCodes } }).select('code rarity').lean()
      : [];
    const 命中登记 = 造匹配器(markHits);

    const list = cards.map(card => ({
      id: card._id,
      jpName: card.jpName,
      cnName: card.cnName,
      code: card.code,
      rarity: card.rarity,
      condition: card.condition,
      note: card.note || '',
      serial: card.serial,
      img: card.img,
      origImg: card.origImg || '',
      extCode: card.extCode || '',
      altArtIndex: card.altArtIndex || 0,
      altLabel: card.altLabel || '',
      altLabels: card.altLabels || {},
      libraryCode: card.libraryCode,
      versionId: card.versionId,
      // 已登记（自动或手动）→ 前端绿块 + 纯红底
      marked: 命中登记(card.code, card.rarity)
    }));

    res.json({ list });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /v1/api/cards - 创建卡牌
router.post('/', auth, async (req, res) => {
  try {
    const { libraryCode, jpName, cnName, code, rarity, condition, note, versionId, type = 'local', extCode, altArtIndex, altLabel, altLabels, origImg } = req.body;

    if (!libraryCode) {
      return res.status(400).json({ error: 'libraryCode is required' });
    }

    const userId = type === 'cloud' ? null : req.user.id;
    const StockCode = require('../../models/StockCode');
    const sc = await StockCode.findOne({ fullCode: libraryCode, libraryType: type });
    if (!sc) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // 卡位号取「现有最大号 +1」，**不是** countDocuments+1 ——
    // 库里有空洞（删过卡、或压实之前）时 count+1 会撞上已存在的那张（见 services/librarySerials.js）
    const serial = makeSerial(libraryCode, await nextSerialNum(libraryCode, { userId }));

    const card = new Card({
      jpName: jpName || '',
      cnName: cnName || '',
      code: code || '',
      rarity: rarity || '',
      condition: condition || '',
      note: note || '',
      serial,
      libraryCode,
      versionId: versionId || 1,
      img: '',
      origImg: origImg || '',
      userId,
      extCode: extCode || '',
      altArtIndex: altArtIndex ?? null,
      altLabel: altLabel || '',
      altLabels: altLabels && typeof altLabels === 'object' ? altLabels : {},
    });
    await card.save();

    // 编号在目录里查不到 → 自动记进「待处理」清单（上传页会画成淡红底 + 绿色「信息已登记」）。
    // 挂在写路径上：只有"新卡进来"才可能冒出新的编号。
    // 登记失败不能连累建卡本身 —— 所以单独 try 掉，只告警。
    try {
      await CardMark.autoRegister(card.code, {
        libraryCode,
        jpName: card.jpName,
        cnName: card.cnName,
        img: card.img,
      });
    } catch (e) {
      console.warn('[Cards] 自动登记待处理失败:', e.message);
    }

    // 同步 StockCode 卡牌数 + 自动算状态
    const cnt = await Card.countDocuments({ libraryCode });
    const scSync = await StockCode.findOne({ fullCode: libraryCode });
    if (scSync) {
      const update = { currentCards: cnt };
      // archived/locked/pending 不自动改状态
      if (scSync.status !== 'archived' && scSync.status !== 'locked' && scSync.status !== 'pending') {
        if (cnt >= scSync.maxCards) update.status = 'full';
        else if (cnt > 0) update.status = 'in_use';
        else update.status = 'available';
      }
      await StockCode.updateOne({ fullCode: libraryCode }, { $set: update });
    }

    res.status(201).json({
      id: card._id,
      serial: card.serial,
      img: card.img
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /v1/api/cards/:id - 删除卡牌
// PUT /v1/api/cards/:id - 更新卡牌（识别完成后更新名称/编号/图片）
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    // 用 let 接住云端卡：下面自动登记要用 card.libraryCode，取不到库名就白记了。
    // （原来这里查完云端卡没接住，只用来判存在 —— 行为一样，只是多留了个引用。）
    let card = await Card.findOne({ _id: id, userId: req.user.id });
    if (!card) {
      // 也允许更新云端卡牌
      card = await Card.findOne({ _id: id, userId: null });
      if (!card) {
        return res.status(404).json({ error: 'Card not found' });
      }
    }

    const { jpName, cnName, code, rarity, condition, note, img, origImg, versionId, serial, altArtIndex, altLabel, altLabels, extCode } = req.body;
    const update = {};
    if (jpName !== undefined) update.jpName = jpName;
    if (cnName !== undefined) update.cnName = cnName;
    if (code !== undefined) update.code = code;
    if (rarity !== undefined) update.rarity = rarity;
    if (condition !== undefined) update.condition = condition;
    if (note !== undefined) update.note = note;
    if (img !== undefined) update.img = img;
    if (versionId !== undefined) update.versionId = versionId;
    if (serial !== undefined) update.serial = serial;
    // 改卡位号 = 重排，得先确认这个库上没有没拣完的拣货单。
    // 「重编号」目前是前端一张一张 PUT 打上来的（upload.vue / batch-recognize.vue 的 renumberList），
    // 所以这条守卫就落在这里，别指望某处会统一调用 compactLibrarySerials。
    // 号没变就不拦 —— 编辑弹窗原样回写整张卡时也会带上 serial，那不是重排。
    if (serial !== undefined && serial !== card.serial) {
      try {
        await assertNoOpenPicks(card.libraryCode);
      } catch (e) {
        return res.status(e.status || 409).json({ error: e.message });
      }
    }
    if (altArtIndex !== undefined) update.altArtIndex = altArtIndex;
    if (altLabel !== undefined) update.altLabel = altLabel;
    if (altLabels !== undefined) update.altLabels = altLabels;
    if (extCode !== undefined) update.extCode = extCode;
    if (origImg !== undefined) update.origImg = origImg;

    const updated = await Card.findByIdAndUpdate(id, update, { new: true });

    // 「改编号」也是编号进来的一个入口：改成目录里没有的（DL1-010 这种），同样自动登记。
    // 识别完成后前端也是走这个接口把编号写进来的，所以这里顺带覆盖了"识别出编号"那条路；
    // 而且此刻 card 已经在手上，库名/卡名/卡图都是全的 —— 比挂在识别接口里记出来的准。
    if (update.code !== undefined) {
      try {
        await CardMark.autoRegister(update.code, {
          libraryCode: card.libraryCode,
          jpName: updated?.jpName,
          cnName: updated?.cnName,
          img: updated?.img,
        });
      } catch (e) {
        console.warn('[Cards] 自动登记待处理失败:', e.message);
      }
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /v1/api/cards/orig-image - 接收前端压缩后的原图 dataURL，存到 uploads/orig，返回可访问路径
router.post('/orig-image', auth, async (req, res) => {
  try {
    const { dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string' || !/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) {
      return res.status(400).json({ error: 'dataUrl 格式不正确（需为图片 base64 dataURL）' });
    }
    const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i)
    const ext = (m[1] || 'jpeg').toLowerCase() === 'jpeg' ? 'jpg' : (m[1] || 'jpg').toLowerCase()
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length || buf.length > 3 * 1024 * 1024) {
      return res.status(400).json({ error: '图片数据为空或超过 3MB' });
    }
    fs.mkdirSync(origDir, { recursive: true })
    const filename = `orig-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
    fs.writeFileSync(path.join(origDir, filename), buf)
    res.json({ path: `/uploads/orig/${filename}` })
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/api/cards/orig-cache - 原图缓存列表（扫描 uploads/orig，含上传时间/大小/引用数）
router.get('/orig-cache', auth, async (req, res) => {
  try {
    fs.mkdirSync(origDir, { recursive: true });
    const files = fs.readdirSync(origDir).filter(f => /^orig-/.test(f));
    // 文件名格式 orig-{毫秒时间戳}-{hex}.{ext}
    const list = await Promise.all(files.map(async (name) => {
      const url = '/uploads/orig/' + name;
      const stat = fs.statSync(path.join(origDir, name));
      const m = name.match(/^orig-(\d{10,})-.*\.(.+)$/);
      const uploadedAt = m ? new Date(parseInt(m[1], 10)) : stat.mtime;
      const refCount = await Card.countDocuments({ origImg: url });
      return {
        name,
        url,
        size: stat.size,
        uploadedAt: uploadedAt.toISOString(),
        refCount
      };
    }));
    // 按上传时间倒序
    list.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json({ list, total: list.length, totalSize: list.reduce((s, f) => s + f.size, 0) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /v1/api/cards/orig-cache - 批量删除原图缓存（删文件 + 清空引用卡牌 origImg）
router.delete('/orig-cache', auth, async (req, res) => {
  try {
    const files = (req.query.files || '').split(',').filter(Boolean);
    if (files.length === 0) {
      return res.status(400).json({ error: 'files 不能为空' });
    }
    let deleted = 0;
    let clearedCards = 0;
    for (const name of files) {
      // 防路径穿越：只允许文件名，不允许 / 或 ..
      if (!/^orig-[\w.-]+$/.test(name)) continue;
      const filePath = path.join(origDir, name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted++;
      }
      const url = '/uploads/orig/' + name;
      const r = await Card.updateMany({ origImg: url }, { $set: { origImg: '' } });
      clearedCards += r.modifiedCount || 0;
    }
    res.json({ success: true, deleted, clearedCards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    let card = await Card.findOne({ _id: id, userId: req.user.id });
    if (!card) {
      // 也允许删除云端卡牌
      card = await Card.findOne({ _id: id, userId: null });
      if (!card) {
        return res.status(404).json({ error: 'Card not found' });
      }
    }

    await Card.findByIdAndDelete(id);

    // 删除关联的原图文件，避免孤儿文件占磁盘
    if (card.origImg && card.origImg.startsWith('/uploads/orig/')) {
      const filePath = path.join(origDir, path.basename(card.origImg))
      fs.unlink(filePath, () => {})
    }

    // 同步 StockCode 卡牌数 + 自动算状态
    const StockCode = require('../../models/StockCode');
    const cnt = await Card.countDocuments({ libraryCode: card.libraryCode });
    const sc = await StockCode.findOne({ fullCode: card.libraryCode });
    if (sc) {
      const update = { currentCards: cnt };
      if (sc.status !== 'archived' && sc.status !== 'locked' && sc.status !== 'pending') {
        if (cnt >= sc.maxCards) update.status = 'full';
        else if (cnt > 0) update.status = 'in_use';
        else update.status = 'available';
      }
      await StockCode.updateOne({ fullCode: card.libraryCode }, { $set: update });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
