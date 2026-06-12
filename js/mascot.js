/* =========================================================
 * mascot.js — マスコット「KIM」(ピクセルアートのコーギー)
 * 画像ファイル不要: ピクセルマップをcanvasに描画。
 * 出番: ①ホーム画面 ②AAが配られた時に走り抜ける ③ブラインドアップで旗を持って走る
 * ========================================================= */
"use strict";

const Mascot = (() => {
  const PALETTE = {
    K: "#1a1a1a", // 黒(輪郭)
    O: "#e0913f", // コーギーオレンジ
    W: "#ffffff", // 白
    Y: "#f0d04a", // ベスト黄
    R: "#d4373e", // 赤(蝶ネクタイ・スペード)
    P: "#f0907e", // 舌ピンク
  };

  // 22桁 × 20行のピクセルマップ
  const MAP = [
    "..KKK...........KKK...",
    ".KOOOK.........KOOOK..",
    ".KOWOOK.......KOOWOK..",
    "KOOWWOK.......KOWWOOK.",
    "KOOOOOKKKKKKKKKOOOOOK.",
    ".KOOOOOOOOOOOOOOOOOK..",
    "KOOOOOOOOOOOOOOOOOOOK.",
    "KOOOKKOOOOWWOOOOKKOOOK",
    "KOOOKKOOOWWWWOOOKKOOOK",
    "KOOOOOOWWWWWWWWOOOOOOK",
    ".KOOOOWWWWKKWWWWOOOOK.",
    ".KWWWWWWWWKKWWWWWWWWK.",
    ".KWWWWWWKKKKKKWWWWWWK.",
    "..KWWWWWWKPPKWWWWWWK..",
    "...KKWWWWKPPKWWWWKK...",
    ".KWWKKYYYRRRRYYYKKWWK.",
    "KWWWKYYYYRRRRYYYYKWWWK",
    "KWWWKYYYYYRRYYYYYKWWWK",
    "KWWKKYYRYYYYYYYYKKWWK.",
    "KKKKKYYYYYYYYYYYKKKKK.",
  ];

  function buildCanvas(scale) {
    scale = scale || 5;
    const h = MAP.length;
    const w = Math.max(...MAP.map(r => r.length));
    const cv = document.createElement("canvas");
    cv.width = w * scale;
    cv.height = h * scale;
    cv.style.imageRendering = "pixelated";
    const g = cv.getContext("2d");
    for (let y = 0; y < h; y++) {
      const row = MAP[y];
      for (let x = 0; x < row.length; x++) {
        const c = PALETTE[row[x]];
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return cv;
  }

  // KIMの本体要素(名札+カードファン付き)
  function buildEl(scale, opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "mascot" + (opts.className ? " " + opts.className : "");
    const body = document.createElement("div");
    body.className = "mascot-body";
    body.appendChild(buildCanvas(scale));
    // 名札 KIM
    const tag = document.createElement("div");
    tag.className = "mascot-tag";
    tag.textContent = "KIM";
    body.appendChild(tag);
    // 赤いカードのファン
    if (opts.cards !== false) {
      const fan = document.createElement("div");
      fan.className = "mascot-cards";
      for (let i = 0; i < 3; i++) {
        const c = document.createElement("div");
        c.className = "mc mc" + i;
        fan.appendChild(c);
      }
      body.appendChild(fan);
    }
    wrap.appendChild(body);
    return wrap;
  }

  // ホーム画面に常駐(ぴょこぴょこ)
  function mount(container) {
    if (!container) return;
    container.innerHTML = "";
    const el = buildEl(4, { className: "mascot-home" });
    container.appendChild(el);
  }

  // 画面を走り抜ける(flagText指定で旗持ち)
  let running = false;
  function run(opts) {
    opts = opts || {};
    if (running) return; // 多重走行防止
    running = true;
    const wrap = document.createElement("div");
    wrap.className = "mascot-run";
    const el = buildEl(4, { className: "mascot-runner" });
    if (opts.flagText) {
      const flag = document.createElement("div");
      flag.className = "mascot-flag";
      flag.innerHTML = `<div class="flag-pole"></div><div class="flag-cloth">${opts.flagText}</div>`;
      wrap.appendChild(flag);
    }
    if (opts.callout) {
      const co = document.createElement("div");
      co.className = "mascot-callout";
      co.textContent = opts.callout;
      wrap.appendChild(co);
    }
    wrap.appendChild(el);
    document.body.appendChild(wrap);
    setTimeout(() => { wrap.remove(); running = false; }, 4300);
  }

  return { mount, run, buildEl };
})();
