/**
 * 图片缓存管理 — 后台管理（/v1/api/admin/caches）
 *
 * 订单拍照留痕（uploads/order-photos）：
 *   GET  /order-photos        — 按订单分组列表（订单状态/照片数/大小/缩略图地址）
 *   POST /order-photos/cleanup — 一键清理「已完成 + X个月前」拍照的照片（删文件+删记录+同步 photoCount）
 *   POST /order-photos/delete  — 批量删除指定订单的全部照片（同上三步一致性）
 *
 * 卡牌原图缓存（uploads/orig）复用 /v1/api/cards/orig-cache（含引用数保护）
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const authAdmin = require('../../middleware/authAdmin');
const Order = require('../../models/Order');
const OrderPhoto = require('../../models/OrderPhoto');
const Card = require('../../models/Card');

const photoDir = path.join(__dirname, '../../../uploads/order-photos');
const origDir = path.join(__dirname, '../../../uploads/orig');

/** 删除单张照片：磁盘文件 + order_photos 记录（不影响 OrderPhoto 之外的其它数据） */
const removePhotoFile = (p) => {
  const fp = path.join(photoDir, p.filename);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* 文件缺失也允许删记录 */ }
};

// GET /v1/api/admin/caches/order-photos — 订单拍照留痕列表（按订单分组）
router.get('/order-photos', authAdmin, async (req, res) => {
  try {
    const photos = await OrderPhoto.find({}).sort({ index: 1 }).lean();
    const orderNos = [...new Set(photos.map(p => p.orderNo))];
    const orders = orderNos.length ? await Order.find({ orderNo: { $in: orderNos } }).lean() : [];
    const orderMap = Object.fromEntries(orders.map(o => [o.orderNo, o]));

    const byOrder = {};
    let total = 0, totalSize = 0;
    for (const p of photos) {
      let size = 0;
      try { size = fs.statSync(path.join(photoDir, p.filename)).size; } catch (e) { /* 文件缺失 */ }
      const o = orderMap[p.orderNo] || { status: 'done', shortName: '' };
      if (!byOrder[p.orderNo]) {
        byOrder[p.orderNo] = {
          orderNo: p.orderNo,
          shortName: o.shortName || '',
          status: o.status || 'done',
          photos: [],
        };
      }
      byOrder[p.orderNo].photos.push({
        index: p.index,
        filename: p.filename,
        size,
        src: `/v1/api/orders/${p.orderNo}/photos/${p.index}/file`,
        uploadedAt: p.createdAt || p.updatedAt,
      });
      total++;
      totalSize += size;
    }
    const list = Object.values(byOrder).map(g => {
      g.photoCount = g.photos.length;
      g.size = g.photos.reduce((s, p) => s + p.size, 0);
      return g;
    });
    res.json({ total, totalSize, list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/admin/caches/order-photos/cleanup — 一键清理「已完成 + X个月前」拍照的照片
// body: { months } 默认 3；只删已完成订单，且照片拍照时间早于 X 个月前
router.post('/order-photos/cleanup', authAdmin, async (req, res) => {
  try {
    const months = Math.max(1, parseInt(req.body.months) || 3);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    const doneOrders = await Order.find({ status: 'done' }).select('orderNo').lean();
    const doneNos = new Set(doneOrders.map(o => o.orderNo));
    const photos = await OrderPhoto.find({}).lean();

    const affected = new Set();
    let deleted = 0;
    for (const p of photos) {
      if (!doneNos.has(p.orderNo)) continue;
      const t = p.createdAt || p.updatedAt;
      if (!t || new Date(t) >= cutoff) continue;
      removePhotoFile(p);
      await OrderPhoto.deleteOne({ _id: p._id });
      deleted++;
      affected.add(p.orderNo);
    }
    // 同步受影响订单 photoCount
    for (const ono of affected) {
      const cnt = await OrderPhoto.countDocuments({ orderNo: ono });
      await Order.updateOne({ orderNo: ono }, { $set: { photoCount: cnt } });
    }
    res.json({ deleted, ordersAffected: affected.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/admin/caches/order-photos/delete — 批量删除指定订单的全部照片（三步一致性）
// body: { orderNos: [] }
router.post('/order-photos/delete', authAdmin, async (req, res) => {
  try {
    const orderNos = (req.body.orderNos || []).filter(Boolean);
    if (!orderNos.length) return res.status(400).json({ error: 'orderNos required' });

    const photos = await OrderPhoto.find({ orderNo: { $in: orderNos } }).lean();
    for (const p of photos) {
      removePhotoFile(p);
      await OrderPhoto.deleteOne({ _id: p._id });
    }
    for (const ono of orderNos) {
      const cnt = await OrderPhoto.countDocuments({ orderNo: ono });
      await Order.updateOne({ orderNo: ono }, { $set: { photoCount: cnt } });
    }
    res.json({ deleted: photos.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/api/admin/caches/orig/cleanup — 一键清理「X 个月前上传」的原图缓存（删文件 + 清空引用卡牌 origImg）
// body: { months } 默认 3；文件名带毫秒时间戳，以文件名时间为准，缺失则用 mtime
router.post('/orig/cleanup', authAdmin, async (req, res) => {
  try {
    const months = Math.max(1, parseInt(req.body.months) || 3);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    if (!fs.existsSync(origDir)) return res.json({ deleted: 0, clearedCards: 0 });
    const files = fs.readdirSync(origDir).filter(f => /^orig-/.test(f));
    let deleted = 0, clearedCards = 0;
    for (const name of files) {
      const filePath = path.join(origDir, name);
      let stat = null;
      try { stat = fs.statSync(filePath); } catch (e) { continue; }
      const m = name.match(/^orig-(\d{10,})-.*\.(.+)$/);
      const t = m ? new Date(parseInt(m[1], 10)) : stat.mtime;
      if (!t || t >= cutoff) continue;
      fs.unlinkSync(filePath);
      deleted++;
      const url = '/uploads/orig/' + name;
      const r = await Card.updateMany({ origImg: url }, { $set: { origImg: '' } });
      clearedCards += r.modifiedCount || 0;
    }
    res.json({ deleted, clearedCards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
