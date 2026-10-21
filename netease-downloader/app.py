# -*- coding: utf-8 -*-
"""
术力口电台 · 网易云下载器（本地 WebUI）
======================================
参考 Creamplayer 的网易云明文接口，纯本地工具。功能：
  1. 搜索网易云歌曲；
  2. 一键下载：mp3 → music/、lrc → lyric/、
     封面(ffmpeg转png) → cover/、240 缩略图 → cover/thumb/；
  3. 文件名沿用 `序号_歌手_歌名`（序号自动续、多歌手 & 连接）；
  4. 管理歌单：查看 / 删除 / 上下移动排序 / 导出，并写回仓库根目录的 playlist.txt。

playlist.txt 就是网页播放器的歌单来源（前端直接读它），所以在这里改完歌单
就等于改完了线上歌单——不需要再去 Cloudflare 后台或 D1 里手动写。

运行：
  start.bat  （自动安装依赖并启动，浏览器打开 http://127.0.0.1:8003）
或手动：
  python -m uvicorn app:app --host 127.0.0.1 --port 8003
"""

import json
import re
import shutil
import subprocess
import time
from pathlib import Path
from urllib.parse import quote

import requests
from fastapi import FastAPI, Body
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

# ---------------- 路径常量 ----------------
# 工具在 VocalRadio/netease-downloader/ 下，站点根目录就是它的上一级。
TOOL_DIR = Path(__file__).resolve().parent
REPO_DIR = TOOL_DIR.parent
MUSIC_DIR = REPO_DIR / "music"
LYRIC_DIR = REPO_DIR / "lyric"
COVER_DIR = REPO_DIR / "cover"
THUMB_DIR = COVER_DIR / "thumb"
PLAYLIST_TXT = REPO_DIR / "playlist.txt"
TEMPLATES_DIR = TOOL_DIR / "templates"
STATIC_DIR = TOOL_DIR / "static"
TMP_DIR = TOOL_DIR / "tmp"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

app = FastAPI(title="网易云电台下载器")
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# =====================================================================
# 工具函数
# =====================================================================
def net_headers(cookie: str = "") -> dict:
    h = {"User-Agent": UA, "Referer": "https://music.163.com/"}
    if cookie:
        h["Cookie"] = cookie
    return h


def _ffmpeg() -> str | None:
    """定位 ffmpeg：优先系统，其次 imageio-ffmpeg 自带二进制。"""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def clean_name(s: str) -> str:
    """去掉 Windows 非法字符；保留中英文、标点、& 等。"""
    s = re.sub(r'[\\/:*?"<>|]', "", s or "").strip()
    return s


def next_index() -> int:
    """扫描 music 目录现有 `序号_…` 文件，返回下一个序号（现有最大+1，空则 0）。"""
    nums = []
    if MUSIC_DIR.exists():
        for f in MUSIC_DIR.glob("*.mp3"):
            m = re.match(r"(\d+)_", f.name)
            if m:
                nums.append(int(m.group(1)))
    return (max(nums) + 1) if nums else 0


def parse_base(filename: str) -> tuple:
    """`3_歌手_歌名.mp3` -> (index, base, artist, title)"""
    stem = Path(filename).stem
    m = re.match(r"(\d+)_(.*)$", stem)
    if not m:
        return None
    idx, rest = m.group(1), m.group(2)
    if "_" in rest:
        artist, title = rest.split("_", 1)
    else:
        artist, title = rest, ""
    return idx, stem, artist, title


def run_ffmpeg(args: list) -> tuple:
    ff = _ffmpeg()
    if not ff:
        return False, "未找到 ffmpeg（请安装 ffmpeg 或 pip install imageio-ffmpeg）"
    try:
        p = subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", *args],
                           capture_output=True, text=True, timeout=120)
        if p.returncode != 0:
            return False, p.stderr.strip() or "ffmpeg 转换失败"
        return True, ""
    except Exception as e:
        return False, str(e)


# =====================================================================
# 网易云接口
# =====================================================================
def net_search(q: str, limit: int = 20, offset: int = 0, cookie: str = ""):
    url = (f"http://music.163.com/api/cloudsearch/pc?type=1&s={quote(q)}"
           f"&limit={limit}&offset={offset}")
    r = requests.get(url, headers=net_headers(cookie), timeout=20)
    d = r.json()
    songs = (d.get("result") or {}).get("songs") or []
    out = []
    for s in songs:
        al = s.get("al") or {}
        out.append({
            "id": s.get("id"),
            "name": s.get("name", ""),
            "artist": "/".join(a.get("name", "") for a in (s.get("ar") or [])),
            "album": al.get("name", ""),
            "cover": al.get("picUrl", ""),
            "duration": int((s.get("dt") or 0) / 1000),
        })
    return out


