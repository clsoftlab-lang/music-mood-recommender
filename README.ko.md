# 기책 · 기분은 내가 책임질게 🎧

**무드 기반 음악 추천 & 플레이어 — 설명가능한 규칙 기반 추천 엔진과 실시간 생성 오디오.**

> English: [README.md](./README.md)

**🔴 라이브 데모: https://clsoftlab-lang.github.io/music-mood-recommender/**

기분 선택 → 추천 랭킹 → 재생(진짜 소리가 납니다) → 좋아요/싫어요로 취향 학습 → 노출이 보장되는 신인 아티스트 발굴.

---

## 무엇인가요

*기분은 내가 책임질게(기책)* 은 **기분/상황** — 행복·위로·집중·운동·비오는날·드라이브 — 에 맞춰 음악을 추천하고, **신인·인디 아티스트**를 함께 소개합니다. 빌드 과정도 백엔드도 없이 브라우저에서 완전히 동작하는 단일 페이지 앱입니다.

## 추천 엔진 원리

`recommender.js` 는 **규칙 기반이며 완전히 설명가능**합니다 — 곡마다 *왜 추천됐는지* 를 보여줍니다. 각 트랙은 `genre`(장르), `tempo`(BPM), `energy`(에너지 0–1), `valence`(발랄도 0–1), 태그를 가집니다. 무드마다 목표 프로필(이상적 에너지/발랄도, 선호 템포 구간, 선호 태그)이 정의되고, 점수는 5개 정규화 항목의 가중 합산입니다.

| 항목 | 가중치 | 의미 |
|------|:------:|------|
| `feature` | 0.40 | 에너지·발랄도가 무드 목표에 얼마나 가까운가 |
| `tag`     | 0.25 | 무드 선호 태그와 곡 태그의 겹침 |
| `taste`   | 0.20 | 좋아요/싫어요 학습(태그·장르 가중, `tanh` 스쿼시) |
| `tempo`   | 0.10 | 무드 BPM 구간 적합도(구간 밖은 선형 감소) |
| `newArtist` | 0.05 | 신인 아티스트 노출 보장 가점 |

랭킹은 **결정론적**(동점은 id 순)입니다. 좋아요는 해당 곡의 태그·장르에 가중치를 더하고, 싫어요는 뺍니다. 같은 엔진이 **유사곡 추천**, 취향 기반 **데일리 믹스**, **신인 발굴** 섹션도 구동합니다.

## 주요 기능

- 🎭 무드 6종 + 실시간 **에너지 / 발랄도 슬라이더** 로 결과 재조정
- 🧠 설명가능한 랭킹 — 매칭 %와 사람이 읽는 추천 이유 표시
- ▶️ 실제 동작 플레이어: 재생/일시정지/다음/이전, 진행바, 볼륨, 이동
- ❤️ 좋아요/싫어요 학습 → 즉시 재랭킹
- 🌱 신인 아티스트 발굴 섹션(노출 보장)
- 🔁 곡별 "비슷한 곡" · ✨ 취향 기반 데일리 믹스
- 🔎 검색 + 장르 필터 · 🌓 라이트/다크/자동 테마
- 💾 취향·좋아요 `localStorage` 영속화(초기화 가능)
- 🎨 앨범아트 = 인라인 SVG 그라디언트 · 모바일 우선 반응형

## 🤖 AI 기능 (API 연동)

앱에는 **보안·플러그형 AI 레이어**(`ai/`)가 있습니다. 세 기능 모두 동작합니다:

1. **AI DJ** — 자유 문장("비 오는 밤 드라이브")을 입력하면 플레이리스트가 나옵니다. 자연어 무드를 무드+에너지/발랄도 목표로 해석하고, **규칙 기반 `recommender.js` 가 실제 선곡**을, AI가 그 선곡의 이유를 서술합니다.
2. **곡 추천 이유 서술** — 각 곡이 무드에 왜 어울리는지 사람 말투 한 줄로.
3. **무드/플레이리스트 카피 생성** — 현재 무드에 맞는 제목·소개·해시태그.

