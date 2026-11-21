/**
 * VM 启动控制 API — 雷电模拟器 + 集换社 APP
 */
const express = require('express');
const router = express.Router();
const { execSync, spawn, exec } = require('child_process');
const http = require('http');
const path = require('path');
const auth = require('../middleware/auth');

// 配置
const LD_DIR = 'D:\\App\\leidian\\LDPlayer9';
const ADB     = path.join(LD_DIR, 'adb.exe');
const DEVICE  = 'localhost:5555';
const APP_PKG = 'com.jihuanshe';
const APP_ACT = '.ui.page.main.MainActivity';
const API_ANDROID = 'http://localhost:8090';

// 状态
let launchState = { status: 'idle', step: '', detail: '', startedAt: null };

function adbCmd(...args) {
  try {
    return execSync(`"${ADB}" -s ${DEVICE} ${args.join(' ')}`, {
      encoding: 'utf-8', timeout: 15000, windowsHide: true
    }).trim();
  } catch (e) {
    return '';
  }
}

function httpGet(url) {
  return new Promise((resolve) => {
    http.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// GET /api/launch-vm/status — 当前状态
router.get('/status', (req, res) => {
  res.json(launchState);
});

// POST /api/launch-vm/start — 启动模拟器+APP
router.post('/start', auth, async (req, res) => {
  try {
    launchState = { status: 'launching', step: '1/5 启动模拟器', detail: '', startedAt: new Date().toISOString() };

    // Step 1-2: 启动 dnplayer.exe
    exec(`start "" "${LD_DIR}\\dnplayer.exe"`, { cwd: LD_DIR, windowsHide: true });
    launchState.step = '2/5 等待ADB连接';

    // Step 3: 等待 ADB
    for (let i = 0; i < 30; i++) {
      const r = execSync(`"${ADB}" connect ${DEVICE}`, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
      if (r.includes('connected') || r.includes('already')) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    launchState.step = '3/5 等待Android开机';

    // Step 4: 等待开机
    for (let i = 0; i < 60; i++) {
      const boot = adbCmd('shell', 'getprop', 'sys.boot_completed');
      if (boot === '1') break;
      await new Promise(r => setTimeout(r, 2000));
    }

    // Step 5: 启动 APP
    launchState.step = '4/5 启动集换社APP';
    const installed = adbCmd('shell', 'pm', 'list', 'packages');
    if (installed.includes(APP_PKG)) {
      adbCmd('shell', 'am', 'start', '-n', `${APP_PKG}/${APP_ACT}`);
      launchState.step = '5/5 启动完成';
    } else {
      launchState.step = '5/5 APP未安装';
    }

    // 检查Android API状态
    const apiStatus = await httpGet(`${API_ANDROID}/api/status`);

    launchState = {
      status: 'running',
      step: '就绪',
      detail: apiStatus ? `设备: ${DEVICE} 屏幕: ${apiStatus.screen || ''}` : 'API未响应',
      startedAt: launchState.startedAt
    };

    res.json({ ok: true, ...launchState });
  } catch (e) {
    launchState = { status: 'error', step: '启动失败', detail: e.message, startedAt: launchState.startedAt };
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/launch-vm/stop — 关机
router.post('/stop', auth, async (req, res) => {
  try {
    adbCmd('shell', 'reboot', '-p');
    launchState = { status: 'idle', step: '已关机', detail: '', startedAt: null };
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/launch-vm/device — 设备信息
router.get('/device', async (req, res) => {
  try {
    const size = adbCmd('shell', 'wm', 'size');
    const ver  = adbCmd('shell', 'getprop', 'ro.build.version.release');
    const boot = adbCmd('shell', 'getprop', 'sys.boot_completed');
    res.json({ ok: true, device: DEVICE, screen: size, android: ver, bootCompleted: boot === '1' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/launch-vm/adb-connect — ADB连接
router.post('/adb-connect', async (req, res) => {
  try {
    const r = adbCmd('connect', DEVICE);
    const ok = r.includes('connected') || r.includes('already');
    res.json({ ok, detail: r });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// POST /api/launch-vm/init-components — 强制激活组件
router.post('/init-components', async (req, res) => {
  const result = { adbKeyboard: false, clipper: false };
  try {
    // ADB键盘
    adbCmd('shell', 'ime', 'enable', 'com.android.adbkeyboard/.AdbIME');
    adbCmd('shell', 'settings', 'put', 'secure', 'default_input_method', 'com.android.adbkeyboard/.AdbIME');
    const cur = adbCmd('shell', 'settings', 'get', 'secure', 'default_input_method');
    result.adbKeyboard = cur.includes('com.android.adbkeyboard');

    // Clipper
    const svcOut = adbCmd('shell', 'am', 'startservice', 'ca.zgrs.clipper/.ClipboardService');
    const pkgOut = adbCmd('shell', 'pm', 'list', 'packages');
    result.clipper = pkgOut.includes('ca.zgrs.clipper');
  } catch (e) {
    result.error = e.message;
  }
  res.json(result);
});

module.exports = router;