def net_play_url(song_id: int, br: int = 320000, cookie: str = ""):
    url = (f"http://music.163.com/api/song/enhance/player/url"
           f"?ids=[{song_id}]&br={br}")
    d = requests.get(url, headers=net_headers(cookie), timeout=20).json()
    data = d.get("data")
    if isinstance(data, list) and data:
        u = data[0].get("url")
        if u:
            return u
    return None


def net_lyric(song_id: int, cookie: str = ""):
    url = f"http://music.163.com/api/song/lyric?os=pc&id={song_id}&lv=-1&tv=1"
    d = requests.get(url, headers=net_headers(cookie), timeout=20).json()
    return (d.get("lrc") or {}).get("lyric", "")


# =====================================================================
# 歌单
# =====================================================================
def playlist_files() -> list:
    """按序号排序的 mp3 文件名列表。"""
    if not MUSIC_DIR.exists():
        return []
    files = [f.name for f in MUSIC_DIR.glob("*.mp3") if re.match(r"\d+_", f.name)]
    files.sort(key=lambda n: int(re.match(r"(\d+)_", n).group(1)))
    return files


def playlist_items():
    items = []
    for f in playlist_files():
        p = parse_base(f)
        if not p:
            continue
        idx, base, artist, title = p
        size = (MUSIC_DIR / f).stat().st_size if (MUSIC_DIR / f).exists() else 0
        items.append({
            "index": idx, "base": base, "file": f,
            "artist": artist, "title": title,
            "size": size,
            "hasCover": (COVER_DIR / f"{base}.png").exists(),
            "hasLrc": (LYRIC_DIR / f"{base}.lrc").exists(),
            "hasThumb": (THUMB_DIR / f"{base}.png").exists(),
        })
    return items


def build_playlist_text() -> str:
    files = [json.dumps(f, ensure_ascii=False) for f in playlist_files()]
    return "[" + ",".join(files) + "]"


def write_playlist_txt() -> Path:
    REPO_DIR.mkdir(parents=True, exist_ok=True)
    PLAYLIST_TXT.write_text(build_playlist_text(), encoding="utf-8")
    return PLAYLIST_TXT


def missing_parts() -> list:
    """列出缺封面 / 歌词 / 缩略图的条目，便于补全。"""
    issues = []
    for f in playlist_files():
        p = parse_base(f)
        if not p:
            continue
        _, base, _, _ = p
        miss = []
        if not (COVER_DIR / f"{base}.png").exists():
            miss.append("封面")
        if not (LYRIC_DIR / f"{base}.lrc").exists():
            miss.append("歌词")
        if not (THUMB_DIR / f"{base}.png").exists():
            miss.append("缩略图")
        if miss:
            issues.append({"base": base, "file": f, "missing": miss})
    return issues


def sync_playlist() -> tuple:
    """把 music/ 里的歌曲顺序写回仓库根的 playlist.txt —— 这就是线上歌单。

    网页播放器直接读这个文件，所以写完就等于更新了线上歌单，
    不需要再去 Cloudflare 后台或 D1 里手动维护。
    """
    files = playlist_files()
    if not files:
        return False, "music/ 里没有可用歌曲，未写入", []
    write_playlist_txt()
    return True, "已写入 %d 首到 playlist.txt" % len(files), missing_parts()


# =====================================================================
# 下载
# =====================================================================
def _get(url: str, cookie: str = "") -> bytes:
    r = requests.get(url, headers=net_headers(cookie), timeout=60)
    r.raise_for_status()
    return r.content


