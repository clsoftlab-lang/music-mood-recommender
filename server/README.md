<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
-->

# 기책 AI 백엔드 프록시 (server/)

프런트엔드(`ai/ai.js`)를 대신해 **서버에서만** Claude 를 호출하는 얇은 프록시입니다.
브라우저는 이 서버의 주소(`AI_ENDPOINT`)만 알면 되고, **API 키는 절대 브라우저로 내려가지 않습니다.**

```
브라우저 ai/ai.js ──POST {task,payload}──▶ server/index.mjs ──▶ Anthropic API
                                              (ANTHROPIC_API_KEY 는 여기서만)
```

## 실행

```bash
cd server
npm install                 # @anthropic-ai/sdk 설치
cp .env.example .env        # 그리고 .env 안의 ANTHROPIC_API_KEY 를 실제 키로 교체
npm start                   # http://localhost:8788/api/ai 에서 리슨
```

그런 다음 프로젝트 루트의 `ai/config.js` 에서 엔드포인트를 지정하세요:

```js
export const AI_ENDPOINT = "http://localhost:8788/api/ai";
```

이제 프런트의 AI 기능(AI DJ · 추천 이유 · 무드 카피)이 **실제 Claude** 로 전환됩니다.
`AI_ENDPOINT` 를 다시 `""` 로 두면 서버 없이 데모(mock) 모드로 돌아갑니다.

## API

`POST /api/ai`

```jsonc
{ "task": "dj" | "reasons" | "copy", "payload": { /* 태스크별 컨텍스트 */ } }
```

응답은 `text/plain` 스트림(토큰 델타)입니다. 프런트가 조각을 이어 붙여 실시간 표시합니다.

- 모델: `claude-opus-5`
- `thinking: { type: "adaptive" }`, `max_tokens: 2048`
- `client.messages.stream(...)` 로 스트리밍

## 보안 규칙 (필독)

- **키는 서버에만.** `ANTHROPIC_API_KEY` 는 이 프로세스의 환경변수로만 읽습니다(`process.env`).
- **키를 커밋하지 마세요.** `.env` 는 `.gitignore` 로 제외되어 있습니다. 저장소·프런트 번들에 키 문자열이 들어가면 안 됩니다.
- 리포지토리 검증(`node check.mjs`)이 실제 키 형식을 스캔하고, `ai/config.js` 의 `AI_ENDPOINT` 가 비어 있는지 확인합니다.

## 라이선스

Apache-2.0.
