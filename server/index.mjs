// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/index.mjs — 기책 AI 백엔드 프록시 (무인·저비용 실 AI).
//
//   POST /api/ai  { task, payload }  →  Claude 응답을 텍스트로 스트리밍.
//
// ⚠️ 보안: API 키는 오직 이 백엔드의 환경변수(ANTHROPIC_API_KEY)로만 읽습니다.
//    브라우저·저장소·리포지토리에는 키를 절대 두지 않습니다.
//    프런트(ai/ai.js)는 이 서버 주소(AI_ENDPOINT)만 알면 됩니다.
//
// 저비용 설계:
//   · 기본 모델은 비용 우선(claude-haiku-4-5). AI_MODEL 로 상향 가능
//     (claude-sonnet-5 / claude-opus-5 로 품질↑, 비용↑).
//   · 안정적인 태스크별 system 프롬프트를 prompt caching(cache_control)으로 보내
//     반복 호출 시 캐시를 읽어 토큰 비용을 낮춥니다.
//   · Haiku 4.5 는 adaptive thinking/effort 를 받지 않으므로 미전송(400 방지).
//   · max_tokens 를 태스크에 맞게 소폭(기본 700)으로 제한.
//   · 비용 가드레일: IP당 분당 요청 제한 + 월간 토큰 예산 초과 시 429 {fallback:true}.

import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORT = Number(process.env.PORT || 8788);
const API_KEY = process.env.ANTHROPIC_API_KEY; // ← 키는 환경변수에서만
// 비용 우선 기본값. 품질이 더 필요하면 AI_MODEL=claude-sonnet-5 또는 claude-opus-5.
const MODEL = process.env.AI_MODEL || "claude-haiku-4-5";
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 700);
// 월간 토큰 예산(초과 시 429 {fallback:true} → 프런트는 자동으로 mock 으로 폴백).
const MONTHLY_TOKEN_CAP = Number(process.env.AI_MONTHLY_TOKEN_CAP || 2000000);
const RATE_PER_MIN = Number(process.env.AI_RATE_PER_MIN || 20);

if (!API_KEY) {
  console.warn("⚠️  ANTHROPIC_API_KEY 미설정 — /api/ai 호출 시 501을 반환합니다. .env 를 설정하세요.");
}
const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

// 태스크별 시스템 프롬프트(한국어 생성 지침). 안정적이므로 prompt cache 대상.
const SYSTEMS = {
  dj: "너는 '기책' 음악 서비스의 AI DJ다. 사용자의 자유로운 무드 문장과, 규칙 기반 추천 엔진이 이미 고른 곡 목록(JSON)이 주어진다. " +
      "그 선곡을 근거로, 왜 이 무드로 해석했고 어떤 곡부터 들으면 좋은지 따뜻하고 간결한 한국어 2~4문장으로 설명하라. 새로운 곡을 지어내지 마라.",
  reasons: "너는 '기책'의 음악 큐레이터다. 곡별 특징과 규칙 기반 매칭 이유(JSON)가 주어진다. " +
           "각 곡이 이 무드에 왜 어울리는지 한 곡당 한 줄, 사람 말투의 한국어로 서술하라. 사실을 지어내지 마라.",
  copy: "너는 '기책'의 카피라이터다. 주어진 무드에 어울리는 플레이리스트 제목 1줄, 감성적인 소개 1~2줄, 해시태그 3개를 한국어로 만들어라.",
};

const isHaiku = MODEL.startsWith("claude-haiku");

function buildMessages(task, payload) {
  const content = `무드/입력 컨텍스트(JSON):\n${JSON.stringify(payload ?? {}, null, 2)}`;
  return [{ role: "user", content }];
}

// 안정적인 system 프롬프트를 cache_control 로 감싸 반복 호출 비용을 낮춘다.
function buildParams(task, payload) {
  const params = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: SYSTEMS[task], cache_control: { type: "ephemeral" } }],
    messages: buildMessages(task, payload),
  };
  if (!isHaiku) {
    // Haiku 4.5 는 adaptive thinking/effort 미지원 → 다른 모델에서만 전송.
    params.thinking = { type: "adaptive" };
    params.output_config = { effort: process.env.AI_EFFORT || "low" };
  }
  return params;
}

/* ─────────── 비용 가드레일 ─────────── */
// IP당 분당 요청 제한(간단한 인메모리).
const rate = new Map(); // ip → { count, resetAt }
function rateLimited(ip) {
  const now = Date.now();
  const rec = rate.get(ip);
  if (!rec || now >= rec.resetAt) { rate.set(ip, { count: 1, resetAt: now + 60000 }); return false; }
  rec.count += 1;
  return rec.count > RATE_PER_MIN;
}
// 월간 토큰 누적(달이 바뀌면 리셋).
let tokenUsage = 0;
let usageMonth = new Date().getUTCMonth();
function budgetExceeded() {
  const m = new Date().getUTCMonth();
  if (m !== usageMonth) { usageMonth = m; tokenUsage = 0; }
  return tokenUsage >= MONTHLY_TOKEN_CAP;
}
function addUsage(usage) {
  if (!usage) return;
  tokenUsage +=
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function fallback429(res, reason) {
  res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ fallback: true, reason }));
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method !== "POST" || !req.url.startsWith("/api/ai")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found. Use POST /api/ai");
  }
  if (!client) {
    res.writeHead(501, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("서버에 ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  }
  // 비용 가드레일: 초과 시 429 {fallback:true} → 프런트가 mock 으로 자동 폴백(무인).
  const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) return fallback429(res, "rate_limit");
  if (budgetExceeded()) return fallback429(res, "monthly_token_cap");

  try {
    const { task, payload } = JSON.parse((await readBody(req)) || "{}");
    if (!SYSTEMS[task]) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(`알 수 없는 task: ${task}`);
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    const stream = client.messages.stream(buildParams(task, payload));
    stream.on("text", (t) => res.write(t)); // 델타를 그대로 흘려보냄
    const final = await stream.finalMessage();
    addUsage(final?.usage); // 스트림 최종 메시지의 usage 누적
    res.end();
  } catch (err) {
    console.error("AI 처리 오류:", err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`\n[오류] ${err?.message || "AI 요청 실패"}`);
  }
});

server.listen(PORT, () => {
  console.log(`🤖 기책 AI 프록시: http://localhost:${PORT}/api/ai  (POST {task,payload})`);
  console.log(`   모델=${MODEL} · max_tokens=${MAX_TOKENS} · 월예산=${MONTHLY_TOKEN_CAP} 토큰 · ${RATE_PER_MIN}/분`);
  console.log(`   프런트 ai/config.js 의 AI_ENDPOINT 를 위 주소로 설정하면 실 Claude 로 전환됩니다.`);
});
