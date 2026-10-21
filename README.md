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
├─ functions/api/      # 点赞/播放计数接口（Pages Functions + D1，随仓库部署）
│  ├─ _lib.js          # 公共部分（`_` 开头，不注册成路由）
│  ├─ like.js          # GET /api/like?key=
│  ├─ getLike.js       # GET /api/getLike?key=
│  ├─ allLikes.js      # GET /api/allLikes
│  ├─ play.js          # GET /api/play?key=
│  ├─ songs.js         # GET /api/songs
│  └─ random.js        # GET /api/random → 410（已下线）
├─ cover/              # 封面原图（约 53MB）
│  └─ thumb/           # 封面缩略图，先出低清再换高清
├─ lyric/              # 歌词 .lrc
├─ music/              # 音频 .mp3（约 167MB）
├─ netease-downloader/ # 本地下载器（FastAPI WebUI），加歌与维护歌单
├─ worker/             # 【可选 · 未使用】独立 Worker 版后端，与 functions/ 二选一
│  ├─ src/index.js
│  ├─ schema.sql       # D1 建表语句（两种方案共用）
│  ├─ wrangler.toml
│  └─ README.md        # 部署步骤
```

## 计数接口跑在哪

**默认走 Pages Functions**，代码就在本仓库 `functions/api/`，和页面一起部署：

- 地址与站点同源 → `https://vocalradio.pages.dev/api/like?key=...`，不跨域；
- 加接口 = 在 `functions/api/` 里新建一个 `.js` 然后 push，**不用进 Cloudflare 后台**；
- 唯一需要后台配置的是一次性 D1 绑定（见「部署」）。

`worker/` 是等价的独立 Worker 版本（`likes.yunjiutong.cn`），**保留作为备选**；
两者读写同一张 D1 表，接口路径完全一致，切换只需改 `assets/main.js` 里的 `API_BASE`。


## 歌单与计数分别放在哪

| 内容 | 存放位置 | 谁维护 |
|---|---|---|
| **歌单** | 仓库根目录 `playlist.txt` | `netease-downloader/` 自动写入 |
| **点赞 / 播放数** | D1 的 `songs` 表 | `functions/api/` 原子累加，行按需创建 |

播放器直接 `fetch("./playlist.txt")` 拿歌单，**不经过任何接口**；
点赞才走同源 `/api/like`（`API_BASE = ""`）。

这样加歌的流程就是：下载器下载 → 自动写回 `playlist.txt` → push。
**不需要去 Cloudflare 后台或 D1 里手写歌单**；`worker/README.md` 里有更多细节。

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

> `functions/` 由 Pages 当作函数代码单独打包，**不会**作为静态文件对外暴露。
> 但 `worker/` 与 `netease-downloader/` 会被当作静态文件发布（源码可被访问，
> 不含任何密钥）。介意的话可以把它们拆到单独仓库。

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
建表语句见 `worker/schema.sql`，在 D1 → `likes` → Console 里逐条执行。

验证：
`/api/songs` → `{"list":[]}`，`/api/allLikes` → `{}`，`/api/random` → 410。

### 方式 B：CLI 直传

```bash
npx wrangler pages deploy . --project-name vocalradio
```

### 下线独立 Worker（可选，顺序别反）

Pages 跑通之后，`likes.yunjiutong.cn` 那个 Worker 就没用了，可以删。**必须先验证再删**：

> **⚠️ 前提：博客那边的 `/radio/` 得先下线。**
> 截至 2026-10-21，`https://yunjiutong.cn/radio/radio` 仍然在线，它的 `assets/main.js` 里
> `API_BASE = "https://likes.yunjiutong.cn"`，而且还在调 `/api/random` 拿歌单 ——
> 也就是说**删掉 Worker，博客上那个还在跑的电台会立即不能选歌、点赞和播放计数全挂**。
> 顺序必须是：新站部署通 → 博客 push 下掉 `/radio/`（入口已由 `tools/set-radio-url.mjs` 改写）→ 再删 Worker。

1. Pages 部署成功，`/api/songs` 返回 `{"list":[]}`（说明 Functions + D1 绑定都通了）；
2. 在页面上真点一次赞 → `/api/like` 返回 `count:1` → D1 Console 里
   `SELECT * FROM songs;` 能看到那一行（说明真的写进库了，不是只返回了个数字）；
3. 博客 `/radio/` 已下线并部署（旧访客的 `main.js` 可能还在缓存里，建议留一两天再删）；
4. 到这一步才去删 Worker。

删的时候注意：

- **KV 命名空间不会跟着 Worker 一起消失**（Worker 和 KV 是两个资源）。
  想留下历史点赞，先跑 `worker/scripts/migrate-likes-from-kv.sh` 把 KV 倒进 D1；
  不在乎旧数据就让它留着，以后单独删，反正不占费用。
- 若提示域名占用，先去 Worker → Settings → Domains & Routes 删掉 `likes.yunjiutong.cn`，再删 Worker。
- 删完后浏览器里**缓存过的旧 `main.js`** 仍会去请求那个域名，静默失败（`.catch(() => {})`），不影响播放。

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
