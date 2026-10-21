// ========== 配置区【修正为你真实worker地址，只定义一次！】 ==========
const API_BASE = "https://likes.yunjiutong.cn";

// DOM元素
const themeBtn = document.querySelector("#theme");
const coverImg = document.querySelector("#coverImg");
const songTitleEl = document.querySelector("#songTitle");
const songArtistEl = document.querySelector("#songArtist");
const lyricWrap = document.querySelector("#lyricWrap");
const audioPlayer = document.querySelector("#audioPlayer");
const btnPlay = document.querySelector("#btnPlay");
const btnPrev = document.querySelector("#btnPrev");
const btnNext = document.querySelector("#btnNext");
const btnLike = document.querySelector("#btnLike");
const likeCountText = document.querySelector("#likeCountText");
const btnMute = document.querySelector("#btnMute");
const volumeSlider = document.querySelector("#volumeSlider");
const volumeText = document.querySelector("#volumeText");
const volumeControl = document.querySelector("#volumeControl");
const volumePopover = document.querySelector("#volumePopover");

// 全局状态
let lyricLines = [];
let likeMap = {};
let isPlaying = false;
let isDarkMode = false;
let dynDark = [14, 58, 56];
let dynLight = [220, 248, 246];
let lastActiveLyricIndex = -1;
let colorThief = null;

// 缓存模型
const MAX_HISTORY = 10;
const MAX_FORWARD = 20;
let currentSong = null;
let historyStack = [];
let forwardCache = [];

// ========== 昼夜切换 ==========
function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    localStorage.setItem("radio_dark", isDarkMode ? "1" : "0");
    const root = document.documentElement;
    if (isDarkMode) {
        root.setAttribute("data-theme", "dark");
    } else {
        root.removeAttribute("data-theme");
    }
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return [h * 360, s * 100, l * 100];
}
function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function applyTheme(dark, light) {
    const [hD, sD, lD] = rgbToHsl(...dark);
    const [hL, sL, lL] = rgbToHsl(...light);
    const fixedDark = hslToRgb(hD, sD, Math.min(lD, 22));
    const fixedLight = hslToRgb(hL, sL, Math.max(lL, 82));
    const root = document.documentElement;
    root.style.setProperty('--dyn-color1', `rgb(${fixedDark.join(',')})`);
    root.style.setProperty('--dyn-color2', `rgb(${fixedLight.join(',')})`);
    root.style.setProperty('--dyn-rgb1', fixedDark.join(','));
    root.style.setProperty('--dyn-rgb2', fixedLight.join(','));
}

function parseSongName(rawFileName) {
    const base = rawFileName.replace(/\.mp3$/i, "");
    const parts = base.split("_");
    const id = parts[0];
    const singer = parts[1] ?? "未知歌手";
    const title = parts.slice(2).join("_") ?? "未知曲目";
    const encodedBase = encodeURIComponent(base);
    return {
        filename: rawFileName,
        id,
        singer,
        title,
        audioSrc: `./music/${encodedBase}.mp3`,
        coverSrc: `./cover/${encodedBase}.png`,         // 高清原图
        thumbCoverSrc: `./cover/thumb/${encodedBase}.png`, // 低清缩略图
        lrcSrc: `./lyric/${encodedBase}.lrc`
    };
}

// 歌单来源：仓库根目录的 playlist.txt（下载器维护，push 到 Pages 即生效）。
// 播放列表是静态内容，直接读同目录文件就够了 —— 不再依赖远端接口，
// 也就不需要为了加歌去 Cloudflare 后台或 D1 里手写歌单。
let localSongList = null;
async function getSongList() {
    if (localSongList) return localSongList;
    try {
        const resp = await fetch("./playlist.txt", { cache: "no-store" });
        if (!resp.ok) throw new Error(`http ${resp.status}`);
        const arr = JSON.parse(await resp.text());
        if (Array.isArray(arr) && arr.length) localSongList = arr;
    } catch (e) {
        console.error("读取 playlist.txt 失败", e);
    }
    return localSongList || [];
}

async function fetchOneRandomSong() {
    const list = await getSongList();
    if (!list.length) {
        console.error("歌单为空：请检查仓库根目录的 playlist.txt");
        return null;
    }
    return parseSongName(list[Math.floor(Math.random() * list.length)]);
}

async function fillForwardCache() {
    while (forwardCache.length < MAX_FORWARD) {
        const meta = await fetchOneRandomSong();
        if (!meta) break;
        forwardCache.push(meta);
    }
}

