# APP (APK) 打包方法 — S-LAN V2.0

> 本项目的 APP 由 uni-app 项目 (`Client\`) 打包生成。有两种方式：云打包（推荐，简单）和本地离线打包（复杂，需要 Android Studio）。

---

## 方式一：HBuilderX 云打包（推荐）

### 前置准备

1. **安装 HBuilderX**（用 App 开发版）：https://www.dcloud.io/hbuilderx.html
2. **注册 DCloud 账号**：https://dev.dcloud.net.cn（打包时需要登录）

### 第一步：配置 appid（重要，缺失无法打包）

打开 `Client\src\manifest.json`：

1. 点击 manifest.json → 「基础配置」
2. 点击「DCloud appid」输入框旁的**「重新获取」**——用 DCloud 账号登录后会自动生成一个 appid（形如 `__UNI__XXXXXXX`）
3. 填入应用名称（如 S-LAN）、版本号

### 第二步：配置服务器地址

APP 无法自动获取局域网 IP，需要在打包前写死服务器地址。

创建 `Client\.env.app`：
```
# APP 构建专用配置
VITE_API_BASE_URL=http://192.168.1.100:3001/v1/api
VITE_WS_URL=ws://192.168.1.100:3001/ws
```
> ⚠️ 把 `192.168.1.100` 换成你电脑的实际局域网 IP（后端启动横幅会显示）。

### 第三步：打包

1. 在 HBuilderX 中：文件 → 打开目录 → 选择 `Client\` 文件夹
2. 菜单：发行 → 原生App-云打包
3. 选择 Android
4. 证书：首次打包选择「使用公共测试证书」（正式发布再申请自有证书）
5. 等待云端打包完成（约 5-10 分钟）→ 下载 APK

### 第四步：安装测试

- 把 APK 传到手机安装
- 手机和电脑连**同一个 WiFi**
- 打开 APP → 登录即可使用

---

## 方式二：CLI 本地打包（备选）

```
cd Client
npm install
npx @dcloudio/uvm@latest   # 更新 uni-app 编译器
npm run build:app          # 生成 app 资源 (dist/build/app)
```

产物需配合 HBuilderX 或 Android Studio 离线打包，步骤复杂，不推荐首次使用。

---

## 常见问题

| 问题 | 解决 |
|------|------|
| 打包时提示 appid 为空 | manifest.json 基础配置里「重新获取」appid |
| APP 打开接口全挂 | 检查 `.env.app` 的 VITE_API_BASE_URL 是否为电脑局域网 IP；手机和电脑是否同一 WiFi |
| 服务器地址变了怎么办 | 改 `.env.app` 重新打包（所以建议尽快上 DDNS 域名，之后 IP 变也不用重新打包） |
| 正式发布 | 申请自有 Android 证书（云打包证书管理里可生成），签名一致才能覆盖安装升级 |

---

## 推荐流程（上云前）

```
现在 (局域网): 按上面步骤打包 → 手机装 APK → 局域网使用
Phase 2 (DDNS): .env.app 改成域名 → 重新打包一次 → 以后 IP 变动不用再打包
Phase 3 (HTTPS): 域名换 https → 重新打包
```
