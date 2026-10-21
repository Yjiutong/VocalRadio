# 术力口电台后端 · Worker + D1

`likes.yunjiutong.cn` 的实现。原先所有数据都存在 KV，现已改为 **D1（SQLite）**。

## 为什么换掉 KV

不是性能调优，是**正确性**问题：

| 问题 | 原实现 | 后果 |
|---|---|---|
| 点赞丢数 | `get → +1 → put` | KV 无原子自增。50 次并发实测**只剩 1**（丢 49） |
| 写死限流 | 同一 key **1 次写/秒**（平台硬限制） | 热门歌连点几下就写不进去 |
| 写额度打满 | `/api/play` 每首歌加载写一次 KV | KV 免费 **1,000 写/天**，听 1000 首当天点赞全部失败 |
| N+1 查询 | `/api/allLikes` 逐首 `kv.get` | 23 首歌 = 23 次串行读，歌越多越慢 |
| key 无校验 | 任意 `?key=` 都能建 KV 记录 | 命名空间无界增长，可被刷 |
| 歌单三处重复 | KV `songlist` + `playlist.txt` + 前端 | 谁也不知道哪个是权威 |

D1 的免费额度是 **读 500 万行/天、写 10 万行/天**，且 `UPDATE ... SET likes = likes + 1` 单语句原子。

## 数据结构

一张表搞定歌单与计数（见 `schema.sql`）：

```sql
songs(filename PK, song_id, singer, title, likes, plays, added_at)
```

`filename` 既是主键也是业务标识，直接对应 `music/` 下的文件名，不需要额外 id 映射。

## 接口

路径与返回结构和旧版**完全一致**，前端无需改动：

| 接口 | 返回 |
|---|---|
| `GET /api/random` | `{ list: [filename...] }` |
| `GET /api/allLikes` | `{ "<filename>": <likes> }`（一次 SELECT） |
| `GET /api/getLike?key=` | `{ count }`（未知 key 为 0） |
| `GET /api/like?key=` | `{ key, count }`（未知 key 返回 `count:0, ignored:"unknown key"`，**不写库**） |
| `GET /api/play?key=` | `{ ok: true }`（`ctx.waitUntil` 异步累加） |
| `GET /api/songs` | `{ list: [{filename,singer,title,likes,plays,added_at}] }`（新增，调试/后台用） |

## 首次部署

```bash
# 1. 建库（输出里会有 database_id）
npx wrangler d1 create vocalradio

# 2. 把 database_id 填进 worker/wrangler.toml

# 3. 建表 + 导入 23 首歌
npx wrangler d1 execute vocalradio --remote --config worker/wrangler.toml --file=worker/schema.sql

# 4. 部署
npx wrangler deploy --config worker/wrangler.toml
```

域名 `likes.yunjiutong.cn` 若已在 Dashboard 绑到新旧同名 Worker，可把 `wrangler.toml` 里的
`routes` 一段删掉，避免重复声明。

## 导入旧的点赞数（可选）

旧数据只是 `like_<文件名>` 的计数，量级很小。要保留就跑：

```bash
export KV_NAMESPACE_ID="<旧 KV 命名空间 id>"   # npx wrangler kv namespace list
bash worker/scripts/migrate-likes-from-kv.sh
# 按提示执行生成的 UPDATE 语句
```

嫌麻烦可以跳过，让点赞从 0 开始。

## 新增一首歌

```bash
npx wrangler d1 execute vocalradio --remote --config worker/wrangler.toml \
  --command "INSERT INTO songs (filename, song_id, singer, title) VALUES ('23_歌手_曲名.mp3','23','歌手','曲名')"
```

同时别忘了把媒体文件放进仓库、并更新根目录的 `playlist.txt`（接口故障时的兜底）。
文件名规则见仓库根 README。

## 本地验证

`wrangler dev` 依赖 `workerd` 原生二进制，某些 Windows 环境会因权限拦截启动失败
（`OS Error 5`）。此时可以直接跑接口测试——用 Node 内置的 `node:sqlite` 驱动真实 SQLite：

```bash
node --no-warnings <测试脚本> worker/src/index.js worker/schema.sql <临时目录>
```

测试覆盖：歌单长度、点赞自增、未知 key 不写库、allLikes 数值、play 累加、
405/OPTIONS/CORS、缺少绑定时的报错，以及 **50 次并发点赞不丢数**。

## 建议但尚未实现

- **防刷**：目前同一 IP 可以无限点赞。需要的话加一张 `like_log(ip_hash, filename, ts)`，
  用 `INSERT OR IGNORE` 做去重（同一 IP 同一首每天限一次），`likes` 仍由触发器或事务维护。
- **播放数降噪**：每次切歌都写一行，量大时可按 session 去重或改成批量写入。
