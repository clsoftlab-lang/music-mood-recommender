// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// app.js — 기책 SPA 메인. 무드 선택 → 추천 랭킹 → 재생(Web Audio) → 좋아요 학습.
// localStorage 영속화(try/catch + 초기화). 데모 모드.

import {
  MOOD_PROFILES, buildTaste, recommend, similarTracks, dailyMix, discoverNewArtists,
} from "./recommender.js";
import { AudioEngine } from "./audio.js";

const STORE_KEY = "gichaek_state_v1";
const engine = new AudioEngine();

const state = {
  tracks: [],
  moods: [],
  mood: "happy",
  likes: [],
  dislikes: [],
  energy: null,   // null = 자동(무드 기준)
  valence: null,
  genre: "",
  search: "",
  queue: [],      // 현재 재생 큐 (track 객체 배열)
  index: -1,
  mode: "mood",   // mood | daily | similar
};

/* ---------- 영속화 ---------- */
function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      likes: state.likes, dislikes: state.dislikes,
      theme: document.documentElement.dataset.theme,
      volume: engine.volume, mood: state.mood,
    }));
  } catch (_) { /* 무시: 프라이빗 모드 등 */ }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (Array.isArray(s.likes)) state.likes = s.likes;
    if (Array.isArray(s.dislikes)) state.dislikes = s.dislikes;
    if (typeof s.mood === "string") state.mood = s.mood;
    if (typeof s.theme === "string") document.documentElement.dataset.theme = s.theme;
    if (typeof s.volume === "number") engine.setVolume(s.volume);
  } catch (_) { /* 손상 시 무시하고 기본값 */ }
}

/* ---------- 유틸 ---------- */
const $ = (id) => document.getElementById(id);
function hue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function svgCover(track) {
  const h1 = hue(track.id + track.genre);
  const h2 = (h1 + 60 + Math.round(track.valence * 120)) % 360;
  const l = 45 + Math.round(track.energy * 15);
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
      <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0' stop-color='hsl(${h1},70%,${l}%)'/>
        <stop offset='1' stop-color='hsl(${h2},65%,${l - 10}%)'/>
      </linearGradient></defs>
      <rect width='100' height='100' rx='14' fill='url(%23g)'/>
      <circle cx='${30 + track.tempo % 40}' cy='42' r='${10 + track.energy * 14}' fill='rgba(255,255,255,0.18)'/>
      <text x='50' y='86' font-size='11' text-anchor='middle' fill='rgba(255,255,255,0.85)' font-family='sans-serif'>${track.genre}</text>
    </svg>`.replace(/\s+/g, " ")
  )}`;
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function taste() { return buildTaste(state.likes, state.dislikes, state.tracks); }

/* ---------- 렌더링 ---------- */
function renderMoods() {
  const grid = $("mood-grid");
  grid.innerHTML = "";
  for (const m of state.moods) {
    const btn = document.createElement("button");
    btn.className = "mood-chip" + (m.id === state.mood ? " active" : "");
    btn.setAttribute("role", "listitem");
    btn.innerHTML = `<span class="emoji">${m.emoji}</span><span class="lbl">${m.label}</span><small>${m.desc}</small>`;
    btn.addEventListener("click", () => {
      state.mood = m.id;
      state.mode = "mood";
      state.energy = null; state.valence = null;
      $("energy-slider").value = 50; $("valence-slider").value = 50;
      $("energy-val").textContent = "자동"; $("valence-val").textContent = "자동";
      renderMoods();
      refresh();
      saveState();
    });
    grid.appendChild(btn);
  }
}

function currentRanked() {
  const opt = {
    mood: state.mode === "mood" ? state.mood : null,
    taste: taste(),
    genre: state.genre || null,
    energyTarget: state.energy,
    valenceTarget: state.valence,
    boostNewArtist: true,
  };
  let ranked;
  if (state.mode === "daily") ranked = dailyMix(state.tracks, taste(), { limit: 15 });
  else ranked = recommend(state.tracks, opt);
  // 검색 필터
  if (state.search) {
    const q = state.search.toLowerCase();
    ranked = ranked.filter((r) => {
      const t = r.track;
      return t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.genre.toLowerCase().includes(q) ||
        (t.tags || []).some((tg) => tg.includes(q));
    });
  }
  return ranked;
}

function renderPlaylist() {
  const ranked = currentRanked();
  state.queue = ranked.map((r) => r.track);
  const ol = $("playlist");
  ol.innerHTML = "";
  const titles = { mood: `추천 · ${MOOD_PROFILES[state.mood]?.label || ""}`, daily: "✨ 데일리 믹스", similar: "유사곡 추천" };
  $("playlist-title").textContent = titles[state.mode] || "추천 플레이리스트";
  if (!ranked.length) { ol.innerHTML = `<li class="empty">조건에 맞는 곡이 없어요.</li>`; return; }
  ranked.forEach((r, i) => ol.appendChild(trackRow(r, i)));
}

function trackRow(r, i) {
  const t = r.track;
  const li = document.createElement("li");
  li.className = "track" + (state.index === i && state.queue[i]?.id === t.id ? " playing" : "");
  const liked = state.likes.includes(t.id);
  const disliked = state.dislikes.includes(t.id);
  const pct = Math.round((r.score ?? 0) * 100);
  li.innerHTML = `
    <img class="cover" src="${svgCover(t)}" alt="" width="52" height="52" />
    <div class="t-main">
      <div class="t-title">${t.title} ${t.isNewArtist ? '<span class="badge-new">신인</span>' : ""}</div>
      <div class="t-sub">${t.artist} · ${t.genre} · ${t.tempo}BPM</div>
      <div class="t-reasons">${(r.reasons || []).slice(0, 3).map((x) => `<span>${x}</span>`).join("")}</div>
    </div>
    <div class="t-right">
      <span class="match" title="매칭 점수">${pct}%</span>
      <div class="t-actions">
        <button class="mini play" title="재생">▶</button>
        <button class="mini like ${liked ? "on" : ""}" title="좋아요">${liked ? "❤️" : "🤍"}</button>
        <button class="mini dislike ${disliked ? "on" : ""}" title="싫어요">👎</button>
        <button class="mini sim" title="비슷한 곡">🔁</button>
      </div>
    </div>`;
  li.querySelector(".play").addEventListener("click", () => playIndex(i));
  li.querySelector(".cover").addEventListener("click", () => playIndex(i));
  li.querySelector(".like").addEventListener("click", () => toggleLike(t.id));
  li.querySelector(".dislike").addEventListener("click", () => toggleDislike(t.id));
  li.querySelector(".sim").addEventListener("click", () => showSimilar(t));
  return li;
}

function renderDiscover() {
  const list = discoverNewArtists(state.tracks, { taste: taste(), limit: 6 });
  const ol = $("discover");
  ol.innerHTML = "";
  list.forEach((r) => {
    const t = r.track;
    const li = document.createElement("li");
    li.className = "track mini-row";
    li.innerHTML = `
      <img class="cover sm" src="${svgCover(t)}" alt="" width="40" height="40" />
      <div class="t-main"><div class="t-title">${t.title}</div><div class="t-sub">${t.artist} · ${t.genre}</div></div>
      <button class="mini play" title="재생">▶</button>`;
    li.querySelector(".play").addEventListener("click", () => playTrackObj(t));
    li.querySelector(".cover").addEventListener("click", () => playTrackObj(t));
    ol.appendChild(li);
  });
}

function renderTaste() {
  const tw = taste().tagWeight;
  const box = $("taste-profile");
  const top = Object.entries(tw).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length) { box.innerHTML = `<p class="muted">좋아요를 누르면 취향을 학습해요 🎵</p>`; return; }
  const max = top[0][1];
  box.innerHTML = top.map(([tag, v]) =>
    `<div class="taste-bar"><span>${tag}</span><i style="width:${Math.round(v / max * 100)}%"></i></div>`
  ).join("") + `<p class="muted">좋아요 ${state.likes.length} · 싫어요 ${state.dislikes.length}</p>`;
}

