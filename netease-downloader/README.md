# 网易云电台下载器（netease-downloader）

把网易云歌曲抓取到 **VocalRadio 站点根目录**的本地 WebUI 工具。
参考 [Creamplayer](https://github.com/) 的网易云明文接口重构，纯本地运行、零 CDN。

## 功能

- **搜索**网易云歌曲（歌名 / 歌手均可）。
- **一键下载**选中歌曲，直接落到仓库根目录：
  - `mp3` → `../music/`
  - `lrc` 歌词 → `../lyric/`
  - 封面（**ffmpeg 转 png**）→ `../cover/`
  - 封面 **ffmpeg 转 240×240 缩略图** → `../cover/thumb/`
- **自动编号**：文件名沿用 `序号_歌手_歌名`（序号 = 现有最大 + 1，多歌手用 `&` 分隔）。
- **维护歌单**：查看 / 删除（连同四件套）/ 上下移动排序重新编号 / 导出 /
  **同步歌单文件**——把当前顺序写回 `../playlist.txt`。
- **缺件检查**：同步时列出缺封面 / 歌词 / 缩略图的条目。

> `playlist.txt` 就是网页播放器的歌单来源（前端直接读这个文件）。
> 所以在这里改完歌单 = 改完线上歌单，push 到仓库即生效，
> **不需要再去 Cloudflare 后台或 D1 里手动维护歌单**。

## 快速开始

双击 `start.bat`，自动安装依赖（含 ffmpeg 二进制）并打开 `http://127.0.0.1:8003`。

> 依赖：`fastapi` `uvicorn` `requests` `python-multipart` `imageio-ffmpeg`
> ffmpeg 优先用系统安装的；没有则用 `imageio-ffmpeg` 自带的二进制，无需手动安装。

手动启动：

```bash
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8003
```

## 使用

1. **搜索**：顶部输入歌名/歌手，点「搜索」。结果里可直接编辑「歌手 / 歌名」
   （多歌手建议 `歌手A&歌手B`，别用 `/`）。
2. **下载**：勾选后「批量下载勾选」，或单首「下载」。
3. **可选 Cookie**：多数近期歌曲需要登录态才能取到播放地址，
   填浏览器里 music.163.com 的 Cookie 可提高成功率与音质；留空则只能下免费曲目。
4. **歌单管理**：↑↓ 调顺序 →「保存排序（重新编号）」；「同步歌单文件」写回 `playlist.txt`。

## 端口与输出目录

端口 `8003`。所有输出都在**仓库根目录**（本工具目录的上一级）：

```
VocalRadio/
├─ music/             # mp3
├─ lyric/             # lrc
├─ cover/             # 封面 png
│  └─ thumb/          # 240×240 缩略图
└─ playlist.txt       # 歌单（网页直接读）
```

## 主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/search?q=&limit=&offset=&cookie=` | 搜索网易云 |
| POST | `/api/download` | 下载单曲（body: id/title/artist/cover/lrc/cookie） |
| GET | `/api/playlist` | 现有歌单列表（含缺件标记） |
| DELETE | `/api/playlist?base=` | 删除一首（含全部附属文件） |
| POST | `/api/playlist/reorder` | 按顺序重新编号（body: order=[base…]） |
| GET | `/api/playlist/export` | 导出歌单 JSON |
| POST | `/api/playlist/sync` | 写回 `playlist.txt`，并返回缺件清单 |

## 命名规律

```
{序号}_{歌手}_{歌名}.mp3 / .lrc / .png
```

- 序号从 0 起，自动续号（现有最大 + 1）。
- 多歌手用 `&` 连接，如 `1_奥莉安多幻想曲&在虚无中永存_未命名星系`。
- Windows 非法字符 `\ / : * ? " < > |` 会被移除。
- **歌手名里不能出现下划线**（网页端按 `_` 拆分序号/歌手/歌名）。

## 常见问题

- **提示「无法获取播放地址」**：该曲需要 VIP 或登录，填 Cookie 再试；或换一首。
- **封面转换失败**：确认 `ffmpeg` 可用（工具优先找系统 ffmpeg，其次用 `imageio-ffmpeg`）。
- 下载成功但没有歌词：部分歌曲没有 LRC，不影响播放。
