# 术力口电台 · VocalRadio

VOCALOID 歌曲播放器，带滚动歌词、点赞与封面取色。
本仓库**根目录就是站点根目录**，整体作为一个 Cloudflare Pages 项目部署。

线上地址：<https://vocalradio.pages.dev>（自定义域名可在 Pages 后台绑）
所属博客：<https://yunjiutong.cn>

## 目录结构

```
VocalRadio/
├─ index.html          # 播放器主页（部署后 / 即此页）
├─ radio.html          # 旧链接兼容页，0 秒跳转到 index.html
├─ _headers            # Pages 响应头：音频/封面的 CORS 与缓存
├─ _routes.json        # 只让 /api/* 走 Functions，静态资源继续走免费无限制通道
├─ playlist.txt        # 歌单（JSON 数组）—— 播放器直接读它，这是唯一来源
├─ color-thief.min.js  # 封面取色
├─ assets/
│  ├─ main.js          # 播放器逻辑
│  ├─ style.css        # 播放器样式（含随封面取色的动态配色）
│  └─ editorial.css    # 博客的全站风格层副本（纸白/墨黑/细线）
├─ functions/          # 后端：Pages Functions + D1，随仓库一起部署
│  ├─ schema.sql       # D1 建表语句（三条，网页 Console 里逐条执行）
│  └─ api/             # 点赞/播放计数接口
│     ├─ _lib.js       # 公共部分（`_` 开头，不注册成路由）
│     ├─ like.js       # GET /api/like?key=
│     ├─ getLike.js    # GET /api/getLike?key=
│     ├─ allLikes.js   # GET /api/allLikes
│     ├─ play.js       # GET /api/play?key=
│     ├─ songs.js      # GET /api/songs
│     └─ random.js     # GET /api/random → 410（已下线）
├─ cover/              # 封面原图（约 53MB）
│  └─ thumb/           # 封面缩略图，先出低清再换高清
├─ lyric/              # 歌词 .lrc
├─ music/              # 音频 .mp3（约 167MB）
└─ netease-downloader/ # 本地下载器（FastAPI WebUI），加歌与维护歌单
```

整个后端只有 `functions/` 一处。没有独立 Worker、没有 KV —— KV 已下线，
`likes.yunjiutong.cn` 那个旧 Worker 也已在清理时移除，计数全部走同源的 `/api/*`。

## 计数接口跑在哪

**Pages Functions**，代码就在本仓库 `functions/api/`，和页面一起部署：

- 地址与站点同源 → `https://vocalradio.pages.dev/api/like?key=...`，不跨域；
- 加接口 = 在 `functions/api/` 里新建一个 `.js` 然后 push，**不用进 Cloudflare 后台**；
- 唯一需要后台配置的是一次性 D1 绑定（见「部署」）。


## 歌单与计数分别放在哪

| 内容 | 存放位置 | 谁维护 |
|---|---|---|
| **歌单** | 仓库根目录 `playlist.txt` | `netease-downloader/` 自动写入 |
| **点赞 / 播放数** | D1 的 `songs` 表 | `functions/api/` 原子累加，行按需创建 |

播放器直接 `fetch("./playlist.txt")` 拿歌单，**不经过任何接口**；
点赞才走同源 `/api/like`（`API_BASE = ""`）。

这样加歌的流程就是：下载器下载 → 自动写回 `playlist.txt` → push。
**不需要去 Cloudflare 后台或 D1 里手写歌单。**

歌单丢了也能从磁盘重建：`music/` 目录才是权威来源，
下载器首页的「同步歌单文件」会按文件名序号重新生成整个 `playlist.txt`
（等价于 `netease-downloader/app.py` 里的 `sync_playlist()`）。

## 新增一首歌

推荐直接用下载器（`netease-downloader/`），它会自动续号、转封面、写歌单。
手工添加的话，文件名是唯一索引，`parseSongName()` 按 `_` 拆分：
`<id>_<歌手>_<曲名>.mp3`，**歌手名里不能出现下划线**，曲名可以。
同一个 basename 要准备四份文件：

