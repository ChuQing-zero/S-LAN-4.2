# 部署三阶段

## Phase 1 — 局域网（当前）

```
PC (Server :3001 + 雷电模拟器)
手机/平板 ──同一WiFi──► http://192.168.x.x:3001
```

- 启动：`Deploy\start.bat`
- 手机浏览器直接访问启动横幅里显示的「局域网访问」地址
- APP(APK)：打包时在 `Client\.env.app` 填写该地址（见 `Docs\APP_BUILD.md`）

## Phase 2 — DDNS + 端口转发

```
PC ──动态公网IP──► DDNS 域名 (如 s-lan.xxx.com) ──路由器端口映射──► :3001
外网手机 ──► http://s-lan.xxx.com:3001
```

- 路由器设置端口转发（内网 3001 → 公网 3001）
- DDNS 服务（路由器自带 / 花生壳 / ddns-go）
- APP：改 `Client\.env.app` 的 baseUrl 为域名后重新打包（一次即可，IP 变动不再需要重打）

## Phase 3 — HTTPS + 微信小程序

```
nginx (443, 证书) ──反代──► Server :3001
小程序 ──https/wss──► 域名
```

- 需要：备案域名 + HTTPS 证书（Let's Encrypt 免费）
- nginx 配置参考（部署时创建 `Deploy\nginx\nginx.conf`）
- 小程序 `Client\src\manifest.json` 填 mp-weixin appid + 微信公众平台配置服务器域名白名单
- 注意：微信小程序强制 HTTPS + 备案域名，WebSocket 用 wss