async function loadSong(rawFileName) {
    lyricWrap.innerHTML = "";
    if (!rawFileName) return;
    const info = parseSongName(rawFileName);
    songTitleEl.textContent = info.title;
    songArtistEl.textContent = info.singer;

    coverImg.crossOrigin = "anonymous";
    let coverFallbackUsed = false;

    // ① 立刻显示缩略低清图，消除空白
    coverImg.src = info.thumbCoverSrc;

    // ② 后台内存静默预加载高清原图（不插入DOM）
    const hdImage = new Image();
    hdImage.crossOrigin = "anonymous";

    hdImage.onload = () => {
        // 高清加载完成：替换DOM图片，淡入切换
        coverImg.src = info.coverSrc;
        // ⚠️仅高清原图完成后执行取色，缩略图不参与配色计算
        handleCoverColor();
    };

    hdImage.onerror = () => {
        // 高清原图加载失败，回退默认封面，防止死循环
        if (coverFallbackUsed) return;
        coverFallbackUsed = true;
        coverImg.src = "./cover/default.png";
        dynDark = [14, 58, 56];
        dynLight = [220, 248, 246];
        applyTheme(dynDark, dynLight);
    };

    // 开始请求高清资源（后台下载）
    hdImage.src = info.coverSrc;

    audioPlayer.src = info.audioSrc;
    await loadLyric(info.lrcSrc);

    // 播放上报
    fetch(`${API_BASE}/api/play?key=${encodeURIComponent(rawFileName)}`).catch(() => { });

    // 异步获取当前歌曲点赞（方案A接口保持不变）
    (async () => {
        try {
            const resp = await fetch(`${API_BASE}/api/getLike?key=${encodeURIComponent(rawFileName)}`);
            const data = await resp.json();
            const realCount = Number(data.count) || 0;
            likeMap[rawFileName] = realCount;
            likeCountText.innerText = realCount;
        } catch (err) {
            console.warn("获取单首点赞失败，使用缓存值", err);
            likeCountText.innerText = likeMap[rawFileName] ?? "0";
        }
    })();

    isPlaying = false;
    updatePlayIcon();
}

function handleCoverColor() {
    if(!colorThief){
        dynDark = [14, 58, 56];
        dynLight = [220, 248, 246];
        applyTheme(dynDark, dynLight);
        return;
    }
    try {
        const palette = colorThief.getPalette(coverImg, 6);
        if (!palette || palette.length < 2) throw new Error("palette empty");
        dynDark = palette[0];
        dynLight = palette[palette.length - 1];
    } catch (e) {
        dynDark = [14, 58, 56];
        dynLight = [220, 248, 246];
    }
    applyTheme(dynDark, dynLight);
}

async function loadLyric(lrcUrl) {
    lyricLines = [];
    try {
        const res = await fetch(lrcUrl);
        if (!res.ok) throw new Error("no lrc");
        const text = await res.text();
        lyricLines = parseLrc(text);
    } catch (e) {
        lyricLines = [];
    }
    renderLyricHtml();
}

function parseLrc(lrcText) {
    const lines = lrcText.split("\n");
    const result = [];
    const reg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
    for (const line of lines) {
        const matchArr = [...line.matchAll(reg)];
        if (matchArr.length === 0) continue;
        const txt = line.replace(reg, "").trim();
        if (!txt) continue;
        for (const m of matchArr) {
            const min = Number(m[1]);
            const sec = Number(m[2]);
            const ms = Number(m[3]);
            const time = min * 60 + sec + ms / 1000;
            result.push({ time, text: txt });
        }
    }
    result.sort((a, b) => a.time - b.time);
    return result;
}

function renderLyricHtml() {
    if (lyricLines.length === 0) {
        lyricWrap.innerHTML = `<div>暂无歌词~</div>`;
        lastActiveLyricIndex = -1;
        return;
    }
    let html = "";
    for (const item of lyricLines) {
        html += `<div class="lyric-line" data-time="${item.time}">${item.text}</div>`;
    }
    lyricWrap.innerHTML = html;
    lastActiveLyricIndex = -1;
}

function updateLyricHighlight() {
    if (!lyricLines.length) return;
    const current = audioPlayer.currentTime;
    let activeIndex = 0;
    for (let i = 0; i < lyricLines.length; i++) {
        if (lyricLines[i].time <= current) activeIndex = i;
        else break;
    }
    const domLines = lyricWrap.querySelectorAll(".lyric-line");
    domLines.forEach((el, idx) => {
        if (idx === activeIndex) {
            el.classList.add("active");
            if (lastActiveLyricIndex !== activeIndex) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                lastActiveLyricIndex = activeIndex;
            }
        } else {
            el.classList.remove("active");
        }
    });
}

function updatePlayIcon() {
    if (isPlaying) {
        btnPlay.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>`;
    } else {
        btnPlay.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>`;
    }
}

async function handleNext() {
    if (!currentSong) return;
    historyStack.push(currentSong);
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    if (forwardCache.length === 0) {
        const fallbackMeta = await fetchOneRandomSong();
        if (!fallbackMeta) return;
        forwardCache.push(fallbackMeta);
    }
    currentSong = forwardCache.shift();
    await loadSong(currentSong.filename);
    try {
        await audioPlayer.play();
        isPlaying = true;
        updatePlayIcon();
    } catch (e) {
        isPlaying = false;
        updatePlayIcon();
    }
    fillForwardCache();
}

