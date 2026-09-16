// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// audio.js — Web Audio API 기반 절차적(procedural) 데모 오디오 엔진.
// ⚠️ DEMO: 저작권 있는 실제 음악이 아닙니다. 각 트랙의 파라미터(root/mode/tempo/
// energy/valence)로 코드 진행 + 베이스 + 멜로디 + (고에너지 시) 퍼커션을 실시간
// 합성합니다. 재생/일시정지/다음이 실제로 소리를 냅니다. 바이너리 0개, 저작권 0건.

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
// 스케일 인덱스로 표현한 코드 진행 (bar 당 하나, 4마디 루프)
const PROGRESSION = {
  major: [0, 4, 5, 3], // I - V - vi - IV
  minor: [0, 5, 2, 6], // i - VI - III - VII
};

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 결정론적 PRNG (트랙별 멜로디 고정)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.playing = false;
    this.track = null;
    this.volume = 0.7;
    this._plan = null;        // 사전 계산된 시퀀스
    this._timer = null;
    this._startTime = 0;      // 이번 재생이 시작된 ctx 시각
    this._elapsedAtStart = 0; // 이전까지 누적된 재생 초(일시정지 대비)
    this._step = 0;
    this._nextNoteTime = 0;
    this.loopDuration = 8;
    this.onEnded = null;      // 루프가 아니라 명시적 정지에만 사용
  }

  _ensureCtx() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // 화이트노이즈 버퍼 (퍼커션·비 효과용)
    const len = this.ctx.sampleRate * 1;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  // 트랙 파라미터로 시퀀스를 사전 계산
  _plan_track(track) {
    const mode = track.mode === "minor" ? "minor" : "major";
    const scale = SCALES[mode];
    const root = track.root || 60;
    const rnd = mulberry32(hashId(track.id));

    const beatsPerBar = 4;
    const bars = 4;
    const totalBeats = beatsPerBar * bars;
    const secPerBeat = 60 / (track.tempo || 90);
    const stepsPerBeat = 2; // 8분음표 그리드
    const totalSteps = totalBeats * stepsPerBeat;
    const stepDur = secPerBeat / stepsPerBeat;
    this.loopDuration = totalSteps * stepDur;

    const scaleNote = (deg) => {
      const oct = Math.floor(deg / 7);
      return root + 12 * oct + scale[((deg % 7) + 7) % 7];
    };
    // bar 별 코드(3화음) + 베이스
    const chords = [];
    const bass = [];
    const prog = PROGRESSION[mode];
    for (let b = 0; b < bars; b++) {
      const d = prog[b % prog.length];
      chords.push([scaleNote(d), scaleNote(d + 2), scaleNote(d + 4)]);
      bass.push(scaleNote(d) - 12);
    }
    // 멜로디 패턴: energy 높을수록 음표 밀도↑
    const density = 0.35 + (track.energy || 0.5) * 0.55;
    const melody = new Array(totalSteps).fill(null);
    for (let s = 0; s < totalSteps; s++) {
      const bar = Math.floor(s / (stepsPerBeat * beatsPerBar));
      const chordDeg = prog[bar % prog.length];
      if (s % (stepsPerBeat * beatsPerBar) === 0 || rnd() < density) {
        // 코드 톤 위주, 가끔 경과음
        const pick = [0, 2, 4, 4, 6, 1][Math.floor(rnd() * 6)];
        melody[s] = scaleNote(chordDeg + pick) + 12;
      }
    }
    // 음색: energy/valence 기반
    const melWave = track.energy > 0.7 ? "sawtooth" : track.energy > 0.45 ? "triangle" : "sine";
    const padWave = "triangle";
    const cutoff = 700 + (track.valence || 0.5) * 4200 + (track.energy || 0.5) * 1800;
    const hasPerc = (track.energy || 0) >= 0.6;
    const hasRain = (track.tags || []).includes("rainy");

    return {
      scale, root, mode, chords, bass, melody, totalSteps, stepDur, secPerBeat,
      beatsPerBar, stepsPerBeat, melWave, padWave, cutoff, hasPerc, hasRain,
    };
  }

  load(track) {
    this.stop();
    this.track = track;
    if (this.ctx) this._plan = this._plan_track(track);
  }

  play(track) {
    this._ensureCtx();
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (track && (!this.track || track.id !== this.track.id)) {
      this.track = track;
      this._elapsedAtStart = 0;
      this._step = 0;
    }
    if (!this.track) return;
    if (!this._plan || (track && this._plan && this.track.id !== this._plan._id)) {
      this._plan = this._plan_track(this.track);
      this._plan._id = this.track.id;
    }
    if (this.playing) return;
    this.playing = true;
    this._startTime = this.ctx.currentTime;
    // 일시정지 지점에서 재개
    this._step = Math.round((this._elapsedAtStart % this.loopDuration) / this._plan.stepDur);
    this._nextNoteTime = this.ctx.currentTime + 0.05;
    this._scheduler();
  }

  pause() {
    if (!this.playing) return;
    this._elapsedAtStart += this.ctx.currentTime - this._startTime;
    this.playing = false;
    clearTimeout(this._timer);
  }

  toggle(track) {
    if (this.playing) this.pause();
    else this.play(track);
    return this.playing;
  }

  stop() {
    this.playing = false;
    clearTimeout(this._timer);
    this._elapsedAtStart = 0;
    this._step = 0;
  }

  // 진행바용: 루프 내 현재 위치
  getPosition() {
    if (!this.ctx || !this._plan) return { fraction: 0, seconds: 0, duration: this.loopDuration };
    const elapsed = this._elapsedAtStart + (this.playing ? this.ctx.currentTime - this._startTime : 0);
    const pos = elapsed % this.loopDuration;
    return { fraction: pos / this.loopDuration, seconds: pos, duration: this.loopDuration };
  }

  _scheduler() {
    if (!this.playing) return;
    const p = this._plan;
    const lookahead = 0.1;
    while (this._nextNoteTime < this.ctx.currentTime + lookahead) {
      this._scheduleStep(this._step % p.totalSteps, this._nextNoteTime);
      this._nextNoteTime += p.stepDur;
      this._step++;
    }
    this._timer = setTimeout(() => this._scheduler(), 25);
  }

  _scheduleStep(step, time) {
    const p = this._plan;
    const bar = Math.floor(step / (p.stepsPerBeat * p.beatsPerBar));
    const inBar = step % (p.stepsPerBeat * p.beatsPerBar);

    // 마디 시작: 패드 코드 + 베이스
    if (inBar === 0) {
      const barLen = p.stepDur * p.stepsPerBeat * p.beatsPerBar;
      for (const m of p.chords[bar % p.chords.length]) {
        this._voice(midiToFreq(m), time, barLen * 0.95, {
          wave: p.padWave, gain: 0.10, attack: 0.05, cutoff: p.cutoff * 0.7,
        });
      }
      this._voice(midiToFreq(p.bass[bar % p.bass.length]), time, barLen * 0.9, {
        wave: "sine", gain: 0.22, attack: 0.01, cutoff: 500,
      });
    }
    // 멜로디
    const note = p.melody[step];
    if (note != null) {
      this._voice(midiToFreq(note), time, p.stepDur * 0.9, {
        wave: p.melWave, gain: 0.16, attack: 0.005, cutoff: p.cutoff,
      });
    }
    // 퍼커션 (고에너지)
    if (p.hasPerc) {
      if (inBar % p.stepsPerBeat === 0) this._noise(time, 0.05, 0.12, 2000, 8000); // 킥/스네어 느낌
      this._noise(time, 0.02, 0.05, 6000, 12000); // 하이햇
    }
    // 비 효과
    if (p.hasRain && step % 2 === 0) this._noise(time, p.stepDur, 0.015, 200, 1200);
  }

  _voice(freq, time, dur, { wave = "sine", gain = 0.15, attack = 0.01, cutoff = 4000 } = {}) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    osc.type = wave;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(f);
    f.connect(g);
    g.connect(this.master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  _noise(time, dur, gain, lo, hi) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = (lo + hi) / 2;
    f.Q.value = 0.7;
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(time);
    src.stop(time + dur + 0.02);
  }
}