**데모 = mock(기본).** `ai/config.js` 의 `AI_ENDPOINT = ""` 이면 모든 기능이 **브라우저 안에서** 결정론적 한국어 `MockProvider`(recommender.js 재사용)로 동작합니다 — 서버·키 없이 완전 오프라인.

**실제 Claude 로 전환.** 백엔드 프록시를 띄우고 프런트가 그 주소를 바라보게 합니다:

```bash
cd server
npm install                 # @anthropic-ai/sdk
cp .env.example .env        # .env 안의 ANTHROPIC_API_KEY 설정
npm start                   # http://localhost:8788/api/ai
```

그리고 `ai/config.js`:

```js
export const AI_ENDPOINT = "http://localhost:8788/api/ai";
```

프록시가 Claude(기본 모델 **`claude-haiku-4-5`**, 비용 우선)를 호출해 텍스트를 스트리밍합니다. [`server/README.md`](./server/README.md) 참고.

> **🔒 API 키는 서버에만.** 키는 백엔드 프로세스의 `ANTHROPIC_API_KEY` 환경변수로만 읽습니다 — **브라우저·저장소에는 절대 두지 않습니다.** 프런트는 프록시 URL 만 압니다. `node check.mjs` 가 소스에서 실제 키 형식을 스캔하고 `AI_ENDPOINT` 가 비어 있는지 확인합니다.

## ⚙️ 고도화 — 무인·저비용 실 AI 연동

AI 프록시를 **무인(autonomous)·저비용(cost-efficient)·실 Claude** 로 고도화했습니다.

- **비용 모델.** 기본 모델 **`claude-haiku-4-5`**(≈ **입력 $1 / MTok, 출력 $5 / MTok**),
  품질이 더 필요하면 `AI_MODEL=claude-sonnet-5` 또는 `claude-opus-5`. 안정적인 태스크별
  system 프롬프트에 **prompt caching**(`cache_control:{type:'ephemeral'}`)을 적용해 반복 호출
  비용을 낮추고, 태스크당 `max_tokens`(~700) 상한을 둡니다. **월간 토큰 예산**
  (`AI_MONTHLY_TOKEN_CAP`, 기본 200만) + IP당 분당 제한(20/분)으로 지출을 방어합니다.
- **대략 비용.** 한 요청은 짧은 system(첫 호출 이후 캐시됨) + 작은 JSON + 출력 ≤700 토큰 —
  Haiku 4.5 기준 **요청당 약 $0.003–0.005**, 즉 **1,000요청당 ≈ $3–5**(캐시가 데워질수록 더 저렴).
- **무료 원클릭 배포(무인).** **Cloudflare Workers** 변형(`server/worker.js` + `server/wrangler.toml`)은
  관리할 서버 없이 무료 티어에서 돌아갑니다 — `wrangler secret put ANTHROPIC_API_KEY` 후 `wrangler deploy`.
- **자동 실행 + 절대 안 멈춤.** 접속 시 **"지금 시간대 무드 자동 플레이리스트"**(로컬 시각→무드,
  규칙 엔진 + AI DJ 카피)를 스스로 만들어 둡니다. 엔드포인트 오류 / `429 {fallback:true}` / 네트워크
  단절 시 `ai/ai.js` 가 **오프라인 mock 으로 자동 폴백**해 앱이 멈추지 않습니다(무인).

## Web Audio 데모 재생 원리

오디오 **파일이 하나도 없습니다.** `audio.js` 가 **Web Audio API** 로 각 트랙을 실시간 합성합니다. 트랙의 `root`/`mode`/`tempo`/`energy`/`valence` 로 4마디 루프를 구성합니다 — 코드 진행(장조 I–V–vi–IV, 단조 i–VI–III–VII)을 삼각파 패드로, 베이스 라인, 그리고 트랙 id로 시드된 결정론적 멜로디(에너지가 높을수록 음표 밀도↑). 파형과 로우패스 컷오프는 에너지/발랄도에 따라 달라지고, 고에너지 곡엔 노이즈 퍼커션, 비 태그 곡엔 필터드 노이즈가 더해집니다. 룩어헤드 스케줄러가 재생/일시정지/다음을 구동해 **모든 곡이 실제로 서로 다른 소리**를 냅니다 — 바이너리 0개, 저작권 위험 0.

