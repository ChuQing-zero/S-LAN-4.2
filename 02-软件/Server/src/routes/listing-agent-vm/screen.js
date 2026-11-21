/**
 * VM Screen 操作 — ADB 底层封装
 * 对应 PC 版 screen.js (pyautogui), 这里用 ADB shell 命令
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 配置
const ADB = process.env.LD_ADB_PATH || 'D:/App/leidian/LDPlayer9/adb.exe';
const DEVICE = 'localhost:5555';
const XML_PATH = path.join(__dirname, '..', '..', '..', '..', 'Storage', 'cache', 'ui_vm.xml');

/** 执行 ADB 命令 */
function adb(cmd, timeout = 5000) {
  try {
    return execSync(`${ADB} -s ${DEVICE} ${cmd}`, { encoding: 'utf-8', timeout, windowsHide: true, killSignal: 'SIGKILL' }).trim();
  } catch (e) {
    return '';
  }
}

/** 确保连接 */
function ensureConnected() {
  const out = adb('connect ' + DEVICE);
  return out.includes('connected') || out.includes('already');
}

// ==================== 基础操作 ====================

/** 单击 */
function clickAt(x, y) {
  adb(`shell input tap ${Math.round(x)} ${Math.round(y)}`);
}

/** 双击 */
function doubleClick(x, y) {
  adb(`shell input tap ${Math.round(x)} ${Math.round(y)}`);
  sleep(80);
  adb(`shell input tap ${Math.round(x)} ${Math.round(y)}`);
}

/** 三击 */
function tripleClick(x, y) {
  for (let i = 0; i < 3; i++) {
    adb(`shell input tap ${Math.round(x)} ${Math.round(y)}`);
    sleep(80);
  }
}

/** 输入文字 — Android原生剪贴板 (Clipper) + 粘贴, 支持中文/全角符号 */
function inputText(text, x, y) {
  const t = String(text || '')
  // 1. 点击聚焦
  if (x && y) {
    adb(`shell input tap ${Math.round(x)} ${Math.round(y)}`);
    sleep(300);
  }
  // 2. 设置Android剪贴板 (Clipper广播, 不经过Windows)
  // 安全: 过滤 Windows cmd 元字符, 防止命令注入 (卡牌编号/价格等业务文本不受影响)
  const clean = t.replace(/[&|<>^()%!"]/g, '').replace(/'/g, "'\\''")
  adb(`shell "am broadcast -a clipper.set -e text '${clean}'"`)
  sleep(150)
  // 3. 粘贴
  adb('shell input keyevent 279');
}

/** 按键 */
function pressKey(key) {
  const keyMap = {
    'enter': 'ADB_EDITOR_CODE --ei code 3',   // IME_ACTION_SEARCH
    'backspace': 67,   // KEYCODE_DEL
    'tab': 61,         // KEYCODE_TAB
    'escape': 111,     // KEYCODE_ESCAPE
    'space': 62,       // KEYCODE_SPACE
    'delete': 112,     // KEYCODE_FORWARD_DEL
  };
  const v = keyMap[key.toLowerCase()] || 66;
  if (typeof v === 'string') {
    adb(`shell am broadcast -a ${v}`);
  } else {
    adb(`shell input keyevent ${v}`);
  }
}

/** 滑动 (swipe) */
function scroll(clicksOrOpts) {
  // 支持两种格式:
  // 1. 旧格式: 数字 (clicks<0=向上, clicks>0=向下, 绝对值=重复次数)
  // 2. 新格式: {x1,y1,x2,y2,ms} 或 {clicks,x1,y1,x2,y2,ms}
  if (typeof clicksOrOpts === 'number') {
    const abs = Math.abs(clicksOrOpts);
    const y1 = clicksOrOpts < 0 ? 800 : 300;
    const y2 = clicksOrOpts < 0 ? 300 : 800;
    const times = Math.max(Math.round(abs / 500), 1);
    for (let i = 0; i < times; i++) {
      adb(`shell input swipe 360 ${y1} 360 ${y2} 200`);
      sleep(200);
    }
  } else if (typeof clicksOrOpts === 'object') {
    const x1 = clicksOrOpts.x1 ?? 360;
    const y1 = clicksOrOpts.y1 ?? 800;
    const x2 = clicksOrOpts.x2 ?? 360;
    const y2 = clicksOrOpts.y2 ?? 300;
    const ms = clicksOrOpts.ms ?? 300;
    const times = Math.max(Math.round(Math.abs(clicksOrOpts.clicks || 500) / 500), 1);
    for (let i = 0; i < times; i++) {
      adb(`shell input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${ms}`);
      sleep(200);
    }
  }
}

/** 等待 (同步) */
function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait */ }
}

