# 术力口电台 · VocalRadio

VOCALOID 歌曲播放器，带滚动歌词、点赞与封面取色。
本仓库**根目录就是站点根目录**，整体作为一个 Cloudflare Pages 项目部署。


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
│  ├─ main.js          # 播放器逻辑（歌单/取色/歌词滚动/进度/点赞）
│  └─ style.css        # 卡片式视觉系统（模糊封面背景 + 玻璃播放条）
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

## 与博客的关系

- 页面左上角的「‹ 玖桐博客」硬编码在 `index.html`，目前指向 `https://yunjiutong.cn/`。
- 拆站后**样式完全独立**，不再引用博客的 `editorial.css`（原先那份副本已删除）。
  博客是全站「个人刊物」风格，电台是卡片式界面，两套视觉各管各的。

## 界面结构

```
模糊封面背景（cover/thumb 里的低清图，fixed 铺满 + blur）
├─ 导航卡片（玻璃）        返回博客 · 站点名 · 深/浅主题开关
├─ 舞台（两列，等高）
│  ├─ 封面卡片            大封面 + 曲名 + 歌手 + 第几首
│  └─ 歌词卡片            卡片内独立滚动，当前行居中高亮
│                         右下角「展开」→ 沉浸视图（藏掉导航与封面卡）
└─ 播放条（磨砂玻璃，fixed 贴底）
   [歌单] [上一首 播放 下一首] ———进度条——— [点赞][音量]
     └─ 歌单面板            点「歌单」从播放条上方弹出，23 首，点任意一行即播
```

几条设计约束，改样式时别破坏：

- **主题色只来自封面取色**：`main.js` 把 color-thief 的结果算成色相/饱和度写进
  `--accent-h` / `--accent-s`，CSS 里派生出 `--accent-ink`（文字/描边）、
  `--accent-fill`（实心按钮）。换歌 → 换主题色，全站跟着变。
- **深/浅主题只换配色，不碰背景**：背景层 `.ambient` 不参与主题切换，
  两套主题共用同一张模糊封面。切换只改卡片底色、文字、主题色明度。
- **歌词高亮不做缩放**：只用颜色 + 字重 + 底色，且滚动只发生在 `#lyricBox` 内部
  （`scrollTop`），**不要用 `scrollIntoView`** —— 那会把整个页面滚走，
  就是之前"高亮时超出显示屏"的根因。
- **卡片高度必须靠确定高度链撑出来**：`body` 用 `height: 100dvh`（不是 `min-height`，
  那不会让 flex 容器产生可分配空间）+ `.shell` 纵向 flex + `.stage` 的
  `grid-template-rows: minmax(0, 1fr)`。这三层缺一层，歌词卡片就会被内容撑到
  几千像素、内层根本不滚动。
- **沉浸视图只是「藏掉兄弟卡片」**：`body.is-lyrics-expanded` 时 `.topbar` 和
  `.now` 设 `display:none`，`.stage` 同时收敛成单列单行 —— 如果只藏卡片不改轨道，
  剩下的一行会落回 `auto` 轨道、又被歌词撑高。不要改用 `position: fixed` 铺屏。
- **悬浮规格统一**：所有可点元素 `transform: scale(1.05)` + `opacity: .9` +
  主题色磨砂底。整行歌单是 100% 宽度，直接缩放会向两侧各溢出 2.5%，所以基础宽度
  先写成 `calc(100% / 1.05)`，悬浮放大后正好铺满容器，不产生横向滚动条。
- **响应式**：>900 两列等高；≤900 封面信息卡改成横排、歌词卡占剩余高度；
  ≤720 手机紧凑版，播放条拆成「进度 / 按钮」两行。页面纵向 flex 自适应，
  没有任何固定画布或 `overflow:hidden` 裁切；视口太矮时 `.stage` 的
  `min-height` 兜底，页面才滚动。
- **可访问性**：语义标签 + `aria-label`/`aria-pressed`/`aria-expanded`/`aria-current`、
  Tab 焦点环（3px 主题色）、首个 Tab 是「跳到播放控件」、滑杆都有 `<label>`。
  歌单面板在 DOM 里排在触发按钮**之后**（Tab 顺序才是"按钮 → 面板"），
  收起时 `visibility: hidden` 自动移出焦点序列，Esc / 关闭按钮收起后焦点回到触发按钮；
  「展开歌词」按钮用 `aria-expanded` + `aria-controls` 描述状态，Esc 退出并回焦。

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
