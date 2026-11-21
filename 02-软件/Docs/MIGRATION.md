# 迁移清单 (V1.0.1 → V1.1) — 已完成

## 已迁移

| 旧位置 | 新位置 | 状态 |
|--------|--------|------|
| `S-LAN-Local\backend\src\` | `Server\src\` | ✅ |
| `S-LAN-Local\backend\uploads\` | `Server\uploads\` | ✅ |
| `S-LAN-Local\backend\.env` | `Server\.env` | ✅ |
| `S-LAN-Local\backend\package.json` | `Server\package.json` | ✅ (s-lan-server 2.0.0 + ws) |
| `FE-Work\` | `Client\` | ✅ |
| `S-LAN-Local\data\card-catalog\` | `Storage\card-catalog\` | ✅ (932 JSON) |
| `S-LAN-Local\data\user-data\` | `Storage\mongo\` | ✅ (287MB 业务数据) |
| 图源 4 目录 | `Storage\tcg-data\` | ✅ (OCG 27GB / YGOPro 1.1GB / Thumbnails / JP-YuGiOh) |
| `TCG_Android\clipper.apk` 等 | `Storage\backup-host-removed-*\` (Host 已废弃) | ✅ 已备份 |

## 已完成的功能改造

- ✅ WS 实时同步中心接入一键上架执行流程（批次开始/单条进度/成功失败/批次结束）
- ✅ 缩略图全量预热（58,028 张，689MB）
- ✅ 前端列表页切换缩略图 + 编译
- ✅ 安全加固（鉴权/密钥/参数校验/CORS）
- ✅ 部署脚本修复（stop/backup/start）
- ✅ Host 独立进程砍掉（统一走 auto-execute-vm 内置端点）
- ✅ MongoDB 索引优化（StockCode.fullCode / Card 复合索引）
- ✅ 卡图接口 Cache-Control + 目录缓存

## 后续待办（上云前）

- [ ] 安装 MongoDB Database Tools（备份功能）
- [ ] APP 打包（见 `Docs\APP_BUILD.md`）
- [ ] DDNS + HTTPS（见 `Docs\DEPLOY.md`）
