# 数据快照 V1.2.96 —— 与 git 标签 `v1.2.96` 一一对照

这份快照和 git 标签 **`v1.2.96`（最终版）是同一个时点的两半**：标签记的是**代码**，
这里存的是那一刻的**整库数据**。要还原「V1.2.96 那天的完整现场」，两样一起用。

| | |
|---|---|
| 对应代码版本 | `v1.2.96`（根目录 `VERSION` = `1.2.96`） |
| 数据库 | `s-lan-local`（MongoDB，端口 27018） |
| 快照时间 | 2026-10-03 00:14（本地时间） |
| 来源备份目录 | `Storage\backup\20261003-001452` |
| 归档文件 | `Storage\backup\20261003-001452\s-lan-local.mongodump.tar.gz`（**在库外，不进 git**） |
| SHA256 | `921760ee7fa89acc675961a6f31d1741f74a861cca4c5ab7e2a20518b8d64533` |
| 大小 | 5.0 MB（压缩后）／ 42 MB（展开） |

> **为什么清单在 git 里、数据不在**：这份归档含 `users` 密码哈希与 `apikeys` 令牌，
> 提交进 git 会永久留在历史里、以后要清很麻烦（`Storage\` 本来也整片在 gitignore 内）。
> 所以采用「**标签记代码 + 清单记指纹 + 数据留在库外**」的对照方式：
> `v1.2.96` 这个标签对应的是**下面这行 SHA256**，拿到任何一份声称是 V1.2.96 的 dump，
> 算一遍 sha256 跟它比就知道是不是同一份。
>
> 校验命令：`sha256sum Storage/backup/20261003-001452/s-lan-local.mongodump.tar.gz`
> —— 应当输出上面那串。对不上就说明不是这一版。

## 怎么还原

```bash
# 1. 展开
tar -xzf s-lan-local.mongodump.tar.gz        # 得到 mongodump/ 与 config/

# 2. 灌回数据库（--drop 会先清库，确认好再用）
"D:\App\mongodb\mongodb-win32-x86_64-windows-8.0.5\bin\mongorestore.exe" \
  --host 127.0.0.1 --port 27018 --drop "mongodump"
```

也可以用管理后台「备份管理」——把 `Storage\backup\20261003-001452` 留在原处即可，
它已经出现在列表里（列表按「有没有 `mongodump\<库名>` 子目录」筛）。

## 这一版数据的来历（V1.2.96 = V1.1 最后版本的库表）

这一版把库管理数据从 V1.1 迁移过来，范围只有「一键上架 + 本地库 + 云端库」：

- 撤回上架批次 `26-10-2-2`：删掉 `listingqueues` 里属于它的 **8564 行**，
  并按 snapshot 把 **1588 条** `stockcodes` 还原成 `status=pending` / `listingBatchId=null`
- 删掉 `A0-053-01` 的 12 张、`A0-053-02` 和 `A0-053-03` 各 1 张共 **14 张卡**，
  三个库的计数回到 V1.1 的 `14 / 18 / 25`
- **未动**目录数据（`cardcatalogs` / `carduniques` / `cardmarks` 是 V1.2 比 V1.1 更全的部分，绝不能被覆盖）

已知的两处残留差异（都刻意保留）：

- `A0-002-02` 是 20 张（V1.1 是 21）—— V1.2 里少的那张在 V1.1 之外，补不回来
- `listedcards` / `listedsummaries` 各 1 条（手工上架的 `QCAC-JP001`），不挂在任何库上，撤回不收回

## 各集合条数

| 集合 | 条数 | | 集合 | 条数 |
|---|---:|---|---|---:|
| `cards` | 38752 | | `cardmarks` | 92 |
| `stockcodes` | 1620 | | `carduniques` | 13886 |
| `cardcatalogs` | 39401 | | `tasknotes` | 51 |
| `visionusagelogs` | 40539 | | `listingbatches` | 2 |
| `users` | 4 | | `listedcards` | 1 |
| `apikeys` | 2 | | `listedsummaries` | 1 |
| `invitecodes` | 3 | | `missingcodes` | 1 |
| `listingqueues` | 0 | | `libraries` | 0 |
| `orders` / `order_cards` / `order_picks` / `order_photos` | 0 | | `versions` / `version_configs` / `unknowncodes` | 0 |

## ⚠️ 归档里有什么（它不在 git 里，但在你机器上）

`mongodump` 是**整库导出**，含 `users`（密码哈希）、`apikeys`（API 令牌）、`invitecodes`。
另外 `config/` 是 `Server\src\config` 的副本（无密钥）。

**不含** `Server\.env`（JWT_SECRET）、`Client\certs\*`、任何图片目录
（`Storage\tcg-data`、`Server\uploads\orig` 都不在内）。

将来做上传网盘的那个整包时注意：**它会把上面这些一起带走**，网盘那边请设访问权限。
（图片要一起搬的话，得另外单独打包 —— 见 README 的「外部数据」一节。）
