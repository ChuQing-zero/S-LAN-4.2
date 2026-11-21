/**
 * 设备连接 — Arduino 进料机 + 手机拍照控制台代理（/v1/api/device，authAdmin）
 *
 * 纯 HTTP 代理转发到 拍照控制台 :6001（http://127.0.0.1:6001）。
 * 前端只跟本后端通信，不直连 :6001（避免跨域 + 统一鉴权）。
 *
 * GET  /status            设备状态（串口/手机/编号/待贴标签）
 * GET  /frame             手机实时画面（PNG 流，刷新用 ?t=）
 * GET  /photos            已拍照片列表（相对路径，最新在前）
 * GET  /photo/:name       照片文件（name 可含子目录 库号/图片名）
 * POST /scan              推一张卡（卡通过自动拍照）
 * POST /capture           立即拍照
 * POST /focus             点击对焦
 * GET/POST /config        控制台参数读写（COM/波特率/延迟/对焦/快门…）
 * POST /serial            设置编号 {libCode, serial, threshold, saveDir}
 * POST /label-confirm     贴标签确认（批次+1、序号重置）
 * POST /auto/start        自动运转到阈值
 * POST /auto/stop         停止自动运转
 * POST /beep              前端→设备报警（蜂鸣器）
 * POST /hardware          通用硬件指令透传 {cmd}（电机/灯环/蜂鸣档位/数码管…，加功能不刷固件）
 */
const express = require('express');
const router = express.Router();
const http = require('http');
const authAdmin = require('../middleware/authAdmin');

const DEVICE_HOST = '127.0.0.1';
const DEVICE_PORT = 6001;

/** 转发 JSON 请求到控制台，返回其 JSON 响应体 */
const proxyJson = (method, path, body) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: DEVICE_HOST, port: DEVICE_PORT, path, method, timeout: 8000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
          } catch (e) {
            reject(new Error('控制台返回非 JSON: ' + data.slice(0, 200)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('控制台请求超时')));
    req.on('error', (e) => reject(e));
    if (payload) req.setHeader('Content-Type', 'application/json');
    req.end(payload || undefined);
  });

/** 控制台在线检查（agent 返回 502 而非抛错） */
const proxyJsonSafe = async (method, path, body) => {
  try {
    return await proxyJson(method, path, body);
  } catch (e) {
    return {
      status: 502,
      data: { error: '拍照控制台(:6001)未运行或不可达: ' + e.message },
    };
  }
};

/** 转发二进制（frame 画面 / photo 图片），原样透传 Content-Type */
const proxyBinary = (res, path) => {
  const req = http.get(
    { host: DEVICE_HOST, port: DEVICE_PORT, path, timeout: 6000 },
    (up) => {
      res.status(up.statusCode);
      if (up.headers['content-type']) res.setHeader('Content-Type', up.headers['content-type']);
      res.setHeader('Cache-Control', 'no-store');
      up.pipe(res);
    }
  );
  req.on('timeout', () => req.destroy());
  req.on('error', () => res.status(502).json({ error: '拍照控制台(:6001)不可达' }));
};

router.get('/status', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/status');
  res.status(r.status).json(r.data);
});

// frame/photo 是 <img> 标签直接加载，无法带 Bearer header → 免鉴权（只读画面/历史照片）
router.get('/frame', (req, res) => {
  proxyBinary(res, '/frame');
});

router.get('/photos', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/photos');
  res.status(r.status).json(r.data);
});

router.get('/inspect', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/inspect');
  res.status(r.status).json(r.data);
});

// name 可含子目录（如 A0-000-01/A0-000-01-0001.jpg）→ 用捕获所有匹配的中间件
router.get('/photo/*', (req, res) => {
  const name = decodeURIComponent(req.params[0]);
  proxyBinary(res, '/photo/' + encodeURIComponent(name));
});

router.post('/scan', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/scan');
  res.status(r.status).json(r.data);
});

router.post('/capture', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/capture');
  res.status(r.status).json(r.data);
});

router.post('/focus', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/focus');
  res.status(r.status).json(r.data);
});

router.get('/config', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/config');
  res.status(r.status).json(r.data);
});

router.post('/config', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/config', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/serial', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/serial', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/label-confirm', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/label-confirm');
  res.status(r.status).json(r.data);
});

router.post('/auto/start', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/auto/start');
  res.status(r.status).json(r.data);
});

router.post('/auto/stop', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/auto/stop');
  res.status(r.status).json(r.data);
});

router.post('/beep', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/beep');
  res.status(r.status).json(r.data);
});

