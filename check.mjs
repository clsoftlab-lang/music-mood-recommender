// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// check.mjs — CI 검증: JSON 파싱 / node --check 전 JS / index.html 필수 컨테이너 /
// recommender.js 단위 테스트(무드+좋아요 태그 → 기대 순서·포함 검증).
// 실행: node check.mjs   (종료코드 0=통과)

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  recommend, buildTaste, scoreTrack, similarTracks, discoverNewArtists, MOOD_PROFILES,
} from "./recommender.js";
import { AI_ENDPOINT } from "./ai/config.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };
const section = (t) => console.log(`\n▶ ${t}`);

/* ---------- 1. tracks.json 파싱 & 스키마 ---------- */
section("tracks.json 파싱 & 스키마");
const raw = readFileSync(join(ROOT, "data", "tracks.json"), "utf8");
let data;
try { data = JSON.parse(raw); ok(true, "JSON 파싱 성공"); }
catch (e) { ok(false, `JSON 파싱 실패: ${e.message}`); process.exit(1); }

const tracks = data.tracks;
ok(Array.isArray(tracks) && tracks.length >= 40, `트랙 40개 이상 (${tracks.length}개)`);
ok(Array.isArray(data.moods) && data.moods.length >= 6, `무드 6개 이상 (${data.moods?.length})`);
const ids = new Set();
let schemaOk = true, newCount = 0;
for (const t of tracks) {
  if (ids.has(t.id)) schemaOk = false;
  ids.add(t.id);
  const good = t.id && t.title && t.artist && t.genre &&
    typeof t.tempo === "number" &&
    typeof t.energy === "number" && t.energy >= 0 && t.energy <= 1 &&
    typeof t.valence === "number" && t.valence >= 0 && t.valence <= 1 &&
    Array.isArray(t.tags) && t.tags.length > 0 &&
    typeof t.isNewArtist === "boolean";
  if (!good) { schemaOk = false; console.error(`    bad track: ${t.id}`); }
  if (t.isNewArtist) newCount++;
}
ok(schemaOk, "모든 트랙 스키마·고유 id 유효");
ok(ids.size === tracks.length, "트랙 id 중복 없음");
ok(newCount >= 5, `신인 아티스트 트랙 존재 (${newCount}개)`);

/* ---------- 2. index.html 필수 컨테이너 ---------- */
section("index.html 필수 컨테이너");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
for (const id of ["mood-grid", "playlist", "player", "discover", "progress-bar", "now-title"]) {
  ok(html.includes(`id="${id}"`), `#${id} 존재`);
}
ok(html.includes('type="module"'), "ES module 스크립트 로드");

/* ---------- 3. node --check 전 JS ---------- */
section("node --check 문법 검사");
for (const f of ["app.js", "recommender.js", "audio.js", "check.mjs"]) {
  try { execFileSync(process.execPath, ["--check", join(ROOT, f)], { stdio: "pipe" }); ok(true, `${f} 문법 OK`); }
  catch (e) { ok(false, `${f} 문법 오류: ${e.message}`); }
}

/* ---------- 4. recommender 단위 테스트 ---------- */
section("recommender 단위 테스트");

// 4-1) 운동 무드: 상위 곡은 고에너지 + workout 태그
const workout = recommend(tracks, { mood: "workout" });
ok(workout[0].track.energy >= 0.9, `운동 1위는 고에너지 (${workout[0].track.title}, e=${workout[0].track.energy})`);
ok(workout[0].track.tags.includes("workout"), "운동 1위에 workout 태그 포함");
const top5w = workout.slice(0, 5).map((r) => r.track.id);
ok(!top5w.includes("t07") && !top5w.includes("t17"), "운동 상위5에 앰비언트/집중곡 배제");

// 4-2) 집중 무드: 상위 곡은 저에너지 instrumental/lofi/ambient
const focus = recommend(tracks, { mood: "focus" });
const ft = focus[0].track;
ok(ft.energy < 0.5, `집중 1위는 저에너지 (${ft.title}, e=${ft.energy})`);
ok(MOOD_PROFILES.focus.tags.some((tg) => ft.tags.includes(tg)), "집중 1위에 집중 태그 포함");

// 4-3) 행복 무드: 상위3에 고발랄도(valence>=0.85) 포함
const happy = recommend(tracks, { mood: "happy" });
ok(happy.slice(0, 3).some((r) => r.track.valence >= 0.85), "행복 상위3에 고발랄도 곡 포함");

// 4-4) 좋아요 학습: ambient 곡을 좋아하면 해당 곡 점수 상승
const ambient = tracks.find((t) => t.tags.includes("ambient"));
const before = scoreTrack(ambient, { mood: "focus" }).score;
const taste = buildTaste([ambient.id], [], tracks);
const after = scoreTrack(ambient, { mood: "focus", taste }).score;
ok(after > before, `좋아요 후 점수 상승 (${before} → ${after})`);