async function handlePrev() {
    if (historyStack.length === 0 || !currentSong) return;
    forwardCache.unshift(currentSong);
    const prevMeta = historyStack.pop();
    currentSong = prevMeta;
    await loadSong(currentSong.filename);
    try {
        await audioPlayer.play();
        isPlaying = true;
        updatePlayIcon();
    } catch (e) {
        isPlaying = false;
        updatePlayIcon();
    }
}

async function fetchAllLikes() {
    try {
        const res = await fetch(`${API_BASE}/api/allLikes`);
        likeMap = await res.json();
    } catch (err) {
        likeMap = {};
    }
}

const VOLUME_ICON_ON = `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
const VOLUME_ICON_OFF = `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;

function updateVolumeUI() {
    const v = audioPlayer.muted ? 0 : audioPlayer.volume;
    volumeSlider.value = Math.round(v * 100);
    volumeText.textContent = Math.round(v * 100) + "%";
    btnMute.innerHTML = v === 0 ? VOLUME_ICON_OFF : VOLUME_ICON_ON;
    btnMute.classList.toggle("muted", v === 0);
}

function restoreVolume() {
    let v = parseFloat(localStorage.getItem("radio_volume"));
    if (isNaN(v) || v < 0 || v > 1) v = 0.8;
    audioPlayer.volume = v;
    audioPlayer.muted = localStorage.getItem("radio_muted") === "1";
    updateVolumeUI();
}

// 悬浮音量条：缓冲显示/隐藏（留出鼠标从音量键移到音量条的时间）
let volumeHideTimer = null;
function showVolumePopover() {
    clearTimeout(volumeHideTimer);
    volumePopover.classList.add("open");
}
function scheduleHideVolumePopover() {
    clearTimeout(volumeHideTimer);
    volumeHideTimer = setTimeout(() => {
        volumePopover.classList.remove("open");
    }, 150);
}

function bindEvents() {
    themeBtn.addEventListener("click", toggleDarkMode);
    btnPlay.addEventListener("click", async () => {
        if (isPlaying) {
            audioPlayer.pause();
            isPlaying = false;
            updatePlayIcon();
        } else {
            try {
                await audioPlayer.play();
                isPlaying = true;
                updatePlayIcon();
            } catch (e) {}
        }
    });
    btnNext.addEventListener("click", handleNext);
    btnPrev.addEventListener("click", handlePrev);
    btnLike.addEventListener("click", async () => {
        if (!currentSong?.filename) return;
        try {
            const res = await fetch(`${API_BASE}/api/like?key=${encodeURIComponent(currentSong.filename)}`);
            const data = await res.json();
            likeMap[currentSong.filename] = data.count;
            likeCountText.innerText = data.count;
        } catch (err) {}
    });
    audioPlayer.addEventListener("ended", handleNext);
    audioPlayer.addEventListener("timeupdate", updateLyricHighlight);
    volumeSlider.addEventListener("input", () => {
        const v = Number(volumeSlider.value) / 100;
        audioPlayer.volume = v;
        if (v > 0) audioPlayer.muted = false;
        localStorage.setItem("radio_volume", String(v));
        localStorage.setItem("radio_muted", audioPlayer.muted ? "1" : "0");
        updateVolumeUI();
    });
    btnMute.addEventListener("click", () => {
        audioPlayer.muted = !audioPlayer.muted;
        localStorage.setItem("radio_muted", audioPlayer.muted ? "1" : "0");
        updateVolumeUI();
    });
    volumeControl.addEventListener("mouseenter", showVolumePopover);
    volumeControl.addEventListener("mouseleave", scheduleHideVolumePopover);
}

async function init() {
    const requireDom = [themeBtn,coverImg,songTitleEl,songArtistEl,lyricWrap,audioPlayer,btnPlay,btnNext,btnPrev,btnLike,likeCountText];
    if(requireDom.some(x=>!x)) console.error("DOM缺失");
    const savedDark = localStorage.getItem("radio_dark");
    isDarkMode = savedDark === "1";
    const root = document.documentElement;
    if(isDarkMode) root.setAttribute("data-theme","dark");
    else root.removeAttribute("data-theme");

    lyricWrap.innerHTML = `<div>正在初始化...</div>`;
    restoreVolume();
    await fetchAllLikes();
    const firstMeta = await fetchOneRandomSong();
    if (!firstMeta) {
        songTitleEl.innerText = "获取歌曲失败";
        songArtistEl.innerText = "";
        lyricWrap.innerHTML = `<div>请检查Worker接口</div>`;
        return;
    }
    currentSong = firstMeta;
    await loadSong(currentSong.filename);
    fillForwardCache();
    bindEvents();
}

document.addEventListener('DOMContentLoaded', async () => {
    if(window.ColorThief) colorThief = new window.ColorThief();
    await init();
});
