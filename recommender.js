// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// recommender.js — 설명가능한 규칙 기반 추천 엔진 (rule-based, explainable).
// 순수 ES 모듈: 브라우저와 Node(테스트) 양쪽에서 사이드이펙트 없이 동작합니다.
// ML이 아닌, 곡의 장르·템포·에너지·발랄도(valence)·태그를 무드 프로필과
// 매칭·랭킹하는 결정론적(deterministic) 엔진입니다.

/**
 * 무드별 목표 프로필.
 * target: {energy, valence} 0..1 이상적 지점
 * tempo: [min,max] BPM 선호 구간
 * tags: 무드가 선호하는 태그 (겹칠수록 가점)
 * weights 는 recommend() 에서 공통 사용.
 */
export const MOOD_PROFILES = {
  happy:   { label: "행복",     target: { energy: 0.72, valence: 0.90 }, tempo: [95, 135],  tags: ["happy", "bright", "upbeat", "dance", "party"] },
  comfort: { label: "위로",     target: { energy: 0.32, valence: 0.52 }, tempo: [60, 95],   tags: ["comfort", "warm", "gentle", "ballad", "acoustic"] },
  focus:   { label: "집중",     target: { energy: 0.26, valence: 0.50 }, tempo: [55, 95],   tags: ["focus", "instrumental", "lofi", "ambient", "calm", "study"] },
  workout: { label: "운동",     target: { energy: 0.94, valence: 0.70 }, tempo: [120, 160], tags: ["workout", "intense", "edm", "dance", "beat", "drop"] },
  rainy:   { label: "비오는날", target: { energy: 0.32, valence: 0.42 }, tempo: [60, 95],   tags: ["rainy", "jazz", "lofi", "mellow", "smooth"] },
  drive:   { label: "드라이브", target: { energy: 0.66, valence: 0.70 }, tempo: [100, 130], tags: ["drive", "citypop", "groovy", "night", "synthwave"] },
};

// 점수 가중치 (합 = 1.0). 각 항목은 0..1 로 정규화된 뒤 가중 합산됩니다.
export const WEIGHTS = {
  feature: 0.40, // 에너지·발랄도가 무드 목표에 얼마나 가까운가
  tag:     0.25, // 무드 선호 태그와의 겹침
  taste:   0.20, // 내 좋아요/싫어요 학습 반영
  tempo:   0.10, // 템포 구간 적합도
  newArtist: 0.05, // 신인 아티스트 노출 보장 가점
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const tanh = (x) => {
  const e2 = Math.exp(2 * x);
  return (e2 - 1) / (e2 + 1);
};

/**
 * 좋아요/싫어요 기록으로부터 취향 프로필을 만든다.
 * @param {string[]} likes  좋아요한 track id 목록
 * @param {string[]} dislikes 싫어요한 track id 목록
 * @param {Array} tracks 전체 트랙
 * @returns {{tagWeight:Object, genreWeight:Object, likeCount:number, dislikeCount:number}}
 */
export function buildTaste(likes = [], dislikes = [], tracks = []) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const tagWeight = Object.create(null);
  const genreWeight = Object.create(null);
  const apply = (ids, sign) => {
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) continue;
      for (const tag of t.tags || []) tagWeight[tag] = (tagWeight[tag] || 0) + sign;
      if (t.genre) genreWeight[t.genre] = (genreWeight[t.genre] || 0) + sign;
    }
  };
  apply(likes, 1);
  apply(dislikes, -1);
  return { tagWeight, genreWeight, likeCount: likes.length, dislikeCount: dislikes.length };
}

/**
 * 단일 트랙을 채점한다. 각 구성요소와 사람이 읽을 수 있는 이유를 함께 반환.
 * @returns {{score:number, parts:Object, reasons:string[]}}
 */
