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
├─ playlist.txt        # 歌单快照（JSON 数组），同时作为接口故障时的兜底
├─ color-thief.min.js  # 封面取色
├─ assets/
│  ├─ main.js          # 播放器逻辑
│  ├─ style.css        # 播放器样式（含随封面取色的动态配色）
│  └─ editorial.css    # 博客的全站风格层副本（纸白/墨黑/细线）
├─ cover/              # 封面原图（约 53MB）
│  └─ thumb/           # 封面缩略图，先出低清再换高清
├─ lyric/              # 歌词 .lrc
├─ music/              # 音频 .mp3（约 167MB）
└─ worker/             # 后端（Cloudflare Worker + D1）：歌单与点赞计数
   ├─ src/index.js
   ├─ schema.sql
   ├─ wrangler.toml
   └─ README.md        # 部署与迁移步骤
```

## 数据来源

歌曲与点赞/播放计数都在 **D1**（见 `worker/README.md`），Worker 对外只暴露这几个接口：

| 能力 | 接口 |
|---|---|
| 歌单 | `GET https://likes.yunjiutong.cn/api/random` → `{ list: [...] }` |
| 播放数 | `GET /api/play?key=<文件名>` |
| 点赞 | `GET /api/like?key=`、`GET /api/getLike?key=`、`GET /api/allLikes` |

该接口的响应头是 `Access-Control-Allow-Origin: *`，所以本站部署在任何域名都能直接调用。
若日后收紧 CORS，记得把本站域名加进白名单。

**兜底**：远端歌单取不到时，`assets/main.js` 会自动改用同目录的 `playlist.txt`，
不会出现空白播放器。因此新增歌曲时 **`playlist.txt` 必须一起更新**。

## 新增一首歌

文件名是唯一索引，`parseSongName()` 按 `_` 拆分：`<id>_<歌手>_<曲名>.mp3`。
**歌手名里不能出现下划线**，曲名可以。同一个 basename 要准备四份文件：

```
music/23_歌手_曲名.mp3
cover/23_歌手_曲名.png
cover/thumb/23_歌手_曲名.png     # 低清缩略图，可缩小到 400px
lyric/23_歌手_曲名.lrc
```

歌曲是否会被播放，由后端 D1 的 `songs` 表决定；仓库里的 `playlist.txt` 只是接口故障时的兜底快照。
所以两处都要加：

```bash
# 1) 写进后端数据库（否则网页永远播不到这首）
npx wrangler d1 execute vocalradio --remote --config worker/wrangler.toml \
  --command "INSERT INTO songs (filename, song_id, singer, title) VALUES ('23_歌手_曲名.mp3','23','歌手','曲名')"

# 2) 同步兜底快照 playlist.txt 的数组
```

> 部署 Pages 时 `worker/` 目录也会被一起当作静态文件发布（源码可被访问，但不含任何密钥）。
> 介意的话可以把 `worker/` 拆到单独仓库，本仓库只保留前端。

## 部署

### 方式 A：Git + Pages（当前使用）

Pages 项目 `vocalradio` → Settings → Build：

- Framework preset：**None**
- Build command：**留空**
- Build output directory：**`/`**
- 生产分支：`main`

推送到 `main` 即自动部署。

### 方式 B：CLI 直传

```bash
npx wrangler pages deploy . --project-name vocalradio
```

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
