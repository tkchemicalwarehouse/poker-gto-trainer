/* =========================================================
 * dog.js — 装備中の犬を各場面で動かす
 * - 走り抜け / 看板ウォーク = 手描きドット絵スプライト(脚2コマでアニメ)
 * - 優勝モーダル = イラスト(透過PNG)
 * 画像も無い犬は Mascot にフォールバック。
 * ========================================================= */
"use strict";

const Dog = (() => {
  function eq() { return (typeof Cosmetics !== "undefined" && Cosmetics.equippedDog) ? Cosmetics.equippedDog() : null; }
  function src() { var d = eq(); return d && d.img ? d.img : null; }
  function hasImg() { return !!src(); }

  /* ---- ジャックコギ 走りドット絵(横向き・右へ走る) ----
   * K=輪郭 O=毛(タン) W=白 N=鼻 P=舌 M=マゼンタの背中マント */
  var CORGI_PAL = { K: "#2a2118", O: "#d98e4a", W: "#fdf6ec", N: "#1a140d", P: "#f0807e", M: "#c0246b" };
  var C_UP = [
    "..........KK......",
    "...K......KOOK....",
    "..KOK....KOOOOK...",
    "..KOKKKKKKOOOOOK..",
    ".KOOOOOOMMOOOWOK..",
    ".KOOOOOOMMOOOONK..",
    ".KOOOOOOMMOOOWWK..",
    ".KOOOOOOMMOOOOKK..",
    ".KWWWWWWWWWWWWK..."
  ];
  var C_LEGA = ["..KO.......KO.....", "..KW.......KW.....", "..KK.......KK....."];
  var C_LEGB = ["....KO...KO.......", "....KW...KW.......", "....KK...KK......."];

  // 装備キャラの配色で走りパレットを作る(O=毛 W=白 M=差し色を上書き)
  function runPalette() {
    var rp = (typeof Cosmetics !== "undefined" && Cosmetics.equippedDog && (Cosmetics.equippedDog() || {}).runPal) || null;
    if (!rp) return CORGI_PAL;
    return { K: CORGI_PAL.K, N: CORGI_PAL.N, P: CORGI_PAL.P, O: rp.O || CORGI_PAL.O, W: rp.W || CORGI_PAL.W, M: rp.M || CORGI_PAL.M };
  }
  // 脚2コマを切り替える走りスプライト(canvas2枚をトグル)
  function corgiSprite(scale, speedMs) {
    if (typeof Mascot === "undefined" || !Mascot.pixelCanvas) return null;
    var PAL = runPalette();
    var FA = C_UP.concat(C_LEGA), FB = C_UP.concat(C_LEGB);
    var box = document.createElement("div"); box.className = "dog-sprite-box";
    var a = Mascot.pixelCanvas(FA, PAL, scale, false);
    var b = Mascot.pixelCanvas(FB, PAL, scale, false);
    a.className = "dog-frame"; b.className = "dog-frame"; b.style.display = "none";
    box.appendChild(a); box.appendChild(b);
    var i = 0;
    box._timer = setInterval(function () { i ^= 1; a.style.display = i ? "none" : "block"; b.style.display = i ? "block" : "none"; }, speedMs || 120);
    return box;
  }
  function scaleNow() { return document.body.classList.contains("mode-phone") ? 7 : 9; }

  // 画面を走り抜ける(旗・吹き出し対応) = ドット絵で脚を動かす
  function run(opts) {
    opts = opts || {};
    var box = corgiSprite(scaleNow(), 110);
    if (!box) { if (typeof Mascot !== "undefined" && Mascot.run) Mascot.run(opts); return; }
    var wrap = document.createElement("div"); wrap.className = "dog-run";
    if (opts.flagText) {
      var f = document.createElement("div"); f.className = "mascot-flag";
      f.innerHTML = '<div class="flag-pole"></div><div class="flag-cloth">' + opts.flagText + '</div>';
      wrap.appendChild(f);
    }
    if (opts.callout) {
      var c = document.createElement("div"); c.className = "mascot-callout"; c.textContent = opts.callout;
      wrap.appendChild(c);
    }
    box.classList.add("dog-gallop");
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    setTimeout(function () { clearInterval(box._timer); wrap.remove(); }, 4300);
  }

  // 看板ウォーク(BUBBLE / FINAL TABLE) = ドット絵でゆっくり歩く
  function sign(lines) {
    var box = corgiSprite(scaleNow(), 220);
    if (!box) { if (typeof Mascot !== "undefined" && Mascot.bunnyWalk) Mascot.bunnyWalk(lines); return; }
    var wrap = document.createElement("div"); wrap.className = "dog-run dog-walk";
    var sg = document.createElement("div"); sg.className = "bunny-sign";
    sg.innerHTML = lines.map(function (t, i) { return '<div class="bs-line bs-' + i + '">' + t + '</div>'; }).join("");
    wrap.appendChild(sg);
    box.classList.add("dog-sway");
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    setTimeout(function () { clearInterval(box._timer); wrap.remove(); }, 7600);
  }

  // 優勝モーダル用の犬画像(イラスト)。無ければ空。
  function victoryImgTag() {
    var s = src();
    return s ? '<img src="' + s + '" class="dog-victory" alt="">' : "";
  }

  // アドバイスボタン用: 装備キャラがチップ系ならそのチップ画像、そうでなければ null(=🐶のまま)
  function advisorChip() {
    var d = eq();
    return (d && d.chip && d.img) ? d.img : null;
  }

  /* ---- HU POV用 ドット絵: 前景の手(コーギーの手) ---- */
  var PAWS_PAL = { K: "#2a2118", O: "#d98e4a", W: "#fdf6ec" };
  var PAW1 = [".KK.KK.KK.", "KOOKOOKOOK", "KOOOOOOOOK", "KOWWWWWWOK", "KOOOOOOOOK", ".KOOOOOOK.", "..KKKKKK.."];
  var PAWS = PAW1.map(function (r) { return r + "...." + r; });
  function pawsCanvas(scale) {
    return (typeof Mascot !== "undefined" && Mascot.pixelCanvas) ? Mascot.pixelCanvas(PAWS, PAWS_PAL, scale || 10, false) : null;
  }
  /* ---- ライバル(メダル/チップ画像。プレースホルダ4種・後で追加/差替可) ---- */
  var RIVALS = [
    { name: "トリックキャット", img: "img/rivals/cat.webp", value: 1 },
    { name: "ガチホ・ブル",     img: "img/rivals/bulldog.webp", value: 5 },
    { name: "オール・オウル",   img: "img/rivals/owl.webp", value: 25 },
    { name: "オーシャンキング", img: "img/rivals/shark.webp", value: 100 },
    { name: "ゴールデンタイガー", img: "img/rivals/tiger.webp", value: 1000 },
    { name: "シルバーライオン", img: "img/rivals/lion.webp", value: 2500 },
    { name: "アイスベア",       img: "img/rivals/bear.webp", value: 4000 },
    { name: "レインボーユニコーン", img: "img/rivals/unicorn.webp", value: 10000 },
  ];
  var curRival = RIVALS[0];
  function pickOpponent() { curRival = RIVALS[Math.floor(Math.random() * RIVALS.length)] || RIVALS[0]; return curRival; }
  function oppName() { return curRival ? curRival.name : "RIVAL"; }
  function oppImg() { return curRival ? curRival.img : null; }
  function rivals() { return RIVALS; }

  return { run, sign, victoryImgTag, hasImg, pawsCanvas, pickOpponent, oppName, oppImg, rivals, advisorChip };
})();
