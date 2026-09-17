// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/worker.js — Cloudflare Workers 변형(무인·무료 호스팅).
//
//   POST /api/ai  { task, payload }  →  Anthropic REST 를 호출해 응답 텍스트를 스트리밍.
//
// 무료 티어에 배포하면 관리할 서버가 없습니다(무인). index.mjs 와 동일한
//   · 태스크 라우팅  · 비용 우선 기본 모델  · prompt caching  · thinking/effort 규칙
// 을 따릅니다.
//
// ⚠️ 키는 Worker secret 으로만: `wrangler secret put ANTHROPIC_API_KEY`.
//    브라우저·저장소에는 키를 절대 두지 않습니다.

const SYSTEMS = {
  dj: "너는 '기책' 음악 서비스의 AI DJ다. 사용자의 자유로운 무드 문장과, 규칙 기반 추천 엔진이 이미 고른 곡 목록(JSON)이 주어진다. " +
      "그 선곡을 근거로, 왜 이 무드로 해석했고 어떤 곡부터 들으면 좋은지 따뜻하고 간결한 한국어 2~4문장으로 설명하라. 새로운 곡을 지어내지 마라.",
  reasons: "너는 '기책'의 음악 큐레이터다. 곡별 특징과 규칙 기반 매칭 이유(JSON)가 주어진다. " +
           "각 곡이 이 무드에 왜 어울리는지 한 곡당 한 줄, 사람 말투의 한국어로 서술하라. 사실을 지어내지 마라.",
  copy: "너는 '기책'의 카피라이터다. 주어진 무드에 어울리는 플레이리스트 제목 1줄, 감성적인 소개 1~2줄, 해시태그 3개를 한국어로 만들어라.",
};

function cors(headers = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

    const url = new URL(request.url);
    if (request.method !== "POST" || !url.pathname.startsWith("/api/ai")) {
      return new Response("Not found. Use POST /api/ai", { status: 404, headers: cors() });
    }
    const API_KEY = env.ANTHROPIC_API_KEY; // Worker secret 에서만
    if (!API_KEY) {
      return new Response("Worker 에 ANTHROPIC_API_KEY secret 이 설정되지 않았습니다.", { status: 501, headers: cors() });
    }

    // 비용 우선 기본 모델. env.AI_MODEL 로 claude-sonnet-5 / claude-opus-5 상향 가능.
    const MODEL = env.AI_MODEL || "claude-haiku-4-5";
    const MAX_TOKENS = Number(env.AI_MAX_TOKENS || 700);
    const isHaiku = MODEL.startsWith("claude-haiku");

    let task, payload;
    try {
      ({ task, payload } = await request.json());
    } catch {
      return new Response("잘못된 JSON 본문", { status: 400, headers: cors() });
    }
    if (!SYSTEMS[task]) {
      return new Response(`알 수 없는 task: ${task}`, { status: 400, headers: cors() });
    }

    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      // 안정적인 system 프롬프트를 prompt caching 으로 → 반복 호출 비용↓.
      system: [{ type: "text", text: SYSTEMS[task], cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `무드/입력 컨텍스트(JSON):\n${JSON.stringify(payload ?? {}, null, 2)}` }],
    };
    if (!isHaiku) {
      // Haiku 4.5 는 adaptive thinking/effort 미지원(400 방지) → 다른 모델에서만.
      body.thinking = { type: "adaptive" };
      body.output_config = { effort: env.AI_EFFORT || "low" };
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return new Response(`\n[오류] Anthropic ${upstream.status} ${detail}`, { status: 502, headers: cors() });
    }

    // SSE(text_delta) 를 순수 텍스트 스트림으로 릴레이 → 프런트가 그대로 이어 붙임.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) { controller.close(); return; }
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const json = s.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const evt = JSON.parse(json);
            if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
              controller.enqueue(encoder.encode(evt.delta.text));
            }
          } catch { /* 부분 프레임 무시 */ }
        }
      },
      cancel() { reader.cancel(); },
    });

    return new Response(stream, {
      headers: cors({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" }),
    });
  },
};
