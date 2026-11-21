# 环境要求

## 运行本系统需要

| 组件 | 版本/说明 | 状态 |
|------|-----------|------|
| Node.js | 18+ (npm 自带) | 需安装 |
| MongoDB | Community 8.x (mongod 在 PATH 或已装服务) | 需安装 |
| 雷电模拟器 | LDPlayer9 (一键上架执行用) | 需安装 |
| 集换社 APP | 装在雷电模拟器里 | 需安装 |
| ADB | 雷电自带 (dnconsole/adb.exe) | 随雷电 |

## 可选（后期阶段）

| 组件 | 用途 |
|------|------|
| HBuilderX | APP(APK) 云打包 |
| 微信开发者工具 | 小程序调试与上传 |
| nginx | Phase3 HTTPS 反代 |
| DDNS (花生壳/路由器) | Phase2 外网访问 |

## 目录依赖

- `Storage\mongo\` — MongoDB 数据目录（首次运行前用 `Deploy\migrate-mongo.bat` 迁移）
- `Storage\tcg-data\` — 卡图/卡牌数据资产（images\OCG、images\YGOPro、images\Thumbnails、id-data\JP-YuGiOh），路径见 `Server\src\config\tcg-paths.json`
- MongoDB 数据库工具（mongodump）— 备份功能需要，见 `Deploy\backup.bat` 提示

## 端口占用

| 端口 | 服务 |
|------|------|
| 28018 | MongoDB (V1.2 开发版独立实例) |
| 4002 | S-LAN 后端 (含前端网页) |
| 6001 | 拍照控制台 (Device) |
| 5555 | 雷电模拟器 ADB |

> V1.2 是 V1.1 的开发副本，已整体错开端口，两版可同时运行互不干扰。
> V1.1 正式版占用 27017 / 3001 / 5000。

## 安全说明

- `.env` 中的 `JWT_SECRET` 已随机生成，缺失或为默认值后端会拒绝启动
- 上架代理等敏感接口已要求登录，公开接口仅剩查询类只读接口