## 로컬 실행

의존성·빌드 없음. 정적 서버면 됩니다.

```bash
python -m http.server 8985
# http://localhost:8985 접속
```

검증 + 추천 엔진 단위 테스트:

```bash
node check.mjs        # JSON 파싱·문법·필수 컨테이너·추천 엔진·AI 레이어·보안 검사
```

## 🔶 데모 모드 경계 (꼭 읽어주세요)

- **모든 트랙은 가상(FICTIONAL)** — 제목·아티스트·태그 전부 지어낸 것. **실제 곡·실제 아티스트 아님.**
- **모든 오디오는 Web Audio로 생성된 데모 톤** — **실제 음악·스트리밍 아님.**
- **추천 엔진은 규칙 기반, 머신러닝 아님** — 투명한 가중 점수, 모델·학습 없음.
- **저장은 `localStorage`, 실제 DB 아님** — 데이터는 브라우저에만 있으며 초기화 가능.
- **계정·실제 음원 카탈로그·서버 없음.**
- **실제 프로덕션 빌드라면:** 라이선스 확보된 음원 카탈로그·스트리밍, 실제 오디오 재생, 사용자 계정/동기화, 그리고 이 설명가능한 베이스라인 위에 ML/협업필터링 추천을 얹습니다.

## 기술

프레임워크·번들러 없는 순수 **HTML + CSS + ES 모듈 JavaScript**, 상대 경로만 사용. 소리는 Web Audio API, 아트는 인라인 SVG, 영속화는 `localStorage`. CI는 GitHub Actions에서 `node check.mjs` 실행.

## 파일 구조

```
index.html          SPA 셸(필수 컨테이너)
styles.css          모바일 우선, 라이트/다크
app.js              UI 배선·플레이어·영속화
recommender.js      설명가능한 랭킹 엔진(+유사곡/데일리믹스/발굴)
audio.js            Web Audio 절차적 합성 엔진
data/tracks.json    가상 트랙 43개 + 무드 6개
ai/config.js        AI_ENDPOINT 스위치("" = mock 데모)
ai/ai.js            플러그형 AI 레이어 — askAI(task,payload) + 한국어 MockProvider
server/index.mjs    백엔드 프록시 → Claude (비용 우선 Haiku·캐싱·예산)
server/worker.js    Cloudflare Workers 변형(무료·무인) + wrangler.toml
server/README.md    프록시 실행·보안 안내 · server/.env.example
check.mjs           CI 검증 + 추천 엔진 단위 테스트 + AI/보안 검사
.github/workflows/ci.yml
```

## 기여자

이일국(Dr. Lee Il-guk), LWJ, LMJ, Claude.

## 라이선스

- 코드: **Apache-2.0** — [LICENSE](./LICENSE) 참조.
- 문서: **CC BY 4.0**.

SPDX 헤더: `Apache-2.0` · `Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)`.

---

*Not an official Anthropic product.*

## 🎓 아이디어 출처

이 프로젝트의 씨앗이 된 아이디어는 **용인대학교 이일국 교수님의 창업 수업**에서 나왔습니다. 그 수업의 학생들이 내놓은 창업 아이디어들은 하나같이 특출나게 빛났고, 이 프로젝트는 그중에서도 유난히 반짝였던 아이디어를 마침내 실제로 작동하는 서비스로 구현한 것입니다. 번뜩이는 상상력을 보여준 제자들에게 깊은 존경과 고마움을 전합니다. *(학생 개인정보는 전혀 담지 않았으며, 아이디어만을 클린룸으로 새로 구현했습니다.)*
