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
├─ playlist.txt        # 歌单（JSON 数组）—— 播放器直接读它，这是唯一来源
├─ color-thief.min.js  # 封面取色
├─ assets/
│  ├─ main.js          # 播放器逻辑
│  ├─ style.css        # 播放器样式（含随封面取色的动态配色）
│  └─ editorial.css    # 博客的全站风格层副本（纸白/墨黑/细线）
├─ cover/              # 封面原图（约 53MB）
│  └─ thumb/           # 封面缩略图，先出低清再换高清
├─ lyric/              # 歌词 .lrc
├─ music/              # 音频 .mp3（约 167MB）
├─ netease-downloader/ # 本地下载器（FastAPI WebUI），加歌与维护歌单
└─ worker/             # 后端（Worker + D1）：只做点赞/播放计数
   ├─ src/index.js
   ├─ schema.sql
   ├─ wrangler.toml
   └─ README.md        # 部署步骤
```

## 歌单与计数分别放在哪

| 内容 | 存放位置 | 谁维护 |
|---|---|---|
| **歌单** | 仓库根目录 `playlist.txt` | `netease-downloader/` 自动写入 |
| **点赞 / 播放数** | D1 的 `songs` 表 | Worker 原子累加，行按需创建 |

播放器直接 `fetch("./playlist.txt")` 拿歌单，**不经过任何接口**；
点赞才走 `https://likes.yunjiutong.cn`（CORS 为 `*`，本站部署到任何域名都能调）。

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

> 部署 Pages 时 `worker/` 与 `netease-downloader/` 也会被当作静态文件发布
> （源码可被访问，但不含任何密钥）。介意的话可以把它们拆到单独仓库。

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
