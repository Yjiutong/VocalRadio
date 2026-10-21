// =============================================================
// 术力口电台 · 播放器逻辑
//
// 界面是卡片式的，但状态机没变：
//   歌单（playlist.txt）→ 随机取一首 → 播放 → 历史栈 / 前进缓存
// 计数接口与页面同源（functions/api/*.js），所以 API_BASE 留空。
// =============================================================

const API_BASE = "";

// ---------- DOM ----------
const themeBtn = document.querySelector("#theme");
const themeLabel = document.querySelector("#themeLabel");
const ambientImg = document.querySelector("#ambientImg");
const coverImg = document.querySelector("#coverImg");
const songTitleEl = document.querySelector("#songTitle");
const songArtistEl = document.querySelector("#songArtist");
const nowIndexEl = document.querySelector("#nowIndex");
const lyricWrap = document.querySelector("#lyricWrap");
const lyricBox = document.querySelector("#lyricBox");
const playlistList = document.querySelector("#playlistList");
const listCountEl = document.querySelector("#listCount");
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
const seekEl = document.querySelector("#seek");
const timeNowEl = document.querySelector("#timeNow");
const timeTotalEl = document.querySelector("#timeTotal");

// ---------- 状态 ----------
let lyricLines = [];
let likeMap = {};
let isPlaying = false;
let isDarkMode = false;
let dynDark = [14, 58, 56];
let dynLight = [220, 248, 246];
let lastActiveLyricIndex = -1;
let colorThief = null;
let seeking = false;

const MAX_HISTORY = 10;
const MAX_FORWARD = 20;
const CAN_HOVER = window.matchMedia("(hover: hover)").matches;
let currentSong = null;
let historyStack = [];
let forwardCache = [];

const PLAY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.5-6.86a1 1 0 0 0 0-1.7L9.52 4.3A1 1 0 0 0 8 5.14z"/></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4.5h3.2a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zm6.8 0H17a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-3.2a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z"/></svg>`;
const VOLUME_ICON_ON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9a1 1 0 0 1 1-1h2.6l3.9-3.4A1 1 0 0 1 13 5.3v13.4a1 1 0 0 1-1.5.7L7.6 16H5a1 1 0 0 1-1-1V9zm11.5 3a3.5 3.5 0 0 0-1.5-2.9v5.8a3.5 3.5 0 0 0 1.5-2.9zm-1.5-7v2.2A5.9 5.9 0 0 1 18 12a5.9 5.9 0 0 1-4 5.8V20a8 8 0 0 0 6-8 8 8 0 0 0-6-8z"/></svg>`;
const VOLUME_ICON_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9a1 1 0 0 1 1-1h2.6l3.9-3.4A1 1 0 0 1 13 5.3v13.4a1 1 0 0 1-1.5.7L7.6 16H5a1 1 0 0 1-1-1V9zm17.3 3-2.2-2.2-1.4 1.4 2.2 2.2-2.2 2.2 1.4 1.4 2.2-2.2 2.2 2.2 1.4-1.4-2.2-2.2 2.2-2.2-1.4-1.4-2.2 2.2z"/></svg>`;

// =============================================================
// 主题：只改「主题色」，背景层不动
// =============================================================
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
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return [h * 360, s * 100, l * 100];
}

/**
 * 取色结果 → 唯一的主题色（色相 + 饱和度）。
 * 深/浅主题都在 CSS 里由这两个变量派生（--accent-ink / --accent-fill …），
 * 所以切换主题不会碰到背景，只换卡片与文字的配色。
 */
function applyTheme(dark, light) {
  const [hD, sD] = rgbToHsl(...dark);
  const [hL, sL] = rgbToHsl(...light);
  // 取饱和度更高的一支作为主色，另一个通常是同色系的黑/白，没有色相意义
  const useDark = sD >= sL;
  let h = useDark ? hD : hL;
  let s = useDark ? sD : sL;
  // 封面接近灰度时给个克制的保底，避免变成一团灰按钮
  s = Math.max(s, 20);
  s = Math.min(s, 92);
  if (!Number.isFinite(h)) h = 174;

  const root = document.documentElement;
  root.style.setProperty("--accent-h", String(Math.round(h)));
  root.style.setProperty("--accent-s", `${Math.round(s)}%`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      "content",
      `hsl(${Math.round(h)} ${Math.round(s)}% ${isDarkMode ? 30 : 62}%)`
    );
  }
}

