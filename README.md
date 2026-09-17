# 기책 · 기분은 내가 책임질게 (Gichaek) 🎧

**A mood-based music recommender & player with an explainable, rule-based engine and real, procedurally generated audio.**

> Read this in Korean: [README.ko.md](./README.ko.md)

**🔴 LIVE DEMO: https://clsoftlab-lang.github.io/music-mood-recommender/**

Pick a mood → get a ranked playlist from the recommender → press play (real generated sound) → like/dislike to teach it your taste → discover new indie artists whose exposure is guaranteed.

---

## What it is

*기분은 내가 책임질게* ("I'll take care of your mood") recommends music by **mood/situation** — 행복(happy), 위로(comfort), 집중(focus), 운동(workout), 비오는날(rainy), 드라이브(drive) — and surfaces **new / indie artists**. It is a single-page app that runs entirely in the browser with zero build step and zero backend.

## How the recommender works

The engine (`recommender.js`) is **rule-based and fully explainable** — every song shows *why* it was picked. Each track carries feature tags: `genre`, `tempo` (BPM), `energy` (0–1), `valence` (발랄도, positivity 0–1) and free tags. Each mood defines a target profile (ideal energy/valence, preferred tempo range, preferred tags). A track's score is a weighted sum of five normalized components:

| Component | Weight | What it measures |
|-----------|:------:|------------------|
| `feature` | 0.40 | how close a track's energy & valence are to the mood target |
| `tag`     | 0.25 | overlap between the mood's preferred tags and the track's tags |
| `taste`   | 0.20 | your learned likes/dislikes (tag & genre weights, `tanh`-squashed) |
| `tempo`   | 0.10 | fit inside the mood's BPM range (linear falloff outside) |
| `newArtist` | 0.05 | guaranteed exposure boost for new artists |

Ranking is **deterministic** (ties break by id). Liking a track adds weight to its tags/genre; disliking subtracts. The engine also powers **similar-track** discovery, a taste-only **daily mix**, and a dedicated **new-artist** section.

## Features

- 🎭 6 moods + real-time **energy / valence sliders** to reshape results
- 🧠 Explainable ranking — each row shows a match % and human reasons
- ▶️ Working player: play / pause / next / prev, progress bar, volume, seek
- ❤️ Like / dislike learns your taste and re-ranks instantly
- 🌱 New-artist discovery section (exposure guaranteed)
- 🔁 "Similar songs" from any track · ✨ taste-based Daily Mix
- 🔎 Search + genre filter · 🌓 light / dark / auto theme
- 💾 Taste profile & likes persist to `localStorage` (with reset)
- 🎨 Album art = inline SVG gradient covers · mobile-first responsive

## 🤖 AI features (API integration)

The app has a **secure, pluggable AI layer** (`ai/`). Three features, all working:

1. **AI DJ** — type a free-text mood ("비 오는 밤 드라이브") and get a playlist. The natural-language mood is parsed to a mood + energy/valence target, the **rule-based `recommender.js` builds the playlist**, and the AI narrates the pick.
2. **Track-reason narration** — a human-readable sentence per track explaining why it fits the mood.
3. **Mood / playlist copy** — a catchy title, blurb, and hashtags for the current mood.

**Demo = mock (default).** With `ai/config.js` → `AI_ENDPOINT = ""`, everything runs **in the browser** via a deterministic Korean `MockProvider` that reuses `recommender.js` — no server, no key, fully offline.

**Enable real Claude.** Run the backend proxy and point the front end at it:

```bash
cd server
npm install                 # @anthropic-ai/sdk
cp .env.example .env        # set ANTHROPIC_API_KEY in .env
npm start                   # http://localhost:8788/api/ai
```

Then set `ai/config.js`:

```js
export const AI_ENDPOINT = "http://localhost:8788/api/ai";
```

The proxy calls Claude (model **`claude-opus-5`**, `thinking: {type: "adaptive"}`) and streams text back. See [`server/README.md`](./server/README.md).

> **🔒 API keys are server-side ONLY.** The key is read from `ANTHROPIC_API_KEY` in the backend process — **never in the browser, never in the repo.** The front end only ever knows the proxy URL. `node check.mjs` scans the source for real key formats and asserts `AI_ENDPOINT` is empty.

## How the Web Audio demo playback works

There is **no audio file anywhere**. `audio.js` synthesizes each track live with the **Web Audio API**. From a track's `root`/`mode`/`tempo`/`energy`/`valence` it builds a 4-bar loop: a chord progression (I–V–vi–IV for major, i–VI–III–VII for minor) as a triangle-wave pad, a bass line, and a deterministic melody (seeded per track id, denser at higher energy). Waveform and low-pass cutoff scale with energy/valence; high-energy tracks add noise-based percussion, rainy-tagged tracks add filtered noise. A look-ahead scheduler drives play/pause/next so **every track genuinely produces a distinct sound** — zero binaries, zero copyright risk.

## Run locally

No dependencies, no build. Any static server works:

```bash
python -m http.server 8985
# then open http://localhost:8985
```

Run the checks + recommender unit tests:

```bash
node check.mjs        # JSON parse, syntax, required containers, recommender + AI-layer + security checks
```

## 🔶 DEMO-MODE boundaries (read this)

- **All tracks are FICTIONAL** — invented titles, artists and tags. **No real songs, no real artists.**
- **All audio is PROCEDURALLY GENERATED demo tone** via Web Audio — **NOT real music, not streaming.**
- **The recommender is RULE-BASED, NOT machine learning** — transparent weighted scoring, no model, no training.
- **Persistence is `localStorage`, NOT a real database** — data lives only in your browser and can be reset.
- **No accounts, no real audio catalog, no server.**
- **A real production build would add:** a licensed music catalog & streaming, real audio playback, user accounts/sync, and an ML/collaborative-filtering recommender on top of this explainable baseline.

## Tech

Vanilla **HTML + CSS + ES-module JavaScript**, no framework, no bundler, relative paths only. Web Audio API for sound, inline SVG for art, `localStorage` for persistence. CI runs `node check.mjs` on GitHub Actions.

## Files

```
index.html          SPA shell (required containers)
styles.css          mobile-first, light/dark
app.js              UI wiring, player, persistence
recommender.js      explainable ranking engine (+ similar / daily mix / discover)
audio.js            Web Audio procedural synth engine
data/tracks.json    43 fictional tracks + 6 moods
ai/config.js        AI_ENDPOINT switch ("" = mock demo)
ai/ai.js            pluggable AI layer — askAI(task,payload) + Korean MockProvider
server/index.mjs    backend proxy → Claude (key stays server-side)
server/README.md    proxy run + security notes · server/.env.example
check.mjs           CI checks + recommender unit tests + AI/security checks
.github/workflows/ci.yml
```

## Contributors

Dr. Lee Il-guk (이일국), LWJ, LMJ, Claude.

## License

- Code: **Apache-2.0** — see [LICENSE](./LICENSE).
- Documentation: **CC BY 4.0**.

SPDX headers: `Apache-2.0` · `Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)`.

---

*Not an official Anthropic product.*

## 🎓 Idea origin

The seed idea for this project came from the **entrepreneurship class taught by Dr. Lee Il-guk (이일국) at Yongin University (용인대학교)**. The students in that class produced startup ideas of remarkable, standout creativity — this project is one of those exceptional ideas, finally brought to life as a working service. Built with deep admiration and gratitude for those students' imagination. *(No student personal information is included; only the idea itself was used, implemented clean-room.)*
