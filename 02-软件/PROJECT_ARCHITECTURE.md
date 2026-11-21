# S-LAN V2.0 整合包 — 架构与目录规划

> 统一目录命名规范：**顶层目录用简洁英文单词**（无前缀），内部子目录同理。
> 支持 PC 网页 / 移动网页 / APP(APK) / 微信小程序 四个端。
>
> **最后更新**: 2026-08-17

---

## 一、命名规范

| 规则 | 示例 |
|------|------|
| 顶层目录 | `Server` `Client` `Host` `Storage` `Deploy` `Docs` |
| 内部子目录 | `config` `models` `routes` `services` `pages` `api` |
| 数据/图源目录 | `TCG_Database`（外部，沿用旧名） |

---

## 二、顶层结构总览

```
D:\Project\S-LAN\Code\
│
├── V1.1\                        ★ 整合包根目录（本次新建，只放代码 + 运行时数据）
│   ├── Server\              后端服务 (Node.js + Express :3001)
│   ├── Client\              前端客户端 (uni-app 四端)
│   ├── Host\                一键上架执行主机 (雷电 ADB)
│   ├── Storage\             运行时数据 (缓存/上传/日志，可重建)
│   ├── Deploy\              部署脚本
│   ├── Docs\                文档
│   └── README.md                总说明
│
├── V1.1 TCG_Database\           ★ 外部数据资产（不属于 V1.1 包，只被引用，不复制）
│   ├── data\TCG_ID_Database\    卡牌结构化数据 JSON
│   ├── data\TCG_Image_Database\ 卡图原图
│   └── server.py / crawler\ ... 数据维护工具
│
├── V1.0.1\                      旧版本（代码迁移来源，完成后保留备份）
└── V1.0TCG-Scanner\             （历史版本）
```

---

## 三、内容归属总表

| 内容 | 位置 | 类型 |
|------|------|------|
| 后端程序 | `Server\` | 代码 |
| 前端程序（四端） | `Client\` | 代码 |
| 一键上架执行主机 | `Host\` | 代码 |
| 部署脚本 | `Deploy\` | 代码 |
| 文档 | `Docs\` | 文档 |
| 业务数据（用户/库存/订单/队列） | `Storage\mongo\`（MongoDB dbpath） | 数据 |
| 卡牌结构化数据 JSON | `V1.1 TCG_Database\data\TCG_ID_Database\` | 数据（引用） |
| 卡图原图 | `V1.1 TCG_Database\data\TCG_Image_Database\` | 图片（引用） |
| 缩略图（遗留） | 旧 `V1.0.1\TCG_Database\` | 图片（引用） |
| 缓存图 / 缩略图缓存 | `Storage\cache\` | 缓存（预留） |
| 上传文件 | `Storage\uploads\` | 运行时生成 |
| 日志 | `Storage\logs\` | 运行时生成 |
| 配置 | `Server\src\config\` + `.env` | 配置 |

---

## 四、目录详细规划

### 4.1 `Server\` — 后端服务

> 从旧 `V1.0.1\S-LAN-Local\backend\` 迁移整理，新增 WS 同步、执行调度、多端鉴权。

```
Server\
├── package.json                    ← 依赖 (express/mongoose/bcryptjs/jsonwebtoken/multer/sharp/ws)
├── .env                            ← 端口/JWT/MongoDB/火山/方舟密钥
├── .gitignore
│
└── src\
    ├── index.js                    ← 服务入口，注册路由+中间件+WS
    │
    ├── config\                     ← 配置
    │   ├── index.js                ← 全局配置
    │   ├── database.js             ← MongoDB 连接
    │   ├── tcg-paths.json          ← ★图源路径 (指向外部 TCG_Database)
    │   ├── tcg-ocg-map.json        ← 卡密→OCG 静态映射 (兜底)
    │   ├── alt-labels.json         ← 异画标签
    │   ├── screen-calib.json       ← 屏幕校准
    │   ├── listing-flows\          ← PC 上架流程模板
    │   └── listing-flows-vm\       ← VM 上架流程模板
    │
    ├── middleware\                 ← 中间件 (auth.js / authAdmin.js)
    ├── models\                     ← Mongoose 模型 (User/ApiKey/Card/CardCatalog/StockCode/
    │                                   ListedCard/ListedSummary/ListingQueue/Order/...)
    ├── routes\                     ← API 路由 (health/auth/user/cards/tcg/listings/orders/admin/...)
    ├── ws\                         ← ★WebSocket 状态同步中心 (index.js / events.js)
    ├── services\                   ← 业务服务 (ocrService/llmService/arkVisionService/
    │                                   billingService/tcgPaths/altLabels/executionService)
    ├── scripts\                    ← 工具脚本 (initDb/createAdmin/fix-*/import-*)
    ├── utils\                      ← 工具函数
    └── uploads\                    ← 上传目录 (软链到 Storage\uploads)