function syncThemeButton() {
  const root = document.documentElement;
  if (isDarkMode) root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");

  // 按钮文案 = 点下去之后会变成什么
  themeLabel.textContent = isDarkMode ? "浅色" : "深色";
  themeBtn.setAttribute("aria-pressed", isDarkMode ? "true" : "false");
  themeBtn.setAttribute("aria-label", isDarkMode ? "切换到浅色主题" : "切换到深色主题");
  themeBtn.title = isDarkMode ? "切换到浅色主题" : "切换到深色主题";
}

function toggleDarkMode() {
  isDarkMode = !isDarkMode;
  localStorage.setItem("radio_dark", isDarkMode ? "1" : "0");
  syncThemeButton();
  applyTheme(dynDark, dynLight);
}

// =============================================================
// 歌曲 / 歌单
// =============================================================
function parseSongName(rawFileName) {
  const base = rawFileName.replace(/\.mp3$/i, "");
  const parts = base.split("_");
  const id = parts[0];
  const singer = parts[1] ?? "未知歌手";
  const title = parts.slice(2).join("_") || "未知曲目";
  const encodedBase = encodeURIComponent(base);
  return {
    filename: rawFileName,
    id,
    singer,
    title,
    audioSrc: `./music/${encodedBase}.mp3`,
    coverSrc: `./cover/${encodedBase}.png`,
    thumbCoverSrc: `./cover/thumb/${encodedBase}.png`,
    lrcSrc: `./lyric/${encodedBase}.lrc`,
  };
}

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

// ---------- 歌单卡片 ----------
async function renderPlaylist() {
  const list = await getSongList();
  listCountEl.textContent = list.length ? `${list.length} 首` : "歌单为空";
  playlistList.textContent = "";

  const frag = document.createDocumentFragment();
  list.forEach((file, idx) => {
    const song = parseSongName(file);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "list__row";
    btn.dataset.file = file;
    btn.setAttribute("aria-label", `播放 ${song.title}，${song.singer}`);

    const no = document.createElement("span");
    no.className = "list__no";
    no.textContent = String(idx + 1).padStart(2, "0");

    const textWrap = document.createElement("span");
    textWrap.className = "list__text";
    const title = document.createElement("span");
    title.className = "list__title";
    title.textContent = song.title;
    const artist = document.createElement("span");
    artist.className = "list__artist";
    artist.textContent = song.singer;
    textWrap.append(title, artist);

    const stateEl = document.createElement("span");
    stateEl.className = "list__state";
    stateEl.textContent = "播放中";
    stateEl.setAttribute("aria-hidden", "true");

    btn.append(no, textWrap, stateEl);
    li.append(btn);
    frag.append(li);
  });
  playlistList.append(frag);
  markActiveRow();
}

function markActiveRow() {
  if (!playlistList) return;
  const file = currentSong?.filename || "";
  playlistList.querySelectorAll(".list__row").forEach((row) => {
    if (row.dataset.file === file) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
  });
}

async function updateNowIndex() {
  if (!currentSong) return;
  const list = await getSongList();
  const i = list.indexOf(currentSong.filename);
  nowIndexEl.textContent = i >= 0
    ? `第 ${i + 1} 首 · 共 ${list.length} 首`
    : `共 ${list.length} 首`;
}

