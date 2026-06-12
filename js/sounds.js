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
      // 8bitファンファーレ: タタタターン → 主旋律 → アルペジオの滝 → フィナーレ分散和音
      const seq = [
        [784, 0, .1], [784, .12, .1], [784, .24, .1], [1047, .36, .42],
        [932, .85, .14], [1047, 1.0, .14], [1175, 1.15, .42],
        [1047, 1.65, .12], [1175, 1.78, .12], [1319, 1.9, .55],
      ];
      for (const [f, t, d] of seq) { tone(f, t, d, "square", 0.08); tone(f / 2, t, d, "square", 0.04); }
      // 三角波ベースライン
      [131, 165, 196, 262].forEach((f, i) => tone(f, i * 0.6, 0.55, "triangle", 0.07));
      // アルペジオの滝
      for (let i = 0; i < 12; i++) tone(1047 * Math.pow(2, (i % 4) / 4), 2.5 + i * 0.07, 0.06, "square", 0.04);
      // フィナーレ
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 3.4 + i * 0.03, 1.1, "square", 0.045));
      tone(131, 3.4, 1.2, "triangle", 0.07);
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