/** 异步等待 */
function sleepAsync(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 截屏 */
function screenshot(filePath) {
  try {
    execSync(`"${ADB}" -s ${DEVICE} exec-out screencap -p`, { stdio: ['ignore', fs.openSync(filePath, 'w'), 'ignore'], timeout: 10000 });
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 100;
  } catch (e) {
    return false;
  }
}

/** UIAutomator dump → JSON */
function dumpUI() {
  try {
    // dump (execSync阻塞, 返回时文件已写完)
    execSync(`${ADB} -s ${DEVICE} shell uiautomator dump /sdcard/ui_vm.xml`, { encoding: 'utf-8', timeout: 8000, windowsHide: true })
    // read
    const xml = execSync(`${ADB} -s ${DEVICE} exec-out cat /sdcard/ui_vm.xml`, { encoding: 'utf-8', timeout: 5000, windowsHide: true })
    const elements = []
    const nodeRe = /<node[^>]*\/>/g
    let nm
    while ((nm = nodeRe.exec(xml)) !== null) {
      const nodeStr = nm[0]
      const textM = nodeStr.match(/text="([^"]*)"/)
      const boundsM = nodeStr.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
      const clickM = nodeStr.match(/clickable="(true|false)"/)
      const text = textM ? textM[1] : ''
      if (text && boundsM) {
        const x1 = parseInt(boundsM[1]), y1 = parseInt(boundsM[2])
        const x2 = parseInt(boundsM[3]), y2 = parseInt(boundsM[4])
        elements.push({
          text,
          center: { x: Math.round((x1+x2)/2), y: Math.round((y1+y2)/2) },
          bounds: { x1, y1, x2, y2 },
          clickable: clickM ? clickM[1] === 'true' : false,
        })
      }
    }
    return { ok: true, count: elements.length, elements }
  } catch (e) {
    return { ok: false, count: 0, elements: [], error: e.message }
  }
}

/** 找文字并点击 */
function findAndTap(text) {
  const r = dumpUI();
  if (!r.ok) return { ok: false, msg: 'dump failed' };
  // 精确匹配优先
  let el = r.elements.find(e => e.text === text);
  // 模糊匹配
  if (!el) el = r.elements.find(e => e.text.includes(text));
  if (el) {
    clickAt(el.center.x, el.center.y);
    return { ok: true, found: text, tap: [el.center.x, el.center.y] };
  }
  return { ok: false, msg: `'${text}' not found` };
}

/** 验证页面 (dump + 关键词) */
function verify(text) {
  const r = dumpUI();
  const allText = r.elements ? r.elements.map(e => e.text).join(' ') : '';
  const hasSuccess = ['上架成功', '已上架', '添加成功', '保存成功', '修改成功'].some(kw => allText.includes(kw));
  const hasError = ['失败', '错误', '库存不足', '请输入', '不能为空'].some(kw => allText.includes(kw));
  return { ok: true, success: hasSuccess && !hasError, hasError, text: allText.slice(0, 300) };
}

/** 识别卡牌行号 */
function identifyRow(target) {
  const r = dumpUI();
  if (!r.ok) return { ok: false, found: false, msg: 'dump failed' };
  const matches = r.elements
    .filter(e => e.text.toUpperCase().includes(target.toUpperCase()))
    .map((e, i) => ({ idx: i, y: e.center.y, text: e.text }))
    .sort((a, b) => a.y - b.y);
  matches.forEach((m, i) => m.row = i + 1);
  return { ok: true, found: matches.length > 0, rows: matches };
}

module.exports = {
  ensureConnected, dumpUI, findAndTap, verify, identifyRow,
  clickAt, doubleClick, tripleClick, inputText, pressKey, scroll, screenshot,
  sleep, sleepAsync, adb   // sleep 是忙等（会占死事件循环），流程循环里请用 sleepAsync
};
