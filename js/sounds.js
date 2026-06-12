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

  const lib = {
    deal()    { noise(0, 0.07, 0.07, 2500); noise(0.07, 0.07, 0.05, 2500); },
    chip()    { tone(2100, 0, 0.035, "square", 0.045); tone(1700, 0.045, 0.035, "square", 0.045); },
    fold()    { noise(0, 0.12, 0.04, 600); },
    check()   { tone(190, 0, 0.045, "sine", 0.16); tone(165, 0.085, 0.05, "sine", 0.13); },
    jam()     { tone(290, 0, 0.26, "sawtooth", 0.06, 540); noise(0.03, 0.14, 0.04, 900); },
    turn()    { tone(880, 0, 0.09, "sine", 0.07); },
    good()    { tone(660, 0, 0.07, "sine", 0.08); tone(990, 0.07, 0.11, "sine", 0.08); },
    bad()     { tone(230, 0, 0.16, "square", 0.05, 185); tone(150, 0.15, 0.24, "square", 0.06); },
    win()     { tone(523, 0, 0.09, "triangle", 0.1); tone(659, 0.09, 0.09, "triangle", 0.1); tone(784, 0.18, 0.16, "triangle", 0.11); },
    collect() { tone(1900, 0, 0.03, "square", 0.035); tone(1450, 0.04, 0.03, "square", 0.035); },
    levelup() { tone(440, 0, 0.11, "triangle", 0.1); tone(587, 0.12, 0.11, "triangle", 0.1); tone(740, 0.24, 0.18, "triangle", 0.11); },
    bust()    { tone(392, 0, 0.2, "sawtooth", 0.06, 330); tone(294, 0.2, 0.24, "sawtooth", 0.06, 245); tone(196, 0.44, 0.42, "sawtooth", 0.07, 145); },
    final()   { tone(440, 0, 0.11, "square", 0.07); tone(554, 0.12, 0.11, "square", 0.07); tone(659, 0.24, 0.3, "square", 0.09); tone(880, 0.42, 0.4, "triangle", 0.1); },
    victory() {
      // ファンファーレ: タタタターン! → メロディ → キラキラ → フィナーレ和音
      const intro = [[523, 0, 0.13], [523, 0.14, 0.13], [523, 0.28, 0.13], [659, 0.42, 0.5]];
      for (const [f, t, d] of intro) { tone(f, t, d, "triangle", 0.13); tone(f / 2, t, d, "square", 0.05); }
      const melody = [[784, 1.0, 0.18], [659, 1.2, 0.18], [784, 1.4, 0.18], [1047, 1.6, 0.62]];
      for (const [f, t, d] of melody) { tone(f, t, d, "triangle", 0.13); tone(f * 1.5, t, d, "sine", 0.04); }
      for (let i = 0; i < 14; i++) tone(1400 + Math.random() * 1800, 1.7 + i * 0.1, 0.09, "sine", 0.035);
      [523, 659, 784, 1047].forEach(f => { tone(f, 3.2, 1.4, "triangle", 0.07); tone(f, 3.2, 1.4, "sine", 0.04); });
      tone(131, 3.2, 1.4, "square", 0.05);
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
