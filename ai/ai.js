// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/ai.js — 보안·플러그형 AI 레이어.
//
//   askAI(task, payload, { onToken }) — 하나의 진입점.
//     · AI_ENDPOINT 가 비어 있으면(데모)  → 결정론적 한국어 MockProvider.
//         recommender.js 와 payload.tracks 를 그대로 재사용하므로 서버 없이도 동작.
//     · AI_ENDPOINT 가 설정되어 있으면      → POST {task,payload} 후 텍스트를 스트리밍.
//
//   구조: data(결정론적, 항상 recommender 로 계산) + text(생성형, mock 또는 Claude).
//   이렇게 나눠 두면 실제 AI를 붙이든 떼든 플레이리스트/추천은 항상 동작합니다.
//   ⚠️ 이 파일은 브라우저에서 실행됩니다. API 키는 절대 여기에 두지 않습니다.

import { MOOD_PROFILES, buildTaste, recommend, scoreTrack } from "../recommender.js";
import { AI_ENDPOINT } from "./config.js";

/* ─────────── 자연어 무드 파서 (결정론적) ─────────── */
// 키워드 → 무드 가중치. 여러 무드가 걸리면 점수 합이 큰 무드를 고른다(동점은 정의 순).
const MOOD_KEYWORDS = {
  happy:   ["행복", "신나", "신남", "기분좋", "밝", "설레", "파티", "happy", "party", "아침", "축하"],
  comfort: ["위로", "위안", "지친", "지쳐", "힘든", "힘들", "슬픔", "슬퍼", "우울", "쉬고", "휴식", "comfort", "따뜻", "포근"],
  focus:   ["집중", "공부", "작업", "일할", "몰입", "study", "focus", "코딩", "독서", "시험"],
  workout: ["운동", "헬스", "달리기", "뛰", "런닝", "러닝", "gym", "workout", "격렬", "땀", "심박"],
  rainy:   ["비", "빗", "장마", "우산", "rain", "rainy", "센치", "몽환"],
  drive:   ["드라이브", "도로", "밤길", "밤도로", "달리", "질주", "drive", "야경", "시티팝", "citypop", "밤"],
};
// 에너지/발랄도 힌트 (0..1 목표를 미세 조정)
const LOW_ENERGY  = ["잔잔", "조용", "차분", "느긋", "나른", "편안", "고요"];
const HIGH_ENERGY = ["신나", "격렬", "강렬", "빵빵", "터지", "질주", "빠른", "hype"];
const LOW_VAL     = ["슬", "우울", "어두", "센치", "쓸쓸", "먹먹"];
const HIGH_VAL    = ["밝", "행복", "설레", "상쾌", "화창", "기분좋"];

/**
 * 자유 문장에서 무드와 에너지·발랄도 목표를 추정한다(결정론적).
 * @returns {{mood:string, label:string, energyTarget:number, valenceTarget:number, matched:string[]}}
 */
export function interpretMood(text = "") {
  const q = String(text).toLowerCase();
  const scores = {};
  const matched = [];
  for (const [mood, words] of Object.entries(MOOD_KEYWORDS)) {
    let s = 0;
    for (const w of words) if (q.includes(w.toLowerCase())) { s++; matched.push(w); }
    scores[mood] = s;
  }
  // 최고점 무드 선택(동점은 MOOD_PROFILES 정의 순으로 안정 정렬)
  let mood = "happy", best = -1;
  for (const m of Object.keys(MOOD_PROFILES)) {
    if (scores[m] > best) { best = scores[m]; mood = m; }
  }
  const profile = MOOD_PROFILES[mood];
  let energyTarget = profile.target.energy;
  let valenceTarget = profile.target.valence;
  const bump = (base, arr, delta) => {
    if (arr.some((w) => q.includes(w))) return Math.max(0, Math.min(1, base + delta));
    return base;
  };
  energyTarget = bump(energyTarget, LOW_ENERGY, -0.2);
  energyTarget = bump(energyTarget, HIGH_ENERGY, +0.2);
  valenceTarget = bump(valenceTarget, LOW_VAL, -0.2);
  valenceTarget = bump(valenceTarget, HIGH_VAL, +0.2);
  energyTarget = Number(energyTarget.toFixed(3));
  valenceTarget = Number(valenceTarget.toFixed(3));
  return { mood, label: profile.label, energyTarget, valenceTarget, matched: [...new Set(matched)] };
}

/* ─────────── data: 결정론적 구조화 결과(recommender 재사용) ─────────── */
function buildData(task, payload) {
  const tracks = payload.tracks || [];
  const taste = buildTaste(payload.likes || [], payload.dislikes || [], tracks);
  if (task === "dj") {
    const it = interpretMood(payload.text || "");
    const ranked = recommend(tracks, {
      mood: it.mood, taste,
      energyTarget: it.energyTarget, valenceTarget: it.valenceTarget,
      boostNewArtist: true, limit: payload.limit || 15,
    });
    return { interpretation: it, playlist: ranked };
  }
  if (task === "reasons") {
    const list = (payload.tracks && payload.items ? payload.items : payload.tracks) || [];
    const mood = payload.mood || null;
    const items = list.map((t) => {
      const r = scoreTrack(t, { mood, taste });
      return { id: t.id, title: t.title, artist: t.artist, reasons: r.reasons, score: r.score };
    });
    return { items, mood };
  }
  if (task === "copy") {
    const mood = payload.mood || "happy";
    return { mood, label: (MOOD_PROFILES[mood] || {}).label || mood };
  }
  return {};
}

