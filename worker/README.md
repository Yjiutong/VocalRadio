# 术力口电台后端 · Worker + D1

> **这是「方案 A（可选）」，当前线上不用它。**
> 默认方案是仓库根目录的 `functions/api/`（Pages Functions），和页面一起部署、
> 同源、加接口不用进后台。两者读写同一张 D1 表、接口路径完全一致，
> 切换只改 `assets/main.js` 的 `API_BASE`：`""` = Pages Functions，`"https://likes.yunjiutong.cn"` = 本 Worker。
> **除非你确定要独立域名，否则不用管这个目录，只要执行 `schema.sql` 建表即可。**

`likes.yunjiutong.cn` 的实现，**只负责点赞 / 播放计数**。

## 歌单不在数据库里

歌单是仓库根目录的 [`playlist.txt`](../playlist.txt)（JSON 数组）：

- 网页播放器**直接读这个文件**，不经过接口；
- `netease-downloader/` 下载器负责维护它，加歌自动续号并写回；
- 推送仓库 → Pages 自动部署 → 歌单即刻更新。

所以**新增歌曲不需要碰 Cloudflare 后台，也不需要写 D1**。

## 为什么用 D1 而不是 KV

不是性能调优，是正确性问题：

| 问题 | KV 实现 | 后果 |
|---|---|---|
| 点赞丢数 | `get → +1 → put` | KV 无原子自增。50 次并发实测**只剩 1**（丢 49） |
| 写死限流 | 同一 key **1 次写/秒**（平台硬限制） | 热门歌连点几下就写不进去 |
| 写额度打满 | `/api/play` 每首歌加载写一次 | KV 免费 **1,000 写/天**，听 1000 首当天点赞全失败 |
| N+1 查询 | `allLikes` 逐首 `kv.get` | 23 首歌 = 23 次串行读 |
| key 无校验 | 任意 `?key=` 都能建记录 | 命名空间无界增长，可被刷 |

D1 免费额度是 **读 500 万行/天、写 10 万行/天**，且
`INSERT ... ON CONFLICT DO UPDATE SET likes = likes + 1` 一条语句原子完成。

## 数据结构

只有一张计数表（见 `schema.sql`）。**行按需创建**：没人点过的歌不占一行。

```sql
songs(filename PK, likes, plays, updated_at)
```

## 接口

| 接口 | 返回 |
|---|---|
| `GET /api/like?key=` | `{ key, count }`（首次点赞自动建行） |
| `GET /api/getLike?key=` | `{ count }`（没点过为 0） |
| `GET /api/allLikes` | `{ "<filename>": <likes> }`（只含有互动的歌） |
| `GET /api/play?key=` | `{ ok: true }`（`ctx.waitUntil` 异步累加） |
| `GET /api/songs` | `{ list: [{filename,likes,plays}] }`，按点赞倒序 |
| `GET /api/random` | **410**，歌单已迁移到仓库（保留状态码便于排查旧客户端） |

`key` 必须匹配 `^\d{1,4}_.+\.mp3$`，否则返回 `{count:0, ignored:"invalid key"}` 且不写库。

## 首次部署

数据库已建好：**名称 `likes`**，ID `eb47861e-6df3-4e4e-b8c3-d009a4cdf298`，已写入 `wrangler.toml`。

网页端（当前使用）：

1. D1 → `likes` → **Console**，`schema.sql` 里的三条语句**逐条粘贴执行**（见下方注意）；
2. 现有 Worker → Settings → Bindings → 添加 **D1 database**，变量名 **`DB`**，选 `likes`；
3. 同一 Worker → Edit code，粘贴 `src/index.js` 全文 → Deploy。

> **`schema.sql` 特意不写注释，每条语句压成一行。**
> 网页 Console 提交时换行不一定保留，而 `--` 是行注释、依赖换行终止。
> 一旦换行被压平，`--` 之后的整段真实 DDL 会被当成注释吞掉，SQLite 拿到一句在
> 括号中间截断的 `CREATE TABLE`，报错 **`incomplete input: SQLITE_ERROR`**（已用真实
> SQLite 复现确认）。所以改这个文件时**不要在语句中间或语句之间加注释**，说明写在本文件里。

三条语句，可原样逐条粘贴：

```sql
DROP TABLE IF EXISTS songs;
CREATE TABLE songs (filename TEXT PRIMARY KEY, likes INTEGER NOT NULL DEFAULT 0, plays INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_songs_likes ON songs (likes DESC);
```

执行完在 Console 里跑 `SELECT name FROM sqlite_master WHERE type IN ('table','index');`
应看到 `songs` 与 `idx_songs_likes` 两行。

命令行：

```bash
# 建表（库已存在，不要重复 create）
npx wrangler d1 execute likes --remote --config worker/wrangler.toml --file=worker/schema.sql

# 部署前先把 wrangler.toml 的 name 改成线上已有 Worker 的名字
npx wrangler deploy --config worker/wrangler.toml
```

## 本地验证

`wrangler dev` 依赖 `workerd` 原生二进制，某些 Windows 环境会因权限拦截启动失败
（`OS Error 5`）。这种情况可以直接跑接口测试——用 Node 内置的 `node:sqlite` 驱动真实 SQLite：

```bash
node --no-warnings <测试脚本> worker/src/index.js worker/schema.sql <临时目录>
```

覆盖：410 下线、按需建行、点赞自增、非法 key 不写库、allLikes、play 累加、
405/OPTIONS/CORS、缺绑定报错、**50 次并发点赞不丢数**、排行顺序。

## 建议但尚未实现

- **防刷**：同一 IP 可以无限点赞。需要时加 `like_log(ip_hash, filename, day)`，用
  `INSERT OR IGNORE` 去重（同 IP 同曲每天一次），计数仍走原子 UPDATE。
- **播放数降噪**：每次切歌写一行，量大时可做 session 去重。