```
music/23_歌手_曲名.mp3
cover/23_歌手_曲名.png
cover/thumb/23_歌手_曲名.png     # 低清缩略图，可缩小到 400px
lyric/23_歌手_曲名.lrc
```

然后把 `23_歌手_曲名.mp3` 追加进 `playlist.txt` 的数组即可 —— 数据库不用动，
这首歌第一次被点赞/播放时会自动建行。

> `functions/` 由 Pages 当作函数代码单独打包，**不会**作为静态文件对外暴露
> （`schema.sql` 放在里面也同理，不会被下载）。
> `netease-downloader/` 会被当作静态文件发布（源码可被访问，不含任何密钥），
> 介意的话可以把它拆到单独仓库。

## 部署

### 方式 A：Git + Pages（当前使用）

Pages 项目 `vocalradio` → Settings → Build：

- Framework preset：**None**
- Build command：**留空**
- Build output directory：**`/`**
- 生产分支：`main`

推送到 `main` 即自动部署。

**一次性配置（只需做一次）：** Settings → Bindings → **Add → D1 database bindings**

| 字段 | 填什么 |
|---|---|
| Variable name | **`DB`**（代码里写死 `env.DB`，不能改名） |
| D1 database | `likes` |

改完必须 **重新部署一次**（Deployments → 最新一条 → Retry / 或再 push 一次）才会生效。
建表语句见 `functions/schema.sql`，在 D1 → `likes` → Console 里**逐条**执行
（文件特意不写注释：网页 Console 提交时换行可能被压平，`--` 行注释会吞掉后面的 DDL）。

验证：
`/api/songs` → `{"list":[]}`，`/api/allLikes` → `{}`，`/api/random` → 410。

### 方式 B：CLI 直传

```bash
npx wrangler pages deploy . --project-name vocalradio
```

### 旧后端已清理（2026-10-21）

原来那套「独立 Worker + KV」已经完全退役，仓库里对应文件也已删除：

| 删掉的东西 | 原因 |
|---|---|
| `worker/src/index.js` | 独立 Worker 的代码，功能已并入 `functions/api/` |
| `worker/wrangler.toml` | 只用于 `wrangler deploy` 那个 Worker |
| `worker/scripts/migrate-likes-from-kv.sh` | KV 已删除，无数据可迁 |
| `worker/README.md` | 内容合并进本文件 |

线上同时确认：`likes.yunjiutong.cn` 已不可解析（域名随 Worker 一起下线），
新站 `https://vocalradio.pages.dev/api/*` 全部正常。

> **⚠️ 副作用：博客上的 `/radio/` 现在是坏的。**
> `https://yunjiutong.cn/radio/radio` 仍在线，但它的 `main.js` 指向已下线的
> `likes.yunjiutong.cn`，靠 `/api/random` 拿歌单——现在拿不到，选歌会失败。
> 修法：把博客仓库里那批改动 push 上线，让 `/radio/` 下线、入口改指新站
> （`tools/set-radio-url.mjs` 已生成好）。

## 与博客的关系

- 页面左上角的「← 返回玖桐博客」硬编码在 `index.html`，目前指向 `https://yunjiutong.cn/`。
- `assets/editorial.css` 是博客 `asset/editorial.css` 的**副本**，拆站后不能再跨目录引用。
  博客改了全站风格后同步一次：

  ```bash
  cp ../YunjiutongBlog/asset/editorial.css assets/editorial.css
  ```

## 体积与平台限制

| 项目 | 实际 | Cloudflare Pages 限制 |
|---|---|---|
| 单文件最大 | 10.8 MB（`music/21_…九九八十一.mp3`） | 25 MiB ✅ |
| 文件总数 | 约 100 | 20,000 ✅ |
| 总体积 | 约 220 MB | 无硬性上限，但会占用构建缓存 |

音频拖动进度依赖 Pages 对静态资源的 Range 请求支持，无需额外配置。

## 许可

代码部分见 [LICENSE](./LICENSE)（MIT）。
`music/`、`cover/`、`lyric/` 下的歌曲与插画版权归各自原作者 / 社团所有，仅供个人收藏与试听。