// 4-5) 싫어요 학습: 점수 하락
const disTaste = buildTaste([], [ambient.id], tracks);
const afterDis = scoreTrack(ambient, { mood: "focus", taste: disTaste }).score;
ok(afterDis < before, `싫어요 후 점수 하락 (${before} → ${afterDis})`);

// 4-6) 좋아요가 랭킹 순서를 실제로 바꾼다
const baseOrder = recommend(tracks, { mood: "focus" }).map((r) => r.track.id);
const lofiLikes = tracks.filter((t) => t.tags.includes("lofi")).slice(0, 3).map((t) => t.id);
const likedOrder = recommend(tracks, { mood: "focus", taste: buildTaste(lofiLikes, [], tracks) }).map((r) => r.track.id);
ok(baseOrder.join() !== likedOrder.join(), "좋아요가 추천 순서를 변경함");

// 4-7) 결정론적: 동일 입력 → 동일 순서
const a = recommend(tracks, { mood: "drive" }).map((r) => r.track.id).join();
const b = recommend(tracks, { mood: "drive" }).map((r) => r.track.id).join();
ok(a === b, "동일 입력에 결정론적 순서");

// 4-8) 유사곡: 시티팝 드라이브 곡의 유사곡 상위3에 같은 계열 포함
const seed = tracks.find((t) => t.tags.includes("citypop") && t.tags.includes("drive"));
const sims = similarTracks(seed, tracks, { limit: 3 });
ok(sims.some((r) => r.track.tags.includes("citypop") || r.track.tags.includes("drive")), "유사곡에 동일 계열 포함");
ok(!sims.some((r) => r.track.id === seed.id), "유사곡에 자기 자신 제외");

// 4-9) 신인 발굴: 전부 isNewArtist
const disc = discoverNewArtists(tracks, {});
ok(disc.length > 0 && disc.every((r) => r.track.isNewArtist), "신인 발굴은 신인만 반환");

// 4-10) 슬라이더 override: valenceTarget 낮추면 상위 곡 평균 발랄도가 내려간다
const avgVal = (list) => list.reduce((s, r) => s + r.track.valence, 0) / list.length;
const lowV = avgVal(recommend(tracks, { mood: "comfort", valenceTarget: 0.25 }).slice(0, 5));
const highV = avgVal(recommend(tracks, { mood: "comfort", valenceTarget: 0.95 }).slice(0, 5));
ok(lowV < highV, `슬라이더 발랄도 반영 (저:${lowV.toFixed(2)} < 고:${highV.toFixed(2)})`);

// 4-11) 점수 범위 & 이유 존재
ok(workout.every((r) => r.score >= 0 && r.score <= 1), "모든 점수 0..1 범위");
ok(workout.every((r) => Array.isArray(r.reasons) && r.reasons.length > 0), "모든 결과에 추천 이유 존재");

/* ---------- 5. AI 레이어 & 보안 ---------- */
section("AI 레이어 문법 & 보안");

// 5-1) ai/ · server/ 의 JS/MJS 전부 node --check
const jsFilesIn = (rel) => {
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(mjs|js)$/.test(f)).map((f) => join(rel, f));
};
const aiFiles = [...jsFilesIn("ai"), ...jsFilesIn("server")];
ok(aiFiles.length >= 3, `ai/·server/ JS 파일 존재 (${aiFiles.length}개)`);
for (const f of aiFiles) {
  try { execFileSync(process.execPath, ["--check", join(ROOT, f)], { stdio: "pipe" }); ok(true, `${f} 문법 OK`); }
  catch (e) { ok(false, `${f} 문법 오류: ${e.message}`); }
}

// 5-2) 데모 기본값: AI_ENDPOINT 는 비어 있어야 한다(브라우저에 서버 주소·키 노출 금지)
ok(AI_ENDPOINT === "", `AI_ENDPOINT 빈 값(데모/mock 기본) (실제값="${AI_ENDPOINT}")`);

// 5-3) 실제 API 키 형식이 소스에 커밋되지 않았는지 스캔
//      (정규식을 조각으로 조립해 이 검사 파일 자신이 오탐되지 않게 한다)
const KEY_RE = new RegExp("sk-" + "ant-[A-Za-z0-9_-]{20,}");
const scanTargets = [
  "app.js", "recommender.js", "audio.js", "check.mjs",
  ...aiFiles,
];
let leaked = null;
for (const f of scanTargets) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  if (KEY_RE.test(readFileSync(p, "utf8"))) { leaked = f; break; }
}
ok(leaked === null, leaked ? `실제 API 키 형식 발견: ${leaked}` : "소스에 실제 API 키 형식 없음");

// 5-4) 서버는 키를 환경변수에서만 읽는다
if (existsSync(join(ROOT, "server", "index.mjs"))) {
  const srv = readFileSync(join(ROOT, "server", "index.mjs"), "utf8");
  ok(srv.includes("process.env.ANTHROPIC_API_KEY"), "서버가 ANTHROPIC_API_KEY 환경변수 사용");
  ok(srv.includes("claude-opus-5"), "서버 모델 claude-opus-5 지정");
}

/* ---------- 결과 ---------- */
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
console.log("✅ 모든 검증 통과");