export function scoreTrack(track, opts = {}) {
  const {
    mood = null,
    taste = null,
    energyTarget = null,  // 슬라이더 override (0..1) — 있으면 무드 목표 대신 사용
    valenceTarget = null,
    boostNewArtist = true,
  } = opts;

  const profile = mood ? MOOD_PROFILES[mood] : null;
  const tEnergy = energyTarget != null ? energyTarget : profile ? profile.target.energy : 0.5;
  const tValence = valenceTarget != null ? valenceTarget : profile ? profile.target.valence : 0.5;

  // 1) feature: 에너지·발랄도 근접도
  const dist = (Math.abs(track.energy - tEnergy) + Math.abs(track.valence - tValence)) / 2;
  const feature = clamp01(1 - dist);

  // 2) tag: 무드 선호 태그와 겹침 (3개 이상이면 만점)
  let overlap = 0;
  const matchedTags = [];
  if (profile) {
    const set = new Set(track.tags || []);
    for (const tag of profile.tags) if (set.has(tag)) { overlap++; matchedTags.push(tag); }
  }
  const tag = profile ? clamp01(overlap / 3) : 0.5;

  // 3) taste: 좋아요/싫어요 학습 반영 (없으면 중립 0.5)
  let tasteRaw = 0;
  if (taste) {
    for (const tg of track.tags || []) tasteRaw += taste.tagWeight[tg] || 0;
    tasteRaw += (taste.genreWeight[track.genre] || 0) * 1.5; // 장르는 조금 더 무겁게
  }
  const tasteScore = clamp01(0.5 + 0.5 * tanh(tasteRaw / 4));

  // 4) tempo: 선호 구간 적합도
  let tempo = 0.5;
  if (profile) {
    const [lo, hi] = profile.tempo;
    if (track.tempo >= lo && track.tempo <= hi) tempo = 1;
    else {
      const d = track.tempo < lo ? lo - track.tempo : track.tempo - hi;
      tempo = clamp01(1 - d / 40);
    }
  }

  // 5) newArtist: 신인 노출 보장 가점
  const newArtist = boostNewArtist && track.isNewArtist ? 1 : 0;

  const parts = { feature, tag, taste: tasteScore, tempo, newArtist };
  const score =
    WEIGHTS.feature * feature +
    WEIGHTS.tag * tag +
    WEIGHTS.taste * tasteScore +
    WEIGHTS.tempo * tempo +
    WEIGHTS.newArtist * newArtist;

  // 사람이 읽는 이유 (기여도 순)
  const reasons = [];
  if (feature >= 0.8) reasons.push("에너지·기분이 딱 맞아요");
  else if (feature >= 0.6) reasons.push("무드 분위기와 잘 어울려요");
  if (matchedTags.length) reasons.push(`태그 일치: ${matchedTags.slice(0, 3).join(", ")}`);
  if (taste && tasteScore >= 0.62) reasons.push("당신이 좋아한 스타일");
  if (taste && tasteScore <= 0.38) reasons.push("취향과 다소 거리가 있어요");
  if (tempo >= 0.99 && profile) reasons.push(`템포 ${track.tempo}BPM 적정`);
  if (newArtist) reasons.push("🌱 신인 아티스트");
  if (!reasons.length) reasons.push("탐색 추천");

  return { score: Number(score.toFixed(6)), parts, reasons };
}

/**
 * 무드/옵션에 맞춰 전체 트랙을 랭킹한다.
 * 동점은 id 사전순으로 정렬(결정론적).
 * @returns {Array<{track:Object, score:number, parts:Object, reasons:string[]}>}
 */
export function recommend(tracks, opts = {}) {
  const { limit = Infinity, genre = null, minValence = null, maxValence = null } = opts;
  let pool = tracks;
  if (genre) pool = pool.filter((t) => t.genre === genre);
  if (minValence != null) pool = pool.filter((t) => t.valence >= minValence);
  if (maxValence != null) pool = pool.filter((t) => t.valence <= maxValence);

  const ranked = pool.map((track) => ({ track, ...scoreTrack(track, opts) }));
  ranked.sort((a, b) => (b.score - a.score) || (a.track.id < b.track.id ? -1 : 1));
  return Number.isFinite(limit) ? ranked.slice(0, limit) : ranked;
}

/**
 * 시드 곡과 유사한 곡을 찾는다 (feature + 태그 + 장르 유사도).
 */
export function similarTracks(seed, tracks, opts = {}) {
  const { limit = 8 } = opts;
  const seedTags = new Set(seed.tags || []);
  const scored = tracks
    .filter((t) => t.id !== seed.id)
    .map((t) => {
      const fd = (Math.abs(t.energy - seed.energy) + Math.abs(t.valence - seed.valence)) / 2;
      const feature = clamp01(1 - fd);
      let ov = 0;
      for (const tg of t.tags || []) if (seedTags.has(tg)) ov++;
      const tagSim = clamp01(ov / Math.max(2, Math.min(4, seedTags.size)));
      const genreSim = t.genre === seed.genre ? 1 : 0;
      const sim = 0.5 * feature + 0.35 * tagSim + 0.15 * genreSim;
      return { track: t, score: Number(sim.toFixed(6)) };
    });
  scored.sort((a, b) => (b.score - a.score) || (a.track.id < b.track.id ? -1 : 1));
  return scored.slice(0, limit);
}

/**
 * 취향 기반 데일리 믹스: 무드 없이 취향만으로 상위 곡 + 신인 몇 곡을 섞는다.
 */
export function dailyMix(tracks, taste, opts = {}) {
  const { limit = 12, ensureNew = 3 } = opts;
  const ranked = tracks
    .map((track) => ({ track, ...scoreTrack(track, { taste, boostNewArtist: true }) }))
    .sort((a, b) => (b.score - a.score) || (a.track.id < b.track.id ? -1 : 1));
  const picked = ranked.slice(0, limit);
  // 신인 아티스트 최소 노출 보장
  const newInPick = picked.filter((r) => r.track.isNewArtist).length;
  if (newInPick < ensureNew) {
    const extraNew = ranked
      .slice(limit)
      .filter((r) => r.track.isNewArtist)
      .slice(0, ensureNew - newInPick);
    for (const r of extraNew) picked[picked.length - 1] = r; // 꼬리 교체
  }
  return picked;
}

/** 신인 아티스트 발굴 섹션 (노출 보장). */
export function discoverNewArtists(tracks, opts = {}) {
  const { limit = 8, taste = null } = opts;
  return tracks
    .filter((t) => t.isNewArtist)
    .map((track) => ({ track, ...scoreTrack(track, { taste, boostNewArtist: false }) }))
    .sort((a, b) => (b.score - a.score) || (a.track.id < b.track.id ? -1 : 1))
    .slice(0, limit);
}
