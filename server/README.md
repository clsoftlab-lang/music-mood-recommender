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

### 비용 우선(저비용) 설계

- **기본 모델**: `claude-haiku-4-5` (비용 우선). `AI_MODEL=claude-sonnet-5` 또는
  `AI_MODEL=claude-opus-5` 로 품질↑(비용↑) 상향 가능.
- **prompt caching**: 안정적인 태스크별 system 프롬프트를 `cache_control:{type:'ephemeral'}`
  블록으로 전송 → 반복 호출 시 캐시를 읽어 비용이 줄어듭니다.
- **thinking/effort**: Haiku 4.5 는 adaptive thinking/effort 를 받지 않아 **미전송**(400 방지).
  그 외 모델은 `thinking:{type:'adaptive'}` + `output_config:{effort: AI_EFFORT|'low'}`.
- **출력 상한**: `max_tokens` 기본 `700`(`AI_MAX_TOKENS`).
- **비용 가드레일**: IP당 분당 요청 제한(`AI_RATE_PER_MIN`, 기본 20) + 월간 토큰 예산
  (`AI_MONTHLY_TOKEN_CAP`, 기본 2,000,000). 초과 시 **HTTP 429 `{fallback:true}`** →
  프런트(`ai/ai.js`)가 자동으로 mock 으로 폴백해 **앱이 멈추지 않습니다(무인)**.

## ☁️ Cloudflare Workers 배포 (무료·무인)

관리할 서버가 없는 무료 티어 배포 변형(`server/worker.js` + `server/wrangler.toml`).
`index.mjs` 와 동일한 태스크 라우팅·모델·caching 규칙을 따르며 Anthropic REST 를 호출합니다.

```bash
cd server
npm i -g wrangler                       # 또는 npx wrangler
wrangler secret put ANTHROPIC_API_KEY   # 키는 secret 으로만 (저장소에 두지 않음)
wrangler deploy                         # worker.js 배포
```

배포 후 나온 `https://<worker>.workers.dev` 주소 뒤에 `/api/ai` 를 붙여
프런트 `ai/config.js` 의 `AI_ENDPOINT` 에 넣으면 실 Claude 로 전환됩니다.
(선택 튜닝은 `wrangler.toml` 의 `[vars]` 참고.)

## 보안 규칙 (필독)

- **키는 서버에만.** `ANTHROPIC_API_KEY` 는 이 프로세스의 환경변수로만 읽습니다(`process.env`).
- **키를 커밋하지 마세요.** `.env` 는 `.gitignore` 로 제외되어 있습니다. 저장소·프런트 번들에 키 문자열이 들어가면 안 됩니다.
- 리포지토리 검증(`node check.mjs`)이 실제 키 형식을 스캔하고, `ai/config.js` 의 `AI_ENDPOINT` 가 비어 있는지 확인합니다.

## 라이선스

Apache-2.0.
