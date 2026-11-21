const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /v1/api/barcode/decode — 上传图片，返回条码内容
router.post('/decode', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'image required' });

    // 写入临时文件（quagga2 需要文件路径）
    const fs = require('fs');
    const path = require('path');
    const tmpDir = path.join(__dirname, '../../uploads/tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, Date.now() + '.jpg');
    fs.writeFileSync(tmpFile, req.file.buffer);

    // 用 quagga2 解码
    const Quagga = require('@ericblade/quagga2');

    const readers = ['code_128_reader', 'code_39_reader', 'ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader'];

    let result = null;
    for (const reader of readers) {
      try {
        const r = await new Promise((resolve) => {
          Quagga.decodeSingle({ src: tmpFile, numOfWorkers: 0, decoder: { readers: [reader] }, locate: true }, resolve);
        });
        if (r?.codeResult?.code) { result = r.codeResult.code; break; }
      } catch (_) {}
    }

    // 清理临时文件
    fs.unlink(tmpFile, () => {});

    if (result) {
      res.json({ code: result.trim() });
    } else {
      res.status(404).json({ error: 'barcode not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