def download_song(id, title, artist, cover_url="", with_lrc=True, cookie=""):
    """下载一首：mp3/lrc/封面(png)/缩略图(240)。返回 (ok, 消息)。"""
    title = clean_name(title)
    artist = clean_name(artist)
    if not title or not artist:
        return False, "歌手或歌名不能为空"
    idx = next_index()
    base = f"{idx}_{artist}_{title}"

    # ---- 1. mp3 ----
    url = net_play_url(id, 320000, cookie) or net_play_url(id, 128000, cookie)
    if not url:
        return False, f"无法获取播放地址（{base}，可能是 VIP 或需登录）"
    try:
        audio = _get(url, cookie)
    except Exception as e:
        return False, f"mp3 下载失败（{base}）：{e}"
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    (MUSIC_DIR / f"{base}.mp3").write_bytes(audio)

    # ---- 2. lrc ----
    if with_lrc:
        try:
            lrc = net_lyric(id, cookie)
            if lrc:
                LYRIC_DIR.mkdir(parents=True, exist_ok=True)
                (LYRIC_DIR / f"{base}.lrc").write_text(lrc, encoding="utf-8")
        except Exception:
            pass  # 歌词失败不阻断

    # ---- 3. 封面 → png + 240 缩略图 ----
    if cover_url:
        try:
            raw = _get(cover_url, cookie)
            TMP_DIR.mkdir(parents=True, exist_ok=True)
            tmp_src = TMP_DIR / f"{int(time.time()*1000)}_{id}_src.jpg"
            tmp_src.write_bytes(raw)
            COVER_DIR.mkdir(parents=True, exist_ok=True)
            THUMB_DIR.mkdir(parents=True, exist_ok=True)
            ok1, e1 = run_ffmpeg(["-i", str(tmp_src), str(COVER_DIR / f"{base}.png")])
            ok2, e2 = run_ffmpeg(
                ["-i", str(tmp_src), "-vf", "scale=240:240",
                 str(THUMB_DIR / f"{base}.png")])
            tmp_src.unlink(missing_ok=True)
            if not ok1:
                return False, f"mp3/歌词已下载，但封面转换失败（{base}）：{e1}"
            if not ok2:
                return False, f"封面已生成，但缩略图失败：{e2}"
        except Exception as e:
            return False, f"封面处理失败（{base}）：{e}"

    write_playlist_txt()
    return True, f"完成：{base}.mp3"


# =====================================================================
# API
# =====================================================================
@app.get("/", response_class=HTMLResponse)
def index():
    return (TEMPLATES_DIR / "form.html").read_text(encoding="utf-8")


@app.get("/api/search")
def api_search(q: str, limit: int = 20, offset: int = 0, cookie: str = ""):
    try:
        return JSONResponse({"ok": True, "songs": net_search(q, limit, offset, cookie)})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})


@app.post("/api/download")
def api_download(payload: dict = Body(...)):
    try:
        ok, msg = download_song(
            payload.get("id"), payload.get("title", ""), payload.get("artist", ""),
            payload.get("cover", ""), bool(payload.get("lrc", True)),
            payload.get("cookie", ""))
        return JSONResponse({"ok": ok, "message": msg})
    except Exception as e:
        return JSONResponse({"ok": False, "message": str(e)})


@app.get("/api/playlist")
def api_playlist():
    return JSONResponse({"ok": True, "items": playlist_items()})


@app.delete("/api/playlist")
def api_playlist_delete(base: str):
    """删除一首歌的 mp3/lrc/cover/thumb。"""
    removed = []
    for p in (MUSIC_DIR / f"{base}.mp3", LYRIC_DIR / f"{base}.lrc",
              COVER_DIR / f"{base}.png", THUMB_DIR / f"{base}.png"):
        if p.exists():
            p.unlink()
            removed.append(p.name)
    write_playlist_txt()
    return JSONResponse({"ok": True, "removed": removed})


@app.post("/api/playlist/reorder")
def api_playlist_reorder(payload: dict = Body(...)):
    """order: 按新顺序排列的 base 列表。重新编号 0..N（仅改序号，歌手/歌名不变）。"""
    order = payload.get("order") or []
    items = []
    for base in order:
        p = parse_base(f"{base}.mp3")
        if not p:
            return JSONResponse({"ok": False, "message": f"无效条目: {base}"})
        items.append((p[1], p[2], p[3]))   # (base, artist, title)

    # 阶段1：全部先转临时名，避免重命名冲突/覆盖
    for base, _, _ in items:
        for ext, d in ((".mp3", MUSIC_DIR), (".lrc", LYRIC_DIR),
                       (".png", COVER_DIR), (".png", THUMB_DIR)):
            f = d / f"{base}{ext}"
            if f.exists():
                f.rename(d / f"__tmp_{base}{ext}")

    # 阶段2：按新序号恢复最终名
    for i, (base, artist, title) in enumerate(items):
        nb = f"{i}_{artist}_{title}"
        for ext, d in ((".mp3", MUSIC_DIR), (".lrc", LYRIC_DIR),
                       (".png", COVER_DIR), (".png", THUMB_DIR)):
            tmp = d / f"__tmp_{base}{ext}"
            if tmp.exists():
                tmp.rename(d / f"{nb}{ext}")

    write_playlist_txt()
    return JSONResponse({"ok": True, "message": "已重新排序编号"})


@app.get("/api/playlist/export")
def api_playlist_export():
    return PlainTextResponse(build_playlist_text(),
                             media_type="text/plain; charset=utf-8")


@app.post("/api/playlist/sync")
def api_playlist_sync():
    ok, msg, missing = sync_playlist()
    return JSONResponse({"ok": ok, "message": msg, "missing": missing})