// =============================================================
// 载入一首歌
// =============================================================
async function loadSong(rawFileName) {
  lyricWrap.textContent = "";
  if (!rawFileName) return;
  const info = parseSongName(rawFileName);

  songTitleEl.textContent = info.title;
  songArtistEl.textContent = info.singer;
  coverImg.alt = `${info.title} 的封面`;
  updateNowIndex();

  coverImg.crossOrigin = "anonymous";
  let coverFallbackUsed = false;

  // ① 先上低清图，同时用它做背景（同一张图，最省流量）
  coverImg.src = info.thumbCoverSrc;
  setAmbient(info.thumbCoverSrc);

  // ② 后台静默预加载高清原图
  const hdImage = new Image();
  hdImage.crossOrigin = "anonymous";
  hdImage.onload = () => {
    coverImg.src = info.coverSrc;
    // 取色只用高清原图，缩略图会偏色
    handleCoverColor();
  };
  hdImage.onerror = () => {
    if (coverFallbackUsed) return;
    coverFallbackUsed = true;
    coverImg.src = "./cover/default.png";
    dynDark = [14, 58, 56];
    dynLight = [220, 248, 246];
    applyTheme(dynDark, dynLight);
  };
  hdImage.src = info.coverSrc;

  audioPlayer.src = info.audioSrc;
  resetProgress();
  await loadLyric(info.lrcSrc);

  // 播放上报
  fetch(`${API_BASE}/api/play?key=${encodeURIComponent(rawFileName)}`).catch(() => {});

  (async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/getLike?key=${encodeURIComponent(rawFileName)}`);
      const data = await resp.json();
      const realCount = Number(data.count) || 0;
      likeMap[rawFileName] = realCount;
      likeCountText.textContent = String(realCount);
    } catch (err) {
      console.warn("获取单首点赞失败，使用缓存值", err);
      likeCountText.textContent = String(likeMap[rawFileName] ?? 0);
    }
  })();

  isPlaying = false;
  updatePlayIcon();
  markActiveRow();
}

/** 背景层更换封面：低清图 + 淡入，两首之间不会闪白 */
function setAmbient(src) {
  if (!ambientImg || !src) return;
  ambientImg.classList.add("is-swapping");
  const pre = new Image();
  pre.onload = () => {
    ambientImg.src = src;
    ambientImg.classList.remove("is-swapping");
  };
  pre.onerror = () => {
    ambientImg.classList.remove("is-swapping");
  };
  pre.src = src;
}

function handleCoverColor() {
  if (!colorThief) {
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

// =============================================================
// 歌词
// =============================================================
async function loadLyric(lrcUrl) {
  lyricLines = [];
  try {
    const res = await fetch(lrcUrl);
    if (!res.ok) throw new Error("no lrc");
    lyricLines = parseLrc(await res.text());
  } catch (e) {
    lyricLines = [];
  }
  renderLyricHtml();
  if (lyricBox) lyricBox.scrollTop = 0;
}

function parseLrc(lrcText) {
  const reg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
  const result = [];
  for (const line of lrcText.split("\n")) {
    const matches = [...line.matchAll(reg)];
    if (!matches.length) continue;
    const txt = line.replace(reg, "").trim();
    if (!txt) continue;
    for (const m of matches) {
      const time = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000;
      result.push({ time, text: txt });
    }
  }
  result.sort((a, b) => a.time - b.time);
  return result;
}

function renderLyricHtml() {
  lyricWrap.textContent = "";
  lastActiveLyricIndex = -1;

  if (!lyricLines.length) {
    const p = document.createElement("p");
    p.className = "lyrics__placeholder";
    p.textContent = "这首暂无歌词~";
    lyricWrap.append(p);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of lyricLines) {
    const div = document.createElement("p");
    div.className = "lyric-line";
    div.dataset.time = String(item.time);
    div.textContent = item.text; // 用 textContent，歌词里的 < > & 不会破坏结构
    frag.append(div);
  }
  lyricWrap.append(frag);
}

/**
 * 把当前行滚到歌词卡片的正中间。
 * 关键：只滚动歌词容器（lyricBox.scrollTop），绝不用 scrollIntoView ——
 * 那会把整个页面一起滚走，就是之前"高亮时超出显示屏"的来源。
 */
function scrollLyricIntoView(el) {
  if (!lyricBox || !el) return;
  const boxRect = lyricBox.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const delta = elRect.top - boxRect.top + lyricBox.scrollTop;
  const target = delta - (lyricBox.clientHeight - elRect.height) / 2;
  const max = lyricBox.scrollHeight - lyricBox.clientHeight;
  const top = Math.max(0, Math.min(target, Math.max(max, 0)));
  lyricBox.scrollTo({ top, behavior: "smooth" });
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
    const isActive = idx === activeIndex;
    el.classList.toggle("active", isActive);
    el.classList.toggle("past", idx < activeIndex);
  });

  if (lastActiveLyricIndex !== activeIndex) {
    scrollLyricIntoView(domLines[activeIndex]);
    lastActiveLyricIndex = activeIndex;
  }
}

// =============================================================
// 播放控制
// =============================================================
function updatePlayIcon() {
  btnPlay.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
  btnPlay.setAttribute("aria-label", isPlaying ? "暂停" : "播放");
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function setRangeFill(input, ratio) {
  if (!input) return;
  const pct = Math.max(0, Math.min(100, ratio * 100));
  input.style.setProperty("--fill", `${pct}%`);
}

function resetProgress() {
  if (seekEl) {
    seekEl.value = "0";
    setRangeFill(seekEl, 0);
  }
  timeNowEl.textContent = "0:00";
  timeTotalEl.textContent = "0:00";
}

async function playCurrent() {
  try {
    await audioPlayer.play();
    isPlaying = true;
  } catch (e) {
    isPlaying = false;
  }
  updatePlayIcon();
}

async function playTrackByFile(file) {
  if (!file) return;
  if (currentSong && currentSong.filename !== file) {
    historyStack.push(currentSong);
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
  }
  currentSong = parseSongName(file);
  await loadSong(file);
  await playCurrent();
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
  await playCurrent();
  fillForwardCache();
}

async function handlePrev() {
  if (!historyStack.length || !currentSong) return;
  forwardCache.unshift(currentSong);
  currentSong = historyStack.pop();
  await loadSong(currentSong.filename);
  await playCurrent();
}

// =============================================================
// 点赞
// =============================================================
async function fetchAllLikes() {
  try {
    const res = await fetch(`${API_BASE}/api/allLikes`);
    likeMap = await res.json();
  } catch (err) {
    likeMap = {};
  }
}

async function sendLike() {
  if (!currentSong?.filename) return;
  try {
    const res = await fetch(`${API_BASE}/api/like?key=${encodeURIComponent(currentSong.filename)}`);
    const data = await res.json();
    const count = Number(data.count) || 0;
    likeMap[currentSong.filename] = count;
    likeCountText.textContent = String(count);
    btnLike.classList.remove("is-popping");
    void btnLike.offsetWidth; // 重新触发动画
    btnLike.classList.add("is-popping");
  } catch (err) {
    console.warn("点赞失败", err);
  }
}

// =============================================================
// 音量
// =============================================================
function updateVolumeUI() {
  const v = audioPlayer.muted ? 0 : audioPlayer.volume;
  volumeSlider.value = String(Math.round(v * 100));
  setRangeFill(volumeSlider, v);
  volumeText.textContent = `${Math.round(v * 100)}%`;
  btnMute.innerHTML = v === 0 ? VOLUME_ICON_OFF : VOLUME_ICON_ON;
  btnMute.setAttribute(
    "aria-label",
    CAN_HOVER ? (v === 0 ? "取消静音" : "静音") : "音量调节"
  );
}

function restoreVolume() {
  let v = parseFloat(localStorage.getItem("radio_volume"));
  if (Number.isNaN(v) || v < 0 || v > 1) v = 0.8;
  audioPlayer.volume = v;
  audioPlayer.muted = localStorage.getItem("radio_muted") === "1";
  updateVolumeUI();
}

function openVolumeMenu() {
  clearTimeout(volumeHideTimer);
  volumePopover.classList.add("is-open");
  btnMute.setAttribute("aria-expanded", "true");
}

function closeVolumeMenu() {
  clearTimeout(volumeHideTimer);
  volumePopover.classList.remove("is-open");
  btnMute.setAttribute("aria-expanded", "false");
}

let volumeHideTimer = null;
function scheduleHideVolumeMenu() {
  clearTimeout(volumeHideTimer);
  volumeHideTimer = setTimeout(closeVolumeMenu, 180);
}

// =============================================================
// 事件绑定
// =============================================================
function bindEvents() {
  themeBtn.addEventListener("click", toggleDarkMode);

  btnPlay.addEventListener("click", async () => {
    if (isPlaying) {
      audioPlayer.pause();
      isPlaying = false;
      updatePlayIcon();
    } else {
      await playCurrent();
    }
  });

  btnNext.addEventListener("click", handleNext);
  btnPrev.addEventListener("click", handlePrev);
  btnLike.addEventListener("click", sendLike);
  audioPlayer.addEventListener("ended", handleNext);
  audioPlayer.addEventListener("timeupdate", updateLyricHighlight);

  // 进度条
  audioPlayer.addEventListener("loadedmetadata", () => {
    timeTotalEl.textContent = fmtTime(audioPlayer.duration);
    if (!seeking) {
      seekEl.value = "0";
      setRangeFill(seekEl, 0);
    }
  });
  audioPlayer.addEventListener("timeupdate", () => {
    const dur = audioPlayer.duration;
    timeNowEl.textContent = fmtTime(audioPlayer.currentTime);
    if (!seeking && Number.isFinite(dur) && dur > 0) {
      const ratio = audioPlayer.currentTime / dur;
      seekEl.value = String(Math.round(ratio * 1000));
      setRangeFill(seekEl, ratio);
    }
  });
  seekEl.addEventListener("input", () => {
    seeking = true;
    const dur = audioPlayer.duration;
    const ratio = Number(seekEl.value) / 1000;
    setRangeFill(seekEl, ratio);
    if (Number.isFinite(dur) && dur > 0) timeNowEl.textContent = fmtTime(ratio * dur);
  });
  seekEl.addEventListener("change", () => {
    const dur = audioPlayer.duration;
    if (Number.isFinite(dur) && dur > 0) {
      audioPlayer.currentTime = (Number(seekEl.value) / 1000) * dur;
    }
    seeking = false;
  });

  // 歌单：事件委托，点哪首播哪首
  playlistList.addEventListener("click", (e) => {
    const row = e.target.closest(".list__row");
    if (!row) return;
    const file = row.dataset.file;
    if (!file) return;
    if (currentSong?.filename === file) {
      // 点当前这首 = 播放 / 暂停
      if (isPlaying) {
        audioPlayer.pause();
        isPlaying = false;
        updatePlayIcon();
      } else {
        playCurrent();
      }
      return;
    }
    playTrackByFile(file);
  });

  // 音量
  volumeSlider.addEventListener("input", () => {
    const v = Number(volumeSlider.value) / 100;
    audioPlayer.volume = v;
    if (v > 0) audioPlayer.muted = false;
    localStorage.setItem("radio_volume", String(v));
    localStorage.setItem("radio_muted", audioPlayer.muted ? "1" : "0");
    updateVolumeUI();
  });
  btnMute.addEventListener("click", () => {
    // 桌面有 hover：点击 = 静音开关（滑杆靠悬浮出来）
    // 触屏没有 hover：点击 = 展开滑杆（拖到 0 即静音），否则滑杆永远打不开
    if (!CAN_HOVER) {
      if (volumePopover.classList.contains("is-open")) closeVolumeMenu();
      else openVolumeMenu();
      return;
    }
    audioPlayer.muted = !audioPlayer.muted;
    localStorage.setItem("radio_muted", audioPlayer.muted ? "1" : "0");
    updateVolumeUI();
  });
  volumeControl.addEventListener("mouseenter", openVolumeMenu);
  volumeControl.addEventListener("mouseleave", scheduleHideVolumeMenu);
  volumeControl.addEventListener("focusin", openVolumeMenu);
  volumeControl.addEventListener("focusout", (e) => {
    if (!volumeControl.contains(e.relatedTarget)) scheduleHideVolumeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeVolumeMenu();
  });
  document.addEventListener("click", (e) => {
    if (!volumeControl.contains(e.target)) closeVolumeMenu();
  });
}

// =============================================================
// 启动
// =============================================================
async function init() {
  const savedDark = localStorage.getItem("radio_dark");
  isDarkMode = savedDark === "1";
  syncThemeButton();

  restoreVolume();
  await fetchAllLikes();
  await renderPlaylist();

  const firstMeta = await fetchOneRandomSong();
  if (!firstMeta) {
    songTitleEl.textContent = "获取歌曲失败";
    songArtistEl.textContent = "";
    nowIndexEl.textContent = "歌单为空";
    lyricWrap.innerHTML = '<p class="lyrics__placeholder">请检查仓库根目录的 playlist.txt</p>';
    return;
  }

  currentSong = firstMeta;
  await loadSong(currentSong.filename);
  fillForwardCache();
  bindEvents();
}

document.addEventListener("DOMContentLoaded", async () => {
  if (window.ColorThief) colorThief = new window.ColorThief();
  await init();
});
