/**
 * 卡牌资料库（唯一目录 / 待处理）的**审计与快照落盘** —— 所有会写 `cardcatalogs` 的操作共用。
 *
 * 落盘位置（和 `rename-audit` / `deleted-files` 同一个 Storage 根）：
 *   Server\Storage\carduniques-audit\      每次写操作的审计 JSON
 *   Server\Storage\carduniques-backup\<戳>\ 批量前的行级快照（回滚唯一依赖）
 *   Server\Storage\carduniques-import\     导入官方数据时的源快照
 *
 * ⚠️ **路径层数别抄错**：
 *   本文件在 `Server/src/services` → `../..` = `Server` → `Server/Storage` ✓
 *   而 `cardOfficial.js` 的官方数据在**仓库根** `Storage/card-official`，它用的是 3 级。
 *   两处真的不是同一层，`admin/backup.js` 又是 4 级。抄之前先数 `__dirname`。
 *
 * 为什么必须落盘才动手：单机 MongoDB **没有副本集**，`session.withTransaction` 会直接抛错，
 * 跨集合写入没有回滚。所以规矩是「快照没写成功 → 直接 500 中止，一个字都不改」。
 */
const fs = require('fs');
const path = require('path');

const STORAGE = path.join(__dirname, '..', '..', 'Storage');
const AUDIT_DIR = path.join(STORAGE, 'carduniques-audit');
const BACKUP_ROOT = path.join(STORAGE, 'carduniques-backup');
const IMPORT_DIR = path.join(STORAGE, 'carduniques-import');

/**
 * 时间戳 `YYYYMMDD-HHmmss`，给审计文件名 / 备份目录名用。
 * 和 `tcg/index.js:102` 是同一套，**不要改用 `toISOString().slice(0,15)`**：
 * 那样切出来结尾多一个「.」，当目录名时 Windows 会把尾点吃掉，审计里记的路径就和磁盘上对不上。
 */
function makeStamp(d = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

const 安全片段 = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * 开一份审计。返回的对象带 `save()`，可以反复调 ——
 * 每做完一步就 `save()` 一次，这样中途崩了，磁盘上留下的也是「做到哪了」而不是空白。
 *
 * @param {string} stamp makeStamp() 的结果
 * @param {...string} parts 语义片段（操作名 / 卡密 之类），只用来拼文件名
 * @returns {{ auditId: string, auditPath: string, save: (obj: any) => void }}
 */
function openAudit(stamp, ...parts) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const auditId = [stamp, ...parts].map(安全片段).join('-');
  const auditPath = path.join(AUDIT_DIR, auditId + '.json');
  return {
    auditId,
    auditPath,
    save: (obj) => fs.writeFileSync(auditPath, JSON.stringify(obj, null, 2), 'utf-8'),
  };
}

/**
 * 把「每行改之前长什么样」落盘。**失败要抛** —— 调用方必须转成 500 并中止，
 * 绝不能「快照没写成功也接着改」：那样这批改动就再也退不回来了。
 *
 * @param {string} stamp
 * @param {string} name 快照文件名（不带 .json），例如 `cnName-before`
 * @param {Array}  rows 想留什么就留什么，回滚时读得回来即可
 */
function saveSnapshot(stamp, name, rows) {
  const dir = path.join(BACKUP_ROOT, 安全片段(stamp));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 安全片段(name) + '.json');
  fs.writeFileSync(file, JSON.stringify(rows), 'utf-8');   // 写不进去就让它抛
  return { dir, file, count: rows.length };
}

/** 读回一份快照 */
function readSnapshot(stamp, name) {
  const dir = resolveSnapshotDir(stamp);
  const file = path.join(dir, 安全片段(name) + '.json');
  if (!fs.existsSync(file)) throw new Error('这个快照里没有 ' + name + '.json');
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * 把 `stamp` 解析成绝对目录，**带路径穿越防护**。
 * 照 `admin/backup.js:21` 的 NAME_RE 思路，外面再加一层 `path.resolve` 包含性检查 ——
 * 光靠正则挡不住 `..`（`..` 本身是合法字符），必须再确认解析结果确实在 BACKUP_ROOT 底下。
 */
function resolveSnapshotDir(stamp) {
  const s = String(stamp || '');
  if (!NAME_RE.test(s)) throw new Error('快照名不合法');
  const root = path.resolve(BACKUP_ROOT);
  const dir = path.resolve(root, s);
  if (dir !== root && !dir.startsWith(root + path.sep)) throw new Error('快照目录越界');
  if (!fs.existsSync(dir)) throw new Error('没有这个快照：' + s);
  return dir;
}

/** 有哪些快照可以回滚（新的在前） */
function listSnapshots() {
  if (!fs.existsSync(BACKUP_ROOT)) return [];
  return fs.readdirSync(BACKUP_ROOT)
    .filter((n) => fs.statSync(path.join(BACKUP_ROOT, n)).isDirectory())
    .sort()
    .reverse();
}

module.exports = {
  STORAGE, AUDIT_DIR, BACKUP_ROOT, IMPORT_DIR,
  makeStamp, openAudit, saveSnapshot, readSnapshot, resolveSnapshotDir, listSnapshots,
};
