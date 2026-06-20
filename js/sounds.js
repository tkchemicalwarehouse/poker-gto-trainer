/* =========================================================
 * sounds.js — WebAudioによる効果音合成(音声ファイル不要)
 * ========================================================= */
"use strict";

const Sfx = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem("pgt_muted") === "1"; } catch (e) { }

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, t0, dur, type, vol, slideTo) {
    const a = ac(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine";
    const start = a.currentTime + t0;
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(a.destination);
    o.start(start); o.stop(start + dur + 0.05);
  }

  function noise(t0, dur, vol, freq) {
    const a = ac(); if (!a) return;
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = a.createBufferSource(); s.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = freq || 1500;
    const g = a.createGain(); g.gain.value = vol || 0.1;
    s.connect(f); f.connect(g); g.connect(a.destination);
    s.start(a.currentTime + t0);
  }

  /* ---------- ファミコン風チップチューン ----------
   * 矩形波(パルス)2ch + 三角波ベース、短い音とアルペジオが8bitの肝
   */
  const lib = {
    deal()    { tone(1568, 0, 0.04, "square", 0.05); tone(1175, 0.05, 0.04, "square", 0.045); },
    chip()    { tone(988, 0, 0.035, "square", 0.06); tone(1319, 0.04, 0.05, "square", 0.05); },
    fold()    { tone(330, 0, 0.05, "square", 0.05); tone(220, 0.06, 0.07, "square", 0.045); },
    check()   { tone(262, 0, 0.04, "square", 0.07); tone(262, 0.08, 0.04, "square", 0.06); },
    jam()     { [262, 330, 392, 523, 659].forEach((f, i) => tone(f, i * 0.05, 0.05, "square", 0.07)); },
    turn()    { tone(1047, 0, 0.05, "square", 0.06); tone(1319, 0.055, 0.07, "square", 0.05); },
    good()    { tone(988, 0, 0.06, "square", 0.07); tone(1319, 0.06, 0.12, "square", 0.07); }, // コイン音
    bad()     { tone(196, 0, 0.09, "square", 0.07); tone(147, 0.1, 0.09, "square", 0.07); tone(98, 0.2, 0.16, "square", 0.07); },
    win()     { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.08, "square", 0.07)); tone(262, 0, 0.3, "triangle", 0.06); },
    collect() { tone(784, 0, 0.04, "square", 0.04); tone(988, 0.05, 0.05, "square", 0.04); },
    levelup() { [392, 494, 587, 784, 988].forEach((f, i) => tone(f, i * 0.07, 0.08, "square", 0.07)); tone(196, 0, 0.4, "triangle", 0.06); },
    bust()    { [392, 370, 349, 330].forEach((f, i) => tone(f, i * 0.15, 0.14, "square", 0.07)); tone(165, 0.65, 0.5, "square", 0.06, 82); tone(98, 0.65, 0.6, "triangle", 0.06); },
    final()   { [330, 330, 330, 262].forEach((f, i) => tone(f, i * 0.12, 0.1, "square", 0.08)); tone(392, 0.55, 0.35, "square", 0.09); tone(98, 0, 0.9, "triangle", 0.06); },
    victory() {
      // 軍艦マーチ風の行進曲: oom-pahベース + スネア + ブラス主旋律 + 大団円
      const T = 0.14; // 8分音符の長さ
      const N = { C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494, C5: 523, D5: 587, E5: 659, F5: 698, G5: 784, A5: 880, C3: 131, D3: 147, E3: 165, F3: 175, G3: 196, A3: 220, B3: 247 };
      const sq = (f, s, d, v) => { tone(f, s * T, d * T, "square", v || 0.085); tone(f / 2, s * T, d * T, "square", (v || 0.085) * 0.45); };
      const tri = (f, s, d, v) => tone(f, s * T, d * T, "triangle", v || 0.09);
      const snare = (s, v) => noise(s * T, 0.05, v || 0.06, 2200);
      const crash = (s, v) => noise(s * T, 0.4, v || 0.13, 3500);
      // 主旋律(行進曲・8分グリッド)
      const mel = [
        ["G4", 0, 1], ["C5", 1, 2], ["E5", 3, 1],
        ["G5", 4, 2], ["E5", 6, 1], ["C5", 7, 1],
        ["D5", 8, 2], ["E5", 10, 1], ["F5", 11, 1], ["E5", 12, 4],
        ["E5", 16, 2], ["D5", 18, 1], ["C5", 19, 1], ["D5", 20, 2], ["B4", 22, 2],
        ["C5", 24, 1], ["D5", 25, 1], ["E5", 26, 2], ["G5", 28, 4],
        // 大団円
        ["C5", 32, 1], ["E5", 33, 1], ["G5", 34, 1], ["C5", 35, 1], ["G5", 36, 4],
        ["C5", 40, 6]
      ];
      mel.forEach(m => sq(N[m[0]], m[1], m[2], 0.09));
      // oom-pah ベース + スネア(行進ビート)
      const END = 40;
      for (let b = 0; b < END; b += 2) {
        const isC = Math.floor(b / 4) % 2 === 0;     // I(C) と V(G) を交互
        tri(N[isC ? "C3" : "G3"], b, 1, 0.1);         // ドン(表拍)
        sq(N[isC ? "G4" : "D4"], b + 1, 1, 0.05);     // パッ(裏拍コード)
        snare(b, 0.06); snare(b + 1, 0.045);
      }
      crash(0, 0.14); crash(16, 0.1); crash(32, 0.12);
      // フィナーレ和音(ジャーン)
      crash(40, 0.16);
      ["C5", "E5", "G5"].forEach(n => sq(N[n], 40, 7, 0.05));
      tri(N.C3, 40, 7, 0.11); tri(N.G3, 40, 7, 0.06);
      tone(2093, 40 * T, 1.0, "square", 0.04);       // 高音キラッ
    },
  };

  return {
    play(name) {
      if (muted) return;
      try { if (lib[name]) lib[name](); } catch (e) { }
    },
    toggle() {
      muted = !muted;
      try { localStorage.setItem("pgt_muted", muted ? "1" : "0"); } catch (e) { }
      return muted;
    },
    isMuted() { return muted; },
  };
})();