// 通用硬件指令透传：前端发任意开放协议指令（M,/L,/B,/O,/D,/Q 等），加功能不刷固件
router.post('/hardware', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/hardware', req.body || {});
  res.status(r.status).json(r.data);
});

// ── V1.3 链路管理：USB 数据线 / ESP-01 WiFi ──
router.get('/link', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/link');
  res.status(r.status).json(r.data);
});

router.post('/link', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/link', req.body || {});
  res.status(r.status).json(r.data);
});

// ── 手机无线 ADB：状态 / 发现 / 连接 / 一键配对 / 断开 ──
router.get('/phone/status', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/phone/status');
  res.status(r.status).json(r.data);
});

router.get('/phone/discover', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/phone/discover');
  res.status(r.status).json(r.data);
});

router.post('/phone/connect', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/phone/connect', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/phone/pair_usb', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/phone/pair_usb', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/phone/disconnect', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/phone/disconnect', req.body || {});
  res.status(r.status).json(r.data);
});

// ── 送料时序测试（测试2）──
router.get('/seq/status', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/seq/status');
  res.status(r.status).json(r.data);
});

router.post('/seq/start', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/seq/start', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/seq/stop', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/seq/stop', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/seq/clear', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/seq/clear', req.body || {});
  res.status(r.status).json(r.data);
});

// ── 测试3：6 路光敏监视 ──
router.get('/ldr/status', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/ldr/status');
  res.status(r.status).json(r.data);
});

router.post('/ldr/start', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/ldr/start', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/ldr/stop', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/ldr/stop', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/ldr/clear', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/ldr/clear', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/ldr/once', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/ldr/once', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/outlets/save', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/outlets/save', req.body || {});
  res.status(r.status).json(r.data);
});

router.get('/outlets/get', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/outlets/get');
  res.status(r.status).json(r.data);
});

// ── 调试1：半速到光敏停 ──
router.get('/speed/status', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/speed/status');
  res.status(r.status).json(r.data);
});

router.post('/speed/start', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/speed/start', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/speed/stop', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/speed/stop', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/speed/clear', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/speed/clear', req.body || {});
  res.status(r.status).json(r.data);
});

router.get('/ldr/thresholds', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/ldr/thresholds');
  res.status(r.status).json(r.data);
});

router.post('/ldr/thresholds', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/ldr/thresholds', req.body || {});
  res.status(r.status).json(r.data);
});

router.get('/feedauto/status', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/feedauto/status');
  res.status(r.status).json(r.data);
});

router.post('/feedauto/start', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/feedauto/start', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/feedauto/stop', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/feedauto/stop', req.body || {});
  res.status(r.status).json(r.data);
});

router.get('/vision/photo', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/vision/photo');
  res.status(r.status).json(r.data);
});

// ── 图像识别问答（整机调试用）：传 dataURL + 问题，返回 AI 回答 ──
router.post('/vision/qa', authAdmin, async (req, res) => {
  const started = Date.now();
  try {
    const { image, question } = req.body || {};
    if (!image) return res.status(400).json({ ok: false, error: 'image is required' });

    const ApiKey = require('../models/ApiKey');
    const { callArkVision } = require('../services/arkVisionService');

    const key = await ApiKey.findOne({ isDefault: true, enabled: true }).lean();
    if (!key) return res.status(400).json({ ok: false, error: '后台没有默认可用的豆包钥匙' });

    const q = String(question || '').trim() || '这是什么卡牌？请简短回答。';
    const prompt = q + '\n只回答所问内容，不要解释，不要加标点以外的多余文字。';

    const r = await callArkVision({
      apiKey: key.apiKey,
      apiUrl: key.apiUrl,
      model: key.model,
      imageDataUrl: image,
      prompt,
    });

    res.json({
      ok: true,
      answer: String(r.text || '').trim(),
      model: key.model,
      ms: Date.now() - started,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e), ms: Date.now() - started });
  }
});

// ── 整机主流程 ──
router.get('/main/status', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/main/status');
  res.status(r.status).json(r.data);
});

router.post('/main/start', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/main/start', req.body || {});
  res.status(r.status).json(r.data);
});

router.post('/main/stop', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/main/stop', req.body || {});
  res.status(r.status).json(r.data);
});

// ── 分拣规则读写 ──
router.get('/rules/get', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('GET', '/rules/get');
  res.status(r.status).json(r.data);
});

router.post('/rules/save', authAdmin, async (req, res) => {
  const r = await proxyJsonSafe('POST', '/rules/save', req.body || {});
  res.status(r.status).json(r.data);
});

module.exports = router;
