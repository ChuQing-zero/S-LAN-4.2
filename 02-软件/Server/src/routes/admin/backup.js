/**
 * 备份管理 API — 管理后台用
 * 功能: 执行备份 / 列出备份 / 恢复备份 / 删除备份
 * 全部挂 authAdmin (管理员权限)
 *
 * 备份底层调用 mongodump / mongorestore, 存 Storage\backup\<时间戳>\
 */
const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const authAdmin = require('../../middleware/authAdmin');
const { mongodbUri } = require('../../config');

// 备份根目录: V1.2\Storage\backup（**不是** V1.1 —— 那句老注释是从 V1.1 抄过来时留下的，
// 跟下面这行算出来的路径不是一回事。老备份躺在 V1.1\Storage\backup，本目录看不见它们）
const BKROOT = path.join(__dirname, '..', '..', '..', '..', 'Storage', 'backup');
const MONGODUMP = 'D:\\App\\mongodb\\mongodb-win32-x86_64-windows-8.0.5\\bin\\mongodump.exe';
const MONGORESTORE = 'D:\\App\\mongodb\\mongodb-win32-x86_64-windows-8.0.5\\bin\\mongorestore.exe';

// ⚠️ 主机 / 端口 / 库名一律从 config.mongodbUri 里解，**不要写死**。
// 以前这两条命令不带 --host/--port，mongodump 就默认去连 localhost:27017，
// 而本项目用的是 28018 —— 于是「立即备份」和「恢复」两个按钮一直静默 500，
// V1.2 从来没成功备份过一次。（恢复那条还带着 --drop：哪天 27017 上真跑了个 MongoDB，
// 它会连上去把那个库的表删掉。所以这里修的不只是「备份不工作」。）
function 库连接参数() {
  try {
    const u = new URL(mongodbUri);
    return {
      host: u.hostname || '127.0.0.1',
      port: u.port || '27017',
      // 库名同理：mongodump 对不存在的库不报错，只会导出一份空备份，很难发现
      db: (u.pathname || '').replace(/^\//, '') || 's-lan-local',
    };
  } catch (_) {
    // URI 写坏时宁可退回本项目的默认值，也别去连 27017 那个「别人的库」
    return { host: '127.0.0.1', port: '28018', db: 's-lan-local' };
  }
}
const DB = 库连接参数();

// 备份目录名白名单: 仅允许 YYYYMMDD-HHMMSS 格式, 防路径穿越
const NAME_RE = /^\d{8}-\d{6}$/;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 列出全部备份 (名称+大小+时间) */
router.get('/backups', authAdmin, (req, res) => {
  try {
    if (!fs.existsSync(BKROOT)) return res.json({ list: [] });
    const list = fs.readdirSync(BKROOT)
      .filter(d => NAME_RE.test(d) && fs.existsSync(path.join(BKROOT, d, 'mongodump', DB.db)))
      .map(d => {
        let size = 0;
        try {
          const walk = (dir) => {
            for (const e of fs.readdirSync(dir)) {
              const p = path.join(dir, e);
              const st = fs.statSync(p);
              if (st.isDirectory()) walk(p); else size += st.size;
            }
          };
          walk(path.join(BKROOT, d));
        } catch (_) {}
        return { name: d, sizeMB: Math.round(size / 1024 / 1024 * 10) / 10 };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
    res.json({ list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 执行备份 (同步, 约10秒) */
router.post('/backup', authAdmin, (req, res) => {
  try {
    if (!fs.existsSync(MONGODUMP)) {
      return res.status(500).json({ error: 'mongodump 未安装' });
    }
    if (!fs.existsSync(BKROOT)) fs.mkdirSync(BKROOT, { recursive: true });
    const name = stamp();
    const dir = path.join(BKROOT, name);
    const dest = path.join(dir, 'mongodump');
    // stamp() 只精确到秒。同一秒里点第二次会落到**同一个名字**上 ——
    // 那种情况下这个目录里装的是上一次成功备份，失败时绝不能连带收掉。
    const 是这次新建的 = !fs.existsSync(dir);
    fs.mkdirSync(dest, { recursive: true });
    try {
      execSync(`"${MONGODUMP}" --host ${DB.host} --port ${DB.port} --db ${DB.db} --out "${dest}"`, { timeout: 120000, windowsHide: true });
    } catch (e) {
      // 报出真实原因：以前这里只有一句笼统的「未运行或导出出错」，
      // 把「连错端口」这种一眼能看出的问题糊了整整一个版本
      const msg = String((e && (e.stderr || e.stdout || e.message)) || '').trim().split('\n').pop() || '未知错误';
      console.error('[backup] mongodump 失败:', msg);
      // 只收自己刚建的空壳：失败时留个空目录不算错，但列表接口是按「有没有 {库名}
      // 子目录」筛的，空壳看不见、只会默默堆着（实测连点两次就留下两个）。
      if (是这次新建的) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
      return res.status(500).json({ error: '备份失败: ' + msg });
    }
    // 附带配置备份
    try {
      const cfgSrc = path.join(__dirname, '..', '..', 'config');
      const cfgDst = path.join(BKROOT, name, 'config');
      fs.cpSync(cfgSrc, cfgDst, { recursive: true });
      fs.copyFileSync(path.join(__dirname, '..', '..', '..', '.env'), path.join(BKROOT, name, 'env-backup.txt'));
    } catch (_) {}
    res.json({ ok: true, name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 恢复备份 (需 body.confirm === 'YES') */
router.post('/backups/:name/restore', authAdmin, (req, res) => {
  try {
    const name = req.params.name;
    if (!NAME_RE.test(name)) return res.status(400).json({ error: '备份名不合法' });
    if (req.body?.confirm !== 'YES') {
      return res.status(400).json({ error: '需要 confirm: "YES" 确认恢复' });
    }
    if (!fs.existsSync(MONGORESTORE)) {
      return res.status(500).json({ error: 'mongorestore 未安装' });
    }
    const src = path.join(BKROOT, name, 'mongodump', DB.db);
    if (!fs.existsSync(src)) return res.status(404).json({ error: '备份不存在' });
    try {
      execSync(`"${MONGORESTORE}" --host ${DB.host} --port ${DB.port} --db ${DB.db} --drop "${src}"`, { timeout: 300000, windowsHide: true });
    } catch (e) {
      const msg = String((e && (e.stderr || e.stdout || e.message)) || '').trim().split('\n').pop() || '未知错误';
      console.error('[backup] mongorestore 失败:', msg);
      return res.status(500).json({ error: '恢复失败: ' + msg });
    }
    res.json({ ok: true, name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 删除备份 */
router.delete('/backups/:name', authAdmin, (req, res) => {
  try {
    const name = req.params.name;
    if (!NAME_RE.test(name)) return res.status(400).json({ error: '备份名不合法' });
    const dir = path.join(BKROOT, name);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: '备份不存在' });
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({ ok: true, name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 在资源管理器中打开备份文件夹 (仅本机部署可用, 方便手动上传网盘) */
router.post('/backups/:name/open', authAdmin, (req, res) => {
  try {
    const name = req.params.name;
    if (!NAME_RE.test(name)) return res.status(400).json({ error: '备份名不合法' });
    const dir = path.join(BKROOT, name);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: '备份不存在' });
    try {
      // 用 PowerShell 打开资源管理器 (在正常桌面会话下可靠弹出)
      execSync(`powershell -NoProfile -Command "Start-Process explorer -ArgumentList '${dir.replace(/'/g, "''")}'"`, { timeout: 8000, windowsHide: true });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: '打开失败 (可能服务器非本机)' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 获取备份文件夹绝对路径 (前端展示/复制用) */
router.get('/backups/:name/path', authAdmin, (req, res) => {
  try {
    const name = req.params.name;
    if (!NAME_RE.test(name)) return res.status(400).json({ error: '备份名不合法' });
    const dir = path.join(BKROOT, name);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: '备份不存在' });
    res.json({ ok: true, path: dir });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