function renderGenres() {
  const sel = $("genre-select");
  const genres = [...new Set(state.tracks.map((t) => t.genre))].sort();
  for (const g of genres) {
    const o = document.createElement("option");
    o.value = g; o.textContent = g;
    sel.appendChild(o);
  }
}

function refresh() {
  renderPlaylist();
  renderDiscover();
  renderTaste();
}

/* ---------- 좋아요/싫어요 학습 ---------- */
function toggleLike(id) {
  state.dislikes = state.dislikes.filter((x) => x !== id);
  state.likes = state.likes.includes(id) ? state.likes.filter((x) => x !== id) : [...state.likes, id];
  saveState();
  refresh();
  syncNowPlayingButtons();
}
function toggleDislike(id) {
  state.likes = state.likes.filter((x) => x !== id);
  state.dislikes = state.dislikes.includes(id) ? state.dislikes.filter((x) => x !== id) : [...state.dislikes, id];
  saveState();
  refresh();
  syncNowPlayingButtons();
}

/* ---------- 유사곡 ---------- */
function showSimilar(track) {
  const sims = similarTracks(track, state.tracks, { limit: 12 });
  state.mode = "similar";
  state.queue = sims.map((r) => r.track);
  const ol = $("playlist");
  $("playlist-title").textContent = `🔁 "${track.title}"와 비슷한 곡`;
  ol.innerHTML = "";
  sims.forEach((r, i) => ol.appendChild(trackRow({ track: r.track, score: r.score, reasons: ["유사도 높음"] }, i)));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- 플레이어 ---------- */
function playIndex(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.index = i;
  const t = state.queue[i];
  engine.load(t);
  engine.play(t);
  updateNowPlaying(t);
  refreshPlayingHighlight();
}
function playTrackObj(t) {
  const i = state.queue.findIndex((x) => x.id === t.id);
  if (i >= 0) return playIndex(i);
  // 큐에 없으면 큐 맨 앞에 넣어 재생
  state.queue.unshift(t);
  state.index = 0;
  engine.load(t); engine.play(t);
  updateNowPlaying(t);
}
function togglePlay() {
  if (state.index < 0 && state.queue.length) return playIndex(0);
  const playing = engine.toggle(state.queue[state.index]);
  $("btn-play").textContent = playing ? "⏸" : "▶";
}
function next() {
  if (!state.queue.length) return;
  playIndex((state.index + 1) % state.queue.length);
}
function prev() {
  if (!state.queue.length) return;
  playIndex((state.index - 1 + state.queue.length) % state.queue.length);
}
function updateNowPlaying(t) {
  $("player").dataset.active = "true";
  $("now-title").textContent = t.title;
  $("now-artist").textContent = `${t.artist} · ${t.genre}`;
  $("now-art").style.backgroundImage = `url("${svgCover(t)}")`;
  $("btn-play").textContent = "⏸";
  syncNowPlayingButtons();
}
function syncNowPlayingButtons() {
  const t = state.queue[state.index];
  if (!t) return;
  $("btn-like").textContent = state.likes.includes(t.id) ? "❤️" : "🤍";
  $("btn-dislike").style.opacity = state.dislikes.includes(t.id) ? "1" : "0.6";
}
function refreshPlayingHighlight() {
  document.querySelectorAll("#playlist .track").forEach((el, idx) => {
    el.classList.toggle("playing", idx === state.index);
  });
}

function tickProgress() {
  const p = engine.getPosition();
  $("progress-bar").style.width = `${(p.fraction * 100).toFixed(1)}%`;
  $("cur-time").textContent = fmtTime(p.seconds);
  $("dur-time").textContent = fmtTime(p.duration);
  requestAnimationFrame(tickProgress);
}

/* ---------- 이벤트 바인딩 ---------- */
function bindEvents() {
  $("btn-play").addEventListener("click", togglePlay);
  $("btn-next").addEventListener("click", next);
  $("btn-prev").addEventListener("click", prev);
  $("btn-like").addEventListener("click", () => { const t = state.queue[state.index]; if (t) toggleLike(t.id); });
  $("btn-dislike").addEventListener("click", () => { const t = state.queue[state.index]; if (t) toggleDislike(t.id); });
  $("volume").addEventListener("input", (e) => { engine.setVolume(e.target.value / 100); saveState(); });

  $("progress-track").addEventListener("click", (e) => {
    // 생성 오디오는 루프 기반 — 클릭 위치로 대략 이동(데모)
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    engine._elapsedAtStart = frac * engine.loopDuration;
    if (engine.playing) { engine._startTime = engine.ctx.currentTime; engine._step = Math.round(engine._elapsedAtStart / engine._plan.stepDur); }
  });

  $("energy-slider").addEventListener("input", (e) => {
    state.energy = e.target.value / 100;
    $("energy-val").textContent = `${e.target.value}%`;
    if (state.mode !== "mood") state.mode = "mood";
    refresh();
  });
  $("valence-slider").addEventListener("input", (e) => {
    state.valence = e.target.value / 100;
    $("valence-val").textContent = `${e.target.value}%`;
    if (state.mode !== "mood") state.mode = "mood";
    refresh();
  });
  $("search-input").addEventListener("input", (e) => { state.search = e.target.value.trim(); refresh(); });
  $("genre-select").addEventListener("change", (e) => { state.genre = e.target.value; refresh(); });
  $("daily-mix-btn").addEventListener("click", () => { state.mode = "daily"; refresh(); window.scrollTo({ top: 0, behavior: "smooth" }); });

  $("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = cur === "dark" ? "light" : cur === "light" ? "auto" : "dark";
    saveState();
  });
  $("reset-btn").addEventListener("click", () => {
    if (!confirm("취향/좋아요 기록을 모두 지울까요?")) return;
    state.likes = []; state.dislikes = [];
    try { localStorage.removeItem(STORE_KEY); } catch (_) { /* 무시 */ }
    refresh(); syncNowPlayingButtons();
  });
}

/* ---------- 초기화 ---------- */
async function init() {
  loadState();
  bindEvents();
  $("volume").value = Math.round(engine.volume * 100);
  try {
    const res = await fetch("./data/tracks.json");
    const data = await res.json();
    state.tracks = data.tracks;
    state.moods = data.moods;
  } catch (err) {
    $("playlist").innerHTML = `<li class="empty">트랙 데이터를 불러오지 못했습니다. (로컬 서버에서 실행하세요)</li>`;
    console.error(err);
    return;
  }
  renderMoods();
  renderGenres();
  refresh();
  requestAnimationFrame(tickProgress);
}

init();
