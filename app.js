// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// app.js — 기책 SPA 메인. 무드 선택 → 추천 랭킹 → 재생(Web Audio) → 좋아요 학습.
// localStorage 영속화(try/catch + 초기화). 데모 모드.

import {
  MOOD_PROFILES, buildTaste, recommend, similarTracks, dailyMix, discoverNewArtists,
} from "./recommender.js";
import { AudioEngine } from "./audio.js";
import { askAI } from "./ai/ai.js";
import { AI_ENDPOINT } from "./ai/config.js";

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
  mode: "mood",   // mood | daily | similar | ai
  aiRanked: [],   // AI DJ 결과(ranked 배열)
  aiTitle: "",    // AI DJ 플레이리스트 제목
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
  if (state.mode === "ai") ranked = state.aiRanked;
  else if (state.mode === "daily") ranked = dailyMix(state.tracks, taste(), { limit: 15 });
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
  const titles = { mood: `추천 · ${MOOD_PROFILES[state.mood]?.label || ""}`, daily: "✨ 데일리 믹스", similar: "유사곡 추천", ai: state.aiTitle || "🤖 AI DJ" };
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

/* ---------- AI 기능 (DJ · 추천 이유 · 카피) ---------- */
// #ai-output 을 열고, 스트리밍 토큰을 이어 붙이는 onToken 콜백을 돌려준다.
function aiOutputStream(prefix = "") {
  const el = $("ai-output");
  el.hidden = false;
  el.textContent = prefix;
  el.classList.add("streaming");
  return (tok) => { el.textContent += tok; };
}
function aiOutputDone() { $("ai-output").classList.remove("streaming"); }
function aiBusy(on) {
  for (const id of ["ai-dj-btn", "ai-copy-btn", "ai-reasons-btn"]) $(id).disabled = on;
}

// AI DJ: 자유 문장 → (규칙 엔진)플레이리스트 + (AI)서술.
async function runAIDj() {
  const text = $("ai-dj-input").value.trim();
  if (!text) { $("ai-dj-input").focus(); return; }
  const onToken = aiOutputStream("");
  aiBusy(true);
  try {
    const { data } = await askAI("dj", {
      text, tracks: state.tracks, likes: state.likes, dislikes: state.dislikes, limit: 15,
    }, { onToken });
    // 해석된 무드를 반영하고 플레이리스트를 렌더
    state.mood = data.interpretation.mood;
    state.mode = "ai";
    state.aiRanked = data.playlist;
    state.aiTitle = `🤖 AI DJ · ${data.interpretation.label}`;
    renderMoods();
    refresh();
    saveState();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    $("ai-output").textContent = `AI 요청 실패: ${err.message}`;
    console.error(err);
  } finally { aiBusy(false); aiOutputDone(); }
}

// 무드 카피 생성.
async function runAICopy() {
  const onToken = aiOutputStream("");
  aiBusy(true);
  try { await askAI("copy", { mood: state.mood }, { onToken }); }
  catch (err) { $("ai-output").textContent = `AI 요청 실패: ${err.message}`; }
  finally { aiBusy(false); aiOutputDone(); }
}

// 현재 플레이리스트 상위 곡의 추천 이유 서술.
async function runAIReasons() {
  const top = currentRanked().slice(0, 5).map((r) => r.track);
  if (!top.length) { $("ai-output").hidden = false; $("ai-output").textContent = "먼저 플레이리스트를 만들어 주세요."; return; }
  const onToken = aiOutputStream("");
  aiBusy(true);
  try {
    const mood = state.mode === "ai" || state.mode === "mood" ? state.mood : null;
    await askAI("reasons", { tracks: top, mood }, { onToken });
  } catch (err) { $("ai-output").textContent = `AI 요청 실패: ${err.message}`; }
  finally { aiBusy(false); aiOutputDone(); }
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

  // AI 기능
  $("ai-dj-btn").addEventListener("click", runAIDj);
  $("ai-dj-input").addEventListener("keydown", (e) => { if (e.key === "Enter") runAIDj(); });
  $("ai-copy-btn").addEventListener("click", runAICopy);
  $("ai-reasons-btn").addEventListener("click", runAIReasons);

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

/* ---------- 무인: 지금 시간대 무드 자동 플레이리스트 ---------- */
// 로컬 시각(시간대) → 무드. 규칙 엔진의 무드 id 로만 매핑(결정론적).
function moodForHour(h) {
  if (h >= 5 && h < 9)   return { mood: "happy",   when: "상쾌한 아침" };
  if (h >= 9 && h < 12)  return { mood: "focus",   when: "집중이 필요한 오전" };
  if (h >= 12 && h < 14) return { mood: "happy",   when: "기분 좋은 점심" };
  if (h >= 14 && h < 18) return { mood: "focus",   when: "나른한 오후" };
  if (h >= 18 && h < 21) return { mood: "drive",   when: "설레는 저녁" };
  if (h >= 21 && h < 24) return { mood: "comfort", when: "하루를 마무리하는 밤" };
  return { mood: "rainy", when: "고요한 새벽" };
}

// 접속하자마자: 시간대 무드로 플레이리스트를 깔고 AI(또는 mock)가 카피를 서술한다.
async function autoDigest() {
  const box = $("auto-digest");
  if (!box) return;
  const { mood, when } = moodForHour(new Date().getHours());
  const label = MOOD_PROFILES[mood]?.label || mood;
  const emoji = (state.moods.find((m) => m.id === mood) || {}).emoji || "🎵";
  $("auto-emoji").textContent = emoji;
  $("auto-title").textContent = `🕒 ${when} · ‘${label}’ 무드 자동 추천`;
  box.hidden = false;

  // 시간대 무드를 현재 무드로 반영하고 플레이리스트를 미리 렌더(무인).
  state.mood = mood;
  state.mode = "mood";
  renderMoods();
  refresh();

  // AI DJ 카피 생성: 실 API 없거나 실패하면 mock 으로 자동 폴백(오프라인 동작).
  const copyEl = $("auto-copy");
  copyEl.textContent = "";
  try {
    await askAI("copy", { mood }, { onToken: (tok) => { copyEl.textContent += tok; } });
  } catch (_) {
    copyEl.textContent = `${when}엔 ‘${label}’ 무드를 추천해요. 아래 플레이리스트부터 들어보세요. 🎧`;
  }
}

/* ---------- 초기화 ---------- */
async function init() {
  loadState();
  bindEvents();
  // AI 제공자 배지: 엔드포인트가 있으면 실 API, 없으면 데모(mock)
  const badge = $("ai-badge");
  if (badge) {
    badge.textContent = AI_ENDPOINT ? "API" : "MOCK";
    badge.classList.toggle("live", !!AI_ENDPOINT);
    badge.title = AI_ENDPOINT ? `실 Claude 연동: ${AI_ENDPOINT}` : "데모 모드 — 서버 없이 로컬 규칙 엔진으로 생성";
  }
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
  // 무인: 접속 시각 기준 자동 플레이리스트 + AI 카피(실패 시 mock 폴백).
  autoDigest();
}

init();
