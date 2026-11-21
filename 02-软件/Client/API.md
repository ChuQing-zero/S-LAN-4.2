# 萌兽潮玩动漫店 — 前端对接文档

> 本文档基于当前后端实现编写，包含所有接口的请求方式、成功/失败返回值，可直接复制给前端对接。

---

## 一、基础配置

| 项目 | 值 |
|------|-----|
| 服务地址（开发） | `http://<host>:8080` |
| API 前缀（推荐） | `/v1/api` |
| API 前缀（兼容） | `/api` |
| Content-Type | `application/json`（文件上传除外） |
| 认证方式 | Bearer Token |

### 请求头（所有业务接口必填）

```
Authorization: Bearer <token>
Content-Type: application/json
```

> 当前后端仅校验 Token 格式为 `Bearer xxx`，`xxx` 可为任意非空字符串（如 `test`）。

### 前端 axios 配置示例

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://<host>:8080/v1/api',
  headers: {
    Authorization: 'Bearer test',
    'Content-Type': 'application/json',
  },
});

export default api;
```

---

## 二、通用错误响应

所有接口在失败时统一返回 JSON：

```json
{
  "error": "错误描述"
}
```

| HTTP 状态码 | 含义 | 触发场景 |
|-------------|------|----------|
| 400 | 参数错误 | 缺少必填参数、请求体不合法 |
| 401 | 未授权 | 未携带 `Authorization` 或格式不正确 |
| 404 | 资源不存在 | 库/卡牌/用户不存在、路径错误 |
| 409 | 冲突 | 创建已存在的库 |
| 500 | 服务器错误 | 数据库异常等内部错误 |

### 401 示例

```json
{
  "error": "Unauthorized"
}
```

### 404 示例（路径错误）

```json
{
  "error": "Not found"
}
```

---

## 三、公共数据结构

### Card 卡牌对象

```typescript
interface Card {
  id: number;           // 卡牌ID
  jpName: string;       // 日文名
  cnName: string;       // 中文名
  code: string;         // 卡牌编号，如 QCAC-JP059
  rarity: string;       // 罕贵度，如 QCSER
  condition: string;    // 品相，如 9品
  serial: string;       // 库序号，如 A001-0001
  img: string;          // 图片URL
  libraryCode: string;  // 所属库编号
  versionId: number;    // 游戏版本ID
}
```

### Library 库简要对象

```typescript
interface LibraryBrief {
  code: string;       // 库编号，如 A001
  cardCount: number;  // 卡牌数量
}
```

### Library 库详情对象

```typescript
interface LibraryDetail {
  code: string;
  id: string;         // 库ID，如 MX00000001
  name: string;
  type: 'local' | 'cloud';
  cardCount: number;
}
```

### Grade 品相对象

```typescript
interface Grade {
  name: string;
  desc: string;
  hasSub: boolean;    // 是否有子选项（评级卡、自定义）
}
```

---

## 四、接口列表

### 0. 健康检查（无需 Token）

```
GET /health
```

**成功 200**
```json
{
  "status": "ok"
}
```

---

### 1. 获取用户信息

```
GET /v1/api/user/profile
```

**请求参数**：无

**成功 200**
```json
{
  "id": "001",
  "name": "萌兽潮玩动漫店",
  "role": "admin",
  "avatar": "/static/icons/ic_avatar.png"
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "User not found" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
const { data } = await api.get('/user/profile');
```

---

### 2. 获取游戏版本列表

```
GET /v1/api/versions
```

**请求参数**：无

**成功 200**
```json
{
  "list": [
    { "id": 1, "name": "游戏王日文", "lang": "日文", "logo": "/static/icons/version_logos/logo_yugioh_jp.png" },
    { "id": 2, "name": "游戏王简中", "lang": "简中", "logo": "/static/icons/version_logos/logo_yugioh_cn.png" },
    { "id": 3, "name": "游戏王英文", "lang": "英文", "logo": "/static/icons/version_logos/logo_yugioh_en.png" },
    { "id": 4, "name": "游戏王测试", "lang": "测试", "logo": "/static/icons/version_logos/logo_yugioh_test.png" },
    { "id": 5, "name": "宝可梦日文", "lang": "日文", "logo": "/static/icons/version_logos/logo_pokemon_jp.png" },
    { "id": 6, "name": "宝可梦简中", "lang": "简中", "logo": "/static/icons/version_logos/logo_pokemon_cn.png" },
    { "id": 7, "name": "宝可梦英文", "lang": "英文", "logo": "/static/icons/version_logos/logo_pokemon_en.png" },
    { "id": 8, "name": "宝可梦繁中", "lang": "繁中", "logo": "/static/icons/version_logos/logo_pokemon_tw.png" }
  ]
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
const { data } = await api.get('/versions');
```

---

### 3. 获取本地库列表

```
GET /v1/api/libraries/local
```

**请求参数**：无

**成功 200**
```json
{
  "list": [
    { "code": "A001", "cardCount": 10 },
    { "code": "A002", "cardCount": 60 },
    { "code": "A003", "cardCount": 120 }
  ]
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
const { data } = await api.get('/libraries/local');
```

---

### 4. 获取云端库列表

```
GET /v1/api/libraries/cloud
```

**请求参数**：无

**成功 200**
```json
{
  "list": [
    { "code": "A001", "cardCount": 50 },
    { "code": "A002", "cardCount": 30 },
    { "code": "A010", "cardCount": 66 }
  ]
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
const { data } = await api.get('/libraries/cloud');
```

---

### 5. 获取库详情

```
GET /v1/api/libraries/:code
```

**路径参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | 库编号，如 A001 |

**Query 参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| type | string | 否 | local | `local` 或 `cloud` |

**成功 200**
```json
{
  "code": "A001",
  "id": "MX00000001",
  "name": "A001",
  "type": "local",
  "cardCount": 10
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "Library not found" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
// 本地库详情
const { data } = await api.get('/libraries/A001');

// 云端库详情
const { data } = await api.get('/libraries/A001', { params: { type: 'cloud' } });
```

---

### 6. 创建新库

```
POST /v1/api/libraries
```

**请求体**

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| type | string | 否 | local | `local` 或 `cloud` |
| name | string | 是 | — | 库名称/编号，如 A021 |

```json
{
  "type": "local",
  "name": "A021"
}
```

**成功 201**
```json
{
  "code": "A021",
  "id": "MX00000021",
  "cardCount": 0
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 400 | `{ "error": "name is required" }` |
| 401 | `{ "error": "Unauthorized" }` |
| 409 | `{ "error": "Library already exists" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
const { data } = await api.post('/libraries', {
  type: 'local',
  name: 'A021',
});
```

---

### 7. 更新库设置

```
PUT /v1/api/libraries/:code
```

**路径参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | 库编号 |

**Query / Body 参数**

| 参数 | 位置 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|------|--------|------|
| name | body | string | 是 | — | 新库名 |
| type | query 或 body | string | 否 | local | `local` 或 `cloud` |

```json
{
  "name": "新库名"
}
```

**成功 200**
```json
{
  "code": "A001",
  "id": "MX00000001",
  "name": "新库名",
  "type": "local",
  "cardCount": 10
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 400 | `{ "error": "name is required" }` |
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "Library not found" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
const { data } = await api.put('/libraries/A001', { name: '新库名' });
```

---

### 8. 获取库中卡牌列表

```
GET /v1/api/libraries/:code/cards
```

**路径参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | 库编号 |

**Query 参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| type | string | 否 | local | `local` 或 `cloud` |
| rarity | string | 否 | — | 罕贵度筛选 |
| condition | string | 否 | — | 品相筛选 |
| versionId | number | 否 | — | 游戏版本ID |
| page | number | 否 | 1 | 页码 |
| pageSize | number | 否 | 20 | 每页条数 |

**成功 200**
```json
{
  "list": [
    {
      "id": 1,
      "jpName": "閃刀術式－アフターバーナー",
      "cnName": "闪刀术式-后燃器",
      "code": "QCAC-JP059",
      "rarity": "QCSER",
      "condition": "9品",
      "serial": "A001-0008",
      "img": "https://cdn.example.com/cards/qcac-jp059.png",
      "libraryCode": "A001",
      "versionId": 1
    }
  ],
  "total": 8,
  "page": 1,
  "pageSize": 20
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 500 | `{ "error": "..." }` |

> 库不存在时返回空列表 `{ "list": [], "total": 0, ... }`，不返回 404。

**调用示例**
```javascript
const { data } = await api.get('/libraries/A001/cards', {
  params: {
    type: 'local',
    rarity: 'QCSER',
    condition: '9品',
    versionId: 1,
    page: 1,
    pageSize: 20,
  },
});
```

---

### 9. 搜索卡牌

```
GET /v1/api/cards/search
```

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 关键词（匹配日文名、中文名、编号、序号） |
| libraryCode | string | 否 | 限定库编号 |
| type | string | 否 | `local` 或 `cloud` |

**成功 200**
```json
{
  "list": [
    {
      "id": 1,
      "jpName": "閃刀術式－アフターバーナー",
      "cnName": "闪刀术式-后燃器",
      "code": "QCAC-JP059",
      "rarity": "QCSER",
      "condition": "9品",
      "serial": "A001-0008",
      "img": "https://cdn.example.com/cards/qcac-jp059.png",
      "libraryCode": "A001",
      "versionId": 1
    }
  ]
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 400 | `{ "error": "q is required" }` |
| 401 | `{ "error": "Unauthorized" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
const { data } = await api.get('/cards/search', {
  params: { q: '閃刀', libraryCode: 'A001', type: 'local' },
});
```

---

### 10. 创建卡牌（拍照识别后入库）

```
POST /v1/api/cards
```

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| libraryCode | string | 是 | 目标本地库编号 |
| jpName | string | 否 | 日文名 |
| cnName | string | 否 | 中文名 |
| code | string | 否 | 卡牌编号 |
| rarity | string | 否 | 罕贵度 |
| condition | string | 否 | 品相 |
| versionId | number | 否 | 游戏版本ID |

```json
{
  "libraryCode": "A001",
  "jpName": "閃刀姫－レイ",
  "cnName": "闪刀姬-零",
  "code": "QCAC-JP059",
  "rarity": "QCSER",
  "condition": "9品",
  "versionId": 1
}
```

**成功 201**
```json
{
  "id": 9,
  "serial": "A001-0009",
  "img": "https://cdn.example.com/cards/qcac-jp059.png"
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 400 | `{ "error": "libraryCode is required" }` |
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "Local library not found" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
const { data } = await api.post('/cards', {
  libraryCode: 'A001',
  jpName: '閃刀姫－レイ',
  cnName: '闪刀姬-零',
  code: 'QCAC-JP059',
  rarity: 'QCSER',
  condition: '9品',
  versionId: 1,
});
```

---

### 11. 删除卡牌

```
DELETE /v1/api/cards/:id
```

**路径参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | number | 是 | 卡牌ID |

**成功 200**
```json
{
  "success": true
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "Card not found" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
const { data } = await api.delete('/cards/9');
```

---

### 12. 上传到云端库（本地 → 云端）

```
POST /v1/api/libraries/transfer/upload
```

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| fromCode | string | 是 | 源本地库编号 |
| toCode | string | 是 | 目标云端库编号 |
| cardIds | number[] | 是 | 要转移的卡牌ID列表 |

```json
{
  "fromCode": "A001",
  "toCode": "A001",
  "cardIds": [1, 2, 3]
}
```

**成功 200**
```json
{
  "success": true
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 400 | `{ "error": "fromCode, toCode and cardIds are required" }` |
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "Source library not found" }` |
| 404 | `{ "error": "Target library not found" }` |
| 404 | `{ "error": "No cards found to transfer" }` |
| 500 | `{ "error": "..." }` |

> 转移逻辑：将卡牌从源库复制到目标库（生成新 ID 和序号），并删除源库中的原卡牌。

**调用示例**
```javascript
const { data } = await api.post('/libraries/transfer/upload', {
  fromCode: 'A001',
  toCode: 'A001',
  cardIds: [1, 2, 3],
});
```

---

### 13. 下载到本地库（云端 → 本地）

```
POST /v1/api/libraries/transfer/download
```

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| fromCode | string | 是 | 源云端库编号 |
| toCode | string | 是 | 目标本地库编号 |
| cardIds | number[] | 是 | 要转移的卡牌ID列表 |

```json
{
  "fromCode": "A001",
  "toCode": "A001",
  "cardIds": [1, 2, 3]
}
```

**成功 200**
```json
{
  "success": true
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 400 | `{ "error": "fromCode, toCode and cardIds are required" }` |
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "Source library not found" }` |
| 404 | `{ "error": "Target library not found" }` |
| 404 | `{ "error": "No cards found to transfer" }` |
| 500 | `{ "error": "..." }` |

**调用示例**
```javascript
const { data } = await api.post('/libraries/transfer/download', {
  fromCode: 'A001',
  toCode: 'A001',
  cardIds: [1, 2, 3],
});
```

---

### 14. 获取罕贵度列表

```
GET /v1/api/rarities
```

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| versionId | number | 否 | 游戏版本ID（当前实现忽略，统一返回全量列表） |

**成功 200**
```json
{
  "list": [
    "20SER", "QCSER", "PSER", "HR", "HPR", "ESR", "ESPR", "SER",
    "SEMR", "SEPR", "PR", "UPR", "PGR", "GSER", "GMR", "GR",
    "UTR", "CR", "UR", "RR", "USR", "UMR", "SR", "SPR",
    "NPR", "NMR", "NKC", "R", "RKC", "RPR", "N", "NR"
  ]
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |

**调用示例**
```javascript
const { data } = await api.get('/rarities', { params: { versionId: 1 } });
```

---

### 15. 获取品相列表

```
GET /v1/api/grades
```

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| versionId | number | 否 | 游戏版本ID（当前实现忽略，统一返回全量列表） |

**成功 200**
```json
{
  "list": [
    { "name": "99品", "desc": "完美全新", "hasSub": false },
    { "name": "9品", "desc": "近新优品", "hasSub": false },
    { "name": "78品", "desc": "标准流通", "hasSub": false },
    { "name": "56品", "desc": "中小瑕疵", "hasSub": false },
    { "name": "34品", "desc": "重大次品", "hasSub": false },
    { "name": "评级卡", "desc": "", "hasSub": true },
    { "name": "自定义", "desc": "", "hasSub": true }
  ]
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |

**调用示例**
```javascript
const { data } = await api.get('/grades', { params: { versionId: 1 } });
```

---

### 16. 获取评级卡子选项

```
GET /v1/api/grades/psa
```

**请求参数**：无

**成功 200**
```json
{
  "list": [
    "PSA 10", "PSA 9", "PSA 8", "PSA 7", "PSA 6",
    "PSA 5", "PSA 4", "PSA 3", "PSA 2", "PSA 1"
  ]
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |

**调用示例**
```javascript
const { data } = await api.get('/grades/psa');
```

---

### 17. 拍照识别卡牌

```
POST /v1/api/vision/recognize
```

**Content-Type**：`multipart/form-data`（不是 JSON）

**表单字段**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| image | File | 是 | 卡牌照片 |
| versionId | number/string | 否 | 游戏版本ID |

**成功 200**
```json
{
  "jpName": "閃刀姫－レイ",
  "cnName": "闪刀姬-零",
  "code": "QCAC-JP059",
  "rarity": "QCSER",
  "confidence": 0.95
}
```

**失败**

| 状态码 | 响应 |
|--------|------|
| 400 | `{ "error": "image is required" }` |
| 401 | `{ "error": "Unauthorized" }` |

> 当前为模拟识别，固定返回示例数据。

**调用示例**
```javascript
const formData = new FormData();
formData.append('image', file);       // file 为 File 对象
formData.append('versionId', '1');

const { data } = await api.post('/vision/recognize', formData, {
  headers: {
    'Content-Type': 'multipart/form-data',
    Authorization: 'Bearer test',
  },
});
```

---

## 五、接口汇总表

| 序号 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 0 | GET | `/health` | 健康检查（无需 Token） |
| 1 | GET | `/v1/api/user/profile` | 用户信息 |
| 2 | GET | `/v1/api/versions` | 游戏版本列表 |
| 3 | GET | `/v1/api/libraries/local` | 本地库列表 |
| 4 | GET | `/v1/api/libraries/cloud` | 云端库列表 |
| 5 | GET | `/v1/api/libraries/:code` | 库详情 |
| 6 | POST | `/v1/api/libraries` | 创建新库 |
| 7 | PUT | `/v1/api/libraries/:code` | 更新库设置 |
| 8 | GET | `/v1/api/libraries/:code/cards` | 库中卡牌列表 |
| 9 | GET | `/v1/api/cards/search` | 搜索卡牌 |
| 10 | POST | `/v1/api/cards` | 创建卡牌 |
| 11 | DELETE | `/v1/api/cards/:id` | 删除卡牌 |
| 12 | POST | `/v1/api/libraries/transfer/upload` | 上传到云端 |
| 13 | POST | `/v1/api/libraries/transfer/download` | 下载到本地 |
| 14 | GET | `/v1/api/rarities` | 罕贵度列表 |
| 15 | GET | `/v1/api/grades` | 品相列表 |
| 16 | GET | `/v1/api/grades/psa` | 评级卡子选项 |
| 17 | POST | `/v1/api/vision/recognize` | 拍照识别 |

---

## 六、前端错误处理建议

```javascript
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.error || '网络错误';

    switch (status) {
      case 401:
        // 跳转登录或刷新 Token
        break;
      case 404:
        // 资源不存在提示
        break;
      case 400:
        // 参数校验提示
        break;
      default:
        // 通用错误提示
        break;
    }

    return Promise.reject(new Error(message));
  }
);
```

---

## 七、注意事项

1. **baseURL 必须包含 `/v1/api`**，不能只配 `/` 或 `/v1`。
2. **所有业务接口都需要 `Authorization: Bearer <token>`**。
3. **路径兼容**：`/api/...` 与 `/v1/api/...` 均可访问，推荐统一使用 `/v1/api`。
4. **库类型区分**：查询云端库时需传 `type=cloud`（库详情、卡牌列表）。
5. **创建卡牌仅支持本地库**，`libraryCode` 必须对应已存在的本地库。
6. **转移操作会删除源库卡牌**，前端操作前建议二次确认。