```

**`tcg-paths.json` 内容**（4 个图源路径，指向外部目录）:
```json
{
  "ocgDir":    "D:\\Project\\S-LAN\\Code\\V1.1 TCG_Database\\data\\TCG_Image_Database\\日文OCG",
  "ygoproDir": "D:\\Project\\S-LAN\\Code\\V1.1 TCG_Database\\data\\TCG_Image_Database\\YGOPro图片源",
  "thumbDir":  "D:\\Project\\S-LAN\\Code\\V1.0.1\\TCG_Database\\TCG_Image_Database\\缩略图",
  "dataDir":   "D:\\Project\\S-LAN\\Code\\V1.1 TCG_Database\\data\\TCG_ID_Database\\日文游戏王"
}
```

---

### 4.2 `Client\` — 前端客户端（uni-app 四端）

> 从旧 `V1.0.1\FE-Work\` 迁移扩展，一套源码编译 H5 / APP / 微信小程序。
> **核心设计：共享层 + 端专属页面目录**（接口数据四端一份，UI 按端独立，互不影响）

```
Client\
├── package.json / vite.config.js / index.html / .env
│
├── src\
│   ├── main.js / App.vue
│   ├── pages.json                  ← 页面路由表 (按端指向不同页面目录)
│   ├── manifest.json               ← ★多端配置 (H5/APP/微信小程序)
│   ├── uni.scss                    ← 全局样式
│   │
│   │  ┌─────────────────────────────────────────────────────┐
│   │  │ 共享层 (四端一致，接口+数据+逻辑，永远不动)            │
│   │  ├── api\                     ← 接口封装               │
│   │  │   ├── request.js           ← ★统一请求 (baseUrl 可配)│
│   │  │   ├── ws-client.js         ← ★WebSocket 客户端     │
│   │  │   └── modules\             ← cardDb/orders/listings │
│   │  ├── utils\                   ← 工具函数/业务逻辑       │
│   │  └── components\              ← 公共组件               │
│   │  └─────────────────────────────────────────────────────┘
│   │
│   │  ┌─────────────────────────────────────────────────────┐
│   │  │ UI 展示层 (按端差异化，改颜色/位置不影响接口)          │
│   │  ├── pages\                   ← 通用页面（四端共用）     │
│   │  │   ├── index\               ← 首页                  │
│   │  │   ├── login\               ← 登录                  │
│   │  │   ├── upload\              ← 拍照识别/批量识别       │
│   │  │   ├── inventory\           ← 库存                  │
│   │  │   ├── master-library\      ← 主库                  │
│   │  │   ├── auto-listing\        ← 一键上架（远程触发）     │
│   │  │   ├── order\               ← 订单处理               │
│   │  │   ├── device\              ← 设备连接               │
│   │  │   └── admin\               ← 管理后台               │
│   │  │                                                   │
│   │  ├── pages-pc\                ← PC 专属页面 (#ifdef H5)│
│   │  │   ├── listing-host\        ← ★执行主机面板          │
│   │  │   └── dashboard\           ← 宽屏总览               │
│   │  │                                                   │
│   │  └── pages-mp\                ← ★小程序专属页面         │
│   │      ├── index\               ←   小程序首页(独立配色)  │
│   │      └── ...                  ←   布局/颜色单独维护     │
│   │  └─────────────────────────────────────────────────────┘
│   │
│   └── static\                     ← 静态资源 (图标/logo)
│
└── dist\                           ← 编译产物
    ├── h5\                         ← 网页 (PC 响应式 + 移动共用)
    ├── app\                        ← APK 资源
    └── mp-weixin\                  ← 微信小程序
```

#### 4.2.1 端专属页面怎么区分（三种做法按需选）

| 差异程度 | 做法 | 说明 |
|---------|------|------|
| 换个颜色/间距/位置 | 条件编译 `#ifdef MP-WEIXIN` | 同一文件内写一小段小程序专属样式 |
| 整个页面布局都不同 | 端专属目录 `pages-mp\` | 小程序独立一套页面，`pages.json` 按端指向不同目录 |
| 完全独立项目 | 单独建仓库 | 不推荐，接口要重写 |

#### 4.2.2 为什么接口数据不受影响

前后端已通过 **API 解耦**：四端都调同一套 `/v1/api/...`，返回数据结构一致。
UI 层改颜色/移位置只动展示，**碰不到接口和数据结构**。

```
共享层 (api/utils/components)  ← 一份，四端一致，不动
UI 层 (pages / pages-pc / pages-mp)  ← 按端独立，随意改
```

---

### 4.3 `Host\` — 一键上架执行主机

> 从旧 `listing-agent-vm\` 抽出独立，在雷电模拟器执行上架流程。

```
Host\
├── package.json                    ← 依赖 (child_process 调 adb, ws)
├── src\
│   ├── index.js                    ← 主机入口 (订阅队列→执行→回写)
│   ├── screen.js                   ← ADB 屏幕操作 (tap/input/swipe/dump/clipper)
│   ├── executor.js                 ← 流程执行器
│   ├── adb.js                      ← ADB 命令封装 (→ localhost:5555)
│   └── reporter.js                 ← 结果回写 + 进度上报 (→ backend WS)
├── flows\                          ← VM 流程模板副本
├── adb\                            ← ADB 工具包
└── start.bat                       ← 启动主机
```

---

### 4.4 `Storage\` — 运行时数据

```
Storage\
├── mongo\                          ← ★MongoDB 业务数据 (dbpath，不能删，可备份)
├── cache\                          ← 缓存（预留）
│   ├── card-images\                ← 卡图缓存
│   └── thumbnails\                 ← 缩略图缓存
├── uploads\                        ← 上传
│   ├── avatars\                    ← 头像
│   └── order-photos\               ← 订单拍照
├── logs\                           ← 日志
│   ├── backend.log
│   └── pc-host.log
└── card-catalog\                   ← 卡牌目录缓存
```

> **Storage 内三类数据要分清**：
> - `mongo\` —— **正式业务数据**（用户/库存/订单），不能删，是备份重点
> - `cache\` / `card-catalog\` —— 缓存，删了自动重建
> - `uploads\` / `logs\` —— 上传与日志，按需保留
>
> 卡图**原图**在外部 `TCG_Database`（不能删），**缓存**在 `Storage\cache`（可重建）。

---

### 4.5 `Deploy\` — 部署

```
Deploy\
├── start.bat                       ← 一键启动 (MongoDB→后端→主机)
├── stop.bat                        ← 一键停止
├── backup.bat                      ← 备份 (Storage\mongo + 配置)
├── nginx\                          ← Phase3 HTTPS 反代
└── ddns\                           ← Phase2 动态域名说明
```

> **MongoDB 启动方式**：mongod 的 `--dbpath` 指向 `Storage\mongo\`。
> ```
> mongod --dbpath "D:\Project\S-LAN\Code\V1.1\Storage\mongo" --port 27017
> ```
> 业务数据全部落在 `Storage\mongo\`，随整合包走，备份时连同 `Storage\mongo` 一起 dump。

### 4.6 `Docs\` — 文档

```
Docs\
├── ARCHITECTURE.md                 ← 本文档
├── API.md                          ← API 接口文档
├── DEPLOY.md                       ← 部署三阶段 (局域网→DDNS→HTTPS/小程序)
└── MIGRATION.md                    ← 迁移清单
```

---

## 五、数据流关系图

```
┌──────────────────────── 代码 (V1.1\ 内) ────────────────────────┐
│                                                                  │
│  Client (uni-app)       Server (Express :3001)  Host │
│  ┌──────────────┐           ┌─────────────────────┐    ┌──────┐  │
│  │ PC 网页       │──HTTP/WS─►│ 路由→服务→模型       │◄───│ 执行 │  │
│  │ 移动网页      │           │  WS 状态同步中心      │调度│ 主机 │  │
│  │ APP (APK)    │           └─────────┬───────────┘    └──┬───┘  │
│  │ 微信小程序    │                     │                   │      │
│  └──────────────┘                     ▼                   ▼      │
└───────────────────────────┬──────────────────┬──────────────────┘
                            │ MongoDB          │ 操作雷电模拟器
                            ▼                  ▼
                  ┌─────────────────┐  ┌────────────────┐
                  │ MongoDB :27017  │  │ 雷电模拟器(集换社)│
                  └─────────────────┘  └────────────────┘

┌──────────── 数据资产 (外部引用, 不复制) ────────────┐
│  V1.1 TCG_Database\                                 │
│  ├── data\TCG_ID_Database\    卡牌 JSON            │
│  └── data\TCG_Image_Database\ 卡图原图              │
│  旧 V1.0.1\TCG_Database\      缩略图                │
└────────────────────────────────────────────────────┘

┌──────────── 运行时数据 (Storage\, 可重建) ──────┐
│  cache\ / uploads\ / logs\ / card-catalog\          │
└─────────────────────────────────────────────────────┘
```

---

## 六、迁移对照表（V1.0.1 → V1.1）

| 旧位置 (V1.0.1) | 新位置 (V1.1) | 说明 |
|-----------------|---------------|------|
| `S-LAN-Local\backend\src\` | `Server\src\` | 后端整体迁移 |
| `S-LAN-Local\backend\src\routes\listing-agent-vm\` | `Host\src\` | 执行器抽成主机 |
| `FE-Work\src\` | `Client\src\` | 前端迁移 + 四端扩展 |
| `S-LAN-Local\frontend\` | `Client\dist\h5\` | 编译产物 |
| `S-LAN-Local\data\` | `Storage\` | 缓存/上传/日志 |
| `S-LAN-Local\backend\.env` | `Server\.env` | 配置 |
| （不动） | `V1.1 TCG_Database\` | 卡牌数据+卡图，只改 tcg-paths.json |

---

> **NOTE**: 命名已统一为 `TCG_` 前缀，目录关系（代码/数据/图片/缓存）已分清。
> 确认后即可开始建目录、迁移代码。