/* ─────────── mock 텍스트(결정론적 한국어 생성) ─────────── */
const COPY_TEMPLATES = {
  happy:   { title: "오늘, 기분 최고치 갱신", sub: "발걸음이 통통 튀는 밝은 하루를 위한 셋리스트.", tags: ["#기분좋아", "#햇살플리", "#텐션업"] },
  comfort: { title: "괜찮아, 오늘은 내가 안아줄게", sub: "지친 마음을 가만히 다독이는 따뜻한 곡들.", tags: ["#위로플리", "#포근한밤", "#수고했어"] },
  focus:   { title: "딴생각 차단, 몰입 모드 ON", sub: "잔잔하게 깔려 집중을 붙잡아 주는 사운드.", tags: ["#집중플리", "#공부할때", "#딥워크"] },
  workout: { title: "심박수야, 같이 뛰자", sub: "한 세트만 더를 부르는 고에너지 비트.", tags: ["#운동플리", "#러닝BGM", "#텐션폭발"] },
  rainy:   { title: "창밖엔 비, 스피커엔 무드", sub: "빗소리에 어울리는 나른하고 센치한 트랙.", tags: ["#비오는날", "#센치플리", "#lofi"] },
  drive:   { title: "밤도로 위, 우리의 사운드트랙", sub: "네온을 가르며 달리는 시티팝 그루브.", tags: ["#드라이브", "#야경플리", "#citypop"] },
};

function mockText(task, payload, data) {
  if (task === "dj") {
    const it = data.interpretation;
    const top = data.playlist.slice(0, 3).map((r) => `「${r.track.title}」`).join(", ");
    const hint = it.matched.length ? `‘${it.matched.slice(0, 3).join(", ")}’ 같은 표현` : "적어주신 문장";
    return `${hint}에서 ‘${it.label}’ 무드를 읽었어요. ` +
      `에너지 ${Math.round(it.energyTarget * 100)}% · 발랄도 ${Math.round(it.valenceTarget * 100)}%로 맞춰 ` +
      `총 ${data.playlist.length}곡을 골랐습니다. 특히 ${top} 부터 들어보세요. 🎧`;
  }
  if (task === "reasons") {
    const lines = data.items.slice(0, 5).map((x, i) =>
      `${i + 1}. ${x.title} — ${x.reasons.slice(0, 3).join(", ")} (매칭 ${Math.round(x.score * 100)}%)`);
    return `이 곡들을 고른 이유예요:\n${lines.join("\n")}`;
  }
  if (task === "copy") {
    const c = COPY_TEMPLATES[data.mood] || COPY_TEMPLATES.happy;
    return `${c.title}\n${c.sub}\n${c.tags.join(" ")}`;
  }
  return "";
}

/* ─────────── 스트리밍 유틸 ─────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mock: 텍스트를 토막으로 나눠 onToken 으로 흘려보낸다(실 스트리밍 느낌).
async function streamMock(text, onToken) {
  if (typeof onToken !== "function") return text;
  // 공백/개행 경계로 토큰화(한국어에서도 자연스럽게 보이도록 3~5자 조각도 허용)
  const chunks = text.match(/\S+\s*|\n/g) || [text];
  for (const ch of chunks) { onToken(ch); await sleep(18); }
  return text;
}

// 자동 폴백을 트리거하는 표식 오류(429 {fallback:true} / 네트워크 / 서버 오류).
class FallbackError extends Error {}

// remote: AI_ENDPOINT 로 POST 후 응답 본문을 스트리밍으로 읽는다.
async function streamRemote(task, payload, onToken) {
  let res;
  try {
    res = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, payload }),
    });
  } catch (e) {
    // 네트워크 오류 → mock 폴백(무인: 앱이 절대 멈추지 않음).
    throw new FallbackError(`네트워크 오류: ${e?.message || e}`);
  }
  // 429 {fallback:true} (요청/월예산 초과) → mock 폴백.
  if (res.status === 429) throw new FallbackError("서버 폴백 신호(429)");
  if (!res.ok) throw new FallbackError(`AI 서버 오류: ${res.status}`);
  // 스트리밍 지원 시 청크 단위로, 아니면 통째로.
  let full = "";
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const t = dec.decode(value, { stream: true });
      if (t) { full += t; if (typeof onToken === "function") onToken(t); }
    }
    const tail = dec.decode();
    if (tail) { full += tail; if (typeof onToken === "function") onToken(tail); }
  } else {
    full = await res.text();
    if (typeof onToken === "function") onToken(full);
  }
  return full;
}

/**
 * AI 진입점.
 * @param {"dj"|"reasons"|"copy"} task
 * @param {object} payload  { text, tracks, likes, dislikes, mood, limit } (태스크별)
 * @param {{onToken?:(t:string)=>void}} [opts]
 * @returns {Promise<{text:string, data:object, provider:"mock"|"remote"}>}
 */
export async function askAI(task, payload = {}, { onToken } = {}) {
  const data = buildData(task, payload); // 항상 결정론적으로 준비(플레이리스트/이유)
  let text;
  if (!AI_ENDPOINT) {
    text = await streamMock(mockText(task, payload, data), onToken);
    return { text, data, provider: "mock" };
  }
  // 실 API 시도 → 실패/429/네트워크 오류 시 mock 으로 자동 폴백(무인: 앱이 절대 멈추지 않음).
  try {
    text = await streamRemote(task, payload, onToken);
    return { text, data, provider: "remote" };
  } catch (err) {
    if (typeof console !== "undefined") console.warn("실 AI 실패 → mock 폴백:", err?.message || err);
    text = await streamMock(mockText(task, payload, data), onToken);
    return { text, data, provider: "mock-fallback" };
  }
}
