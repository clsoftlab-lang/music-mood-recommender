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
node check.mjs        # JSON parse, syntax, required containers, 33 assertions
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
check.mjs           CI checks + recommender unit tests
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
