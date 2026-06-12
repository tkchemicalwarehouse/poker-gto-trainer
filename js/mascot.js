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

  // 汎用ピクセル描画(シーンでも使用)
  function pixelCanvas(map, palette, scale, mirror) {
    scale = scale || 5;
    const h = map.length;
    const w = Math.max(...map.map(r => r.length));
    const cv = document.createElement("canvas");
    cv.width = w * scale;
    cv.height = h * scale;
    cv.style.imageRendering = "pixelated";
    const g = cv.getContext("2d");
    for (let y = 0; y < h; y++) {
      const row = map[y];
      for (let x = 0; x < row.length; x++) {
        const c = palette[row[x]];
        if (!c) continue;
        g.fillStyle = c;
        const px = mirror ? (w - 1 - x) : x;
        g.fillRect(px * scale, y * scale, scale, scale);
      }
    }
    return cv;
  }

  function buildCanvas(scale) {
    return pixelCanvas(MAP, PALETTE, scale, false);
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

  return { mount, run, buildEl, pixelCanvas };
})();

/* =========================================================
 * Scene — ホーム画面の対決シーン(KIM DWAN vs NGUYEN)
 * ========================================================= */
const Scene = (() => {
  // KIM DWAN: 白髪逆立ち・黒パーカー・不敵な笑み・赤いカード
  const KIM_PAL = {
    K: "#16161c", W: "#f2f2ee", S: "#f0c8a0", D: "#33333e",
    M: "#7a3b2e", R: "#d4373e", H: "#d9d9d2",
  };
  const KIM_MAP = [
    "..W...W..W...W......",
    ".WW.WWWWWWW.WW......",
    ".WWWWWWWWWWWW.......",
    "WWWWWWWWWWWWWW......",
    "WWHWWWWWWWHWWW......",
    "WWSSSSSSSSSSWW......",
    "WSSSSSSSSSSSSW......",
    "WSKKSSSSSKKSSW......",
    "WSSKKSSSKKSSSW......",
    ".SSSSSSSSSSSS.......",
    ".SSSSSKKSSSSS.......",
    ".SSSSSSSSKKSS.......",
    "..SSSSSSSSSS........",
    "..DDSSSSSSDD....RR..",
    ".DDDDSSSSDDDD..RRRR.",
    "DDDDDDDDDDDDDD.RRRR.",
    "DDDDDDDDDDDDDDRRRR..",
    "DDDDDDDDDDDDDDSRR...",
    "DDDDDDDDDDDDDDSS....",
    "DDDDDDDDDDDDDD......",
  ];
  // NGUYEN: 黒髪・緑ジャケット・冷や汗・困り顔
  const NG_PAL = {
    K: "#16161c", B: "#23232c", S: "#f0c8a0", G: "#2e7d4f",
    C: "#7fd8ff", R: "#d4373e", W: "#ffffff",
  };
  const NG_MAP = [
    "....BBBBBBBB........",
    "..BBBBBBBBBBBB......",
    ".BBBBBBBBBBBBBB.....",
    ".BBBBBBBBBBBBBB.C...",
    ".BBSSSSSSSSSSBB.CC..",
    ".BSSSSSSSSSSSSB.C...",
    ".BSKKSSSSSKKSSB.....",
    ".BSSKSSSSSKSSSB.....",
    "..SSSSSSSSSSSS......",
    "..SSSSSKKSSSSS......",
    "..SSSKKKKKKSSS......",
    "...SSSSSSSSSS.......",
    "...GGSSSSSSGG..RR...",
    "..GGGGSSSSGGGG.RRR..",
    ".GGGGGGGGGGGGGGRRR..",
    ".GGGGGGGGGGGGGRRR...",
    ".GGGGGGGGGGGGGSRR...",
    ".GGGGGGGGGGGGGSS....",
    ".GGGGGGGGGGGGGG.....",
    ".GGGGGGGGGGGGGG.....",
  ];

  function chipStackDiv(colors) {
    const st = document.createElement("div");
    st.className = "sc-chips";
    colors.forEach((col, i) => {
      const c = document.createElement("div");
      c.className = "sc-chip";
      c.style.background = col;
      c.style.bottom = (i * 4) + "px";
      st.appendChild(c);
    });
    return st;
  }

  function mount(container) {
    if (!container || typeof Mascot === "undefined") return;
    container.innerHTML = "";
    const sc = document.createElement("div");
    sc.className = "scene";
    // 吹き出し
    const bubble = document.createElement("div");
    bubble.className = "sc-bubble";
    bubble.textContent = "トナメ中盤戦、、、、どうする、、、、";
    sc.appendChild(bubble);
    // キャラクター
    const kim = document.createElement("div");
    kim.className = "sc-char sc-kim";
    kim.appendChild(Mascot.pixelCanvas(KIM_MAP, KIM_PAL, 5, false));
    sc.appendChild(kim);
    const ng = document.createElement("div");
    ng.className = "sc-char sc-ng";
    ng.appendChild(Mascot.pixelCanvas(NG_MAP, NG_PAL, 5, true));
    sc.appendChild(ng);
    // テーブル(フェルト+カード+チップ)
    const table = document.createElement("div");
    table.className = "sc-table";
    const cards = document.createElement("div");
    cards.className = "sc-cards";
    for (let i = 0; i < 3; i++) {
      const cd = document.createElement("div");
      cd.className = "sc-card";
      cards.appendChild(cd);
    }
    table.appendChild(cards);
    const chipL = chipStackDiv(["#e3c635", "#d4373e", "#2563ad", "#e3c635", "#8e44ad"]);
    chipL.style.left = "26%";
    table.appendChild(chipL);
    const chipR = chipStackDiv(["#2563ad", "#e3c635", "#d4373e", "#2e7d4f"]);
    chipR.style.right = "26%";
    table.appendChild(chipR);
    sc.appendChild(table);
    // 名前プレート
    const nameL = document.createElement("div");
    nameL.className = "sc-name sc-name-l";
    nameL.textContent = "KIM DWAN";
    sc.appendChild(nameL);
    const nameR = document.createElement("div");
    nameR.className = "sc-name sc-name-r";
    nameR.textContent = "NGUYEN";
    sc.appendChild(nameR);
    container.appendChild(sc);
  }

  return { mount };
})();
