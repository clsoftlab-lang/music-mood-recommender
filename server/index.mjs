// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/index.mjs — 기책 AI 백엔드 프록시.
//
//   POST /api/ai  { task, payload }  →  Claude 응답을 텍스트로 스트리밍.
//
// ⚠️ 보안: API 키는 오직 이 백엔드의 환경변수(ANTHROPIC_API_KEY)로만 읽습니다.
//    브라우저·저장소·리포지토리에는 키를 절대 두지 않습니다.
//    프런트(ai/ai.js)는 이 서버 주소(AI_ENDPOINT)만 알면 됩니다.

import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORT = Number(process.env.PORT || 8788);
const API_KEY = process.env.ANTHROPIC_API_KEY; // ← 키는 환경변수에서만
if (!API_KEY) {
  console.warn("⚠️  ANTHROPIC_API_KEY 미설정 — /api/ai 호출 시 501을 반환합니다. .env 를 설정하세요.");
}
const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

// 태스크별 시스템 프롬프트(한국어 생성 지침).
const SYSTEMS = {
  dj: "너는 '기책' 음악 서비스의 AI DJ다. 사용자의 자유로운 무드 문장과, 규칙 기반 추천 엔진이 이미 고른 곡 목록(JSON)이 주어진다. " +
      "그 선곡을 근거로, 왜 이 무드로 해석했고 어떤 곡부터 들으면 좋은지 따뜻하고 간결한 한국어 2~4문장으로 설명하라. 새로운 곡을 지어내지 마라.",
  reasons: "너는 '기책'의 음악 큐레이터다. 곡별 특징과 규칙 기반 매칭 이유(JSON)가 주어진다. " +
           "각 곡이 이 무드에 왜 어울리는지 한 곡당 한 줄, 사람 말투의 한국어로 서술하라. 사실을 지어내지 마라.",
  copy: "너는 '기책'의 카피라이터다. 주어진 무드에 어울리는 플레이리스트 제목 1줄, 감성적인 소개 1~2줄, 해시태그 3개를 한국어로 만들어라.",
};

function buildMessages(task, payload) {
  const content = `무드/입력 컨텍스트(JSON):\n${JSON.stringify(payload ?? {}, null, 2)}`;
  return [{ role: "user", content }];
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
  try {
    const { task, payload } = JSON.parse((await readBody(req)) || "{}");
    const system = SYSTEMS[task];
    if (!system) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(`알 수 없는 task: ${task}`);
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    const stream = client.messages.stream({
      model: "claude-opus-5",
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      system,
      messages: buildMessages(task, payload),
    });
    stream.on("text", (t) => res.write(t)); // 델타를 그대로 흘려보냄
    await stream.finalMessage();
    res.end();
  } catch (err) {
    console.error("AI 처리 오류:", err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`\n[오류] ${err?.message || "AI 요청 실패"}`);
  }
});

server.listen(PORT, () => {
  console.log(`🤖 기책 AI 프록시: http://localhost:${PORT}/api/ai  (POST {task,payload})`);
  console.log(`   프런트 ai/config.js 의 AI_ENDPOINT 를 위 주소로 설정하면 실 Claude 로 전환됩니다.`);
});
