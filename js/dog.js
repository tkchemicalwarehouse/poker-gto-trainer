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

  // 脚2コマを切り替える走りスプライト(canvas2枚をトグル)
  function corgiSprite(scale, speedMs) {
    if (typeof Mascot === "undefined" || !Mascot.pixelCanvas) return null;
    var FA = C_UP.concat(C_LEGA), FB = C_UP.concat(C_LEGB);
    var box = document.createElement("div"); box.className = "dog-sprite-box";
    var a = Mascot.pixelCanvas(FA, CORGI_PAL, scale, false);
    var b = Mascot.pixelCanvas(FB, CORGI_PAL, scale, false);
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

  /* ---- HU POV用 ドット絵: 前景の手(コーギーの手) ---- */
  var PAWS_PAL = { K: "#2a2118", O: "#d98e4a", W: "#fdf6ec" };
  var PAW1 = [".KK.KK.KK.", "KOOKOOKOOK", "KOOOOOOOOK", "KOWWWWWWOK", "KOOOOOOOOK", ".KOOOOOOK.", "..KKKKKK.."];
  var PAWS = PAW1.map(function (r) { return r + "...." + r; });
  function pawsCanvas(scale) {
    return (typeof Mascot !== "undefined" && Mascot.pixelCanvas) ? Mascot.pixelCanvas(PAWS, PAWS_PAL, scale || 10, false) : null;
  }
  /* ---- 相手犬 10種(プレースホルダ=チビ犬マップのパレット違い。後で正式イラストに差替) ---- */
  // パレット: K=輪郭 O=毛(主) W=毛(白/差し) Y=ベスト R=蝶ネクタイ P=舌
  var OPP_DOGS = [
    { name: "シバ三郎",   pal: { K: "#2a1f14", O: "#e08a3c", W: "#fff3e2", Y: "#caa24a", R: "#c0392b", P: "#f0907e" } },
    { name: "ハスケン",   pal: { K: "#222831", O: "#7c8794", W: "#f3f6fa", Y: "#3b7dd8", R: "#1f3a66", P: "#f0907e" } },
    { name: "クロベエ",   pal: { K: "#15151c", O: "#3a3a46", W: "#caa24a", Y: "#7a2633", R: "#e8c352", P: "#f0907e" } },
    { name: "ゴル太",     pal: { K: "#3a2a14", O: "#e8b860", W: "#fff6e0", Y: "#2e7d4f", R: "#8a5a2a", P: "#f0907e" } },
    { name: "ブチ夫",     pal: { K: "#1a1a1a", O: "#eef0f2", W: "#23232c", Y: "#c0392b", R: "#222", P: "#f0907e" } },
    { name: "プー子",     pal: { K: "#3a2230", O: "#f0d0d8", W: "#fff", Y: "#a06cff", R: "#c2569d", P: "#f0907e" } },
    { name: "チワ",       pal: { K: "#2a1f14", O: "#d8a86a", W: "#fff3e2", Y: "#e0a020", R: "#c0392b", P: "#f0907e" } },
    { name: "ブル蔵",     pal: { K: "#241a12", O: "#c8956a", W: "#f3ead8", Y: "#2563ad", R: "#1f3a66", P: "#f0907e" } },
    { name: "茶々丸",     pal: { K: "#241710", O: "#9c6b3f", W: "#e8d2b0", Y: "#e67e22", R: "#7a2633", P: "#f0907e" } },
    { name: "パグ兵衛",   pal: { K: "#1a140d", O: "#d8c0a0", W: "#3a2e22", Y: "#c0392b", R: "#1a140d", P: "#f0907e" } },
  ];
  var curOpp = OPP_DOGS[0];
  function pickOpponent() {
    var i = Math.floor((typeof Math.random === "function" ? Math.random() : 0) * OPP_DOGS.length);
    curOpp = OPP_DOGS[i] || OPP_DOGS[0];
    return curOpp;
  }
  function oppName() { return curOpp ? curOpp.name : "RIVAL"; }
  function oppCanvas(scale) {
    if (typeof Mascot === "undefined" || !Mascot.pixelCanvas || !Mascot.MAP) return null;
    return Mascot.pixelCanvas(Mascot.MAP, (curOpp || OPP_DOGS[0]).pal, scale || 5, false);
  }
  // 相手の手(POVで相手側にもチビ犬色の手を出したい場合用)
  function oppPawsCanvas(scale) {
    var p = (curOpp || OPP_DOGS[0]).pal;
    return (typeof Mascot !== "undefined" && Mascot.pixelCanvas) ? Mascot.pixelCanvas(PAWS, { K: p.K, O: p.O, W: p.W }, scale || 10, false) : null;
  }

  return { run, sign, victoryImgTag, hasImg, pawsCanvas, oppCanvas, oppPawsCanvas, pickOpponent, oppName, oppDogs: OPP_DOGS };
})();
