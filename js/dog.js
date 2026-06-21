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

  /* ---- 走りドット絵: キャラ種別ごとの専用スプライト(横向き・右へ走る) ----
   * K=輪郭 O=主毛色 W=白/明色 M=差し色(マント/たてがみ/縞) N=鼻(濃) P=舌/肉球(桃)
   * 体型(シルエット)は種別ごとに固定。配色は cosmetics の runPal(O/W/M) を流用。 */
  var BASE_PAL = { K: "#241a14", N: "#15100a", P: "#f0807e" };
  function palFor() {
    var rp = (typeof Cosmetics !== "undefined" && Cosmetics.equippedDog && (Cosmetics.equippedDog() || {}).runPal) || null;
    rp = rp || { O: "#d98e4a", W: "#fdf6ec", M: "#c0246b" };
    return { K: BASE_PAL.K, N: BASE_PAL.N, P: BASE_PAL.P, O: rp.O, W: rp.W, M: rp.M };
  }

  // 犬(コーギー/ブル)
  var DOG_UP = [
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
  var DOG_LA = ["..KO.......KO.....", "..KW.......KW.....", "..KK.......KK....."];
  var DOG_LB = ["....KO...KO.......", "....KW...KW.......", "....KK...KK......."];

  // 猫(トリックキャット/タイガー) — 尖り耳・しなやか胴・尻尾
  var CAT_UP = [
    "...............K..",
    ".K............KOK.",
    ".KMK....KKKKKKOOK.",
    ".KMOKKKKOOOOOWOOK.",
    ".KOOOOOOOOOOOOONK.",
    ".KOOOOOOOOOOOOOPK.",
    ".KOOOOOOOOOOOOOK..",
    ".KWWWWWWWWWWWWK..."
  ];
  var CAT_LA = ["..KO........KO....", "..KK........KK...."];
  var CAT_LB = ["....KO....KO......", "....KK....KK......"];

  // ライオン — 猫体型＋たてがみ(M)
  var LION_UP = [
    "..............K...",
    ".K.........MMMMK..",
    ".K..K.....MMMOOMK.",
    ".KOOKKKKKMMOOWOOK.",
    ".KOOOOOOOMMOOOONK.",
    ".KOOOOOOOMMOOOOPK.",
    ".KOOOOOOOOMMOOK...",
    ".KWWWWWWWWWWWK...."
  ];

  // ふくろう(オウル) — 丸胴・羽角(M)・大きな目
  var OWL_UP = [
    "..K.......K..",
    ".KMK.....KMK.",
    ".KOOKKKKKOOK.",
    ".KOWOKKKOWOK.",
    ".KOOONKNOOK..",
    ".KOOOOOOOOK..",
    ".KOWWWWWWOK..",
    ".KOWWWWWWOK..",
    "..KOOOOOOK..."
  ];
  var OWL_LA = ["..KOK.KOK....", "..K.K.K.K...."];
  var OWL_LB = ["...KOKOK.....", "...K.K.K....."];

  // サメ(オーシャンキング) — 背びれ・尾びれ・歯
  var SHARK_UP = [
    "....K..........",
    "...KKK.KKKK....",
    ".KMKOKKOOOOK...",
    ".KMOOOOOOOOOK..",
    ".KOOOOOOOWWNK..",
    ".KOOOOOOWWWWK..",
    ".KOOOOOOOOOK...",
    "...KKOOKK......"
  ];
  var SHARK_LA = ["....KOOK.......", ".....KK........"];
  var SHARK_LB = [".....KOOK......", "......KK......."];

  // 熊(アイスベア) — ずんぐり・丸耳
  var BEAR_UP = [
    "..KK.....KK..",
    ".KOOK...KOOK.",
    ".KOOOKKKOOOK.",
    ".KOOOOOOOWOK.",
    ".KOOOOOOOONK.",
    ".KOWWWWWWOOK.",
    ".KOWWWWWWWOK.",
    ".KOOOOOOOOOK."
  ];
  var BEAR_LA = ["..KOOK..KOOK.", "..KKKK..KKKK."];
  var BEAR_LB = [".KOOK....KOOK", ".KKKK....KKKK"];

  // ユニコーン(馬) — 角(W)・たてがみ(M)・蹄
  var HORSE_UP = [
    ".............WK..",
    "............WWK..",
    ".M.........KOOK..",
    ".MM.......KOOWOK.",
    ".MMOKKKKKKOOOONK.",
    ".MOOOOOOOOOOOOK..",
    ".KOOOOOOOOOOOK...",
    ".KOOOOOOOOOOK...."
  ];
  var HORSE_LA = ["..KO......KO....", "..KW......KW....", "..KK......KK...."];
  var HORSE_LB = ["...KO...KO......", "...KW...KW......", "...KK...KK......"];

  var FAM = {
    dog:   { body: DOG_UP,   la: DOG_LA,   lb: DOG_LB },
    cat:   { body: CAT_UP,   la: CAT_LA,   lb: CAT_LB },
    lion:  { body: LION_UP,  la: CAT_LA,   lb: CAT_LB },
    owl:   { body: OWL_UP,   la: OWL_LA,   lb: OWL_LB },
    shark: { body: SHARK_UP, la: SHARK_LA, lb: SHARK_LB },
    bear:  { body: BEAR_UP,  la: BEAR_LA,  lb: BEAR_LB },
    horse: { body: HORSE_UP, la: HORSE_LA, lb: HORSE_LB }
  };

  // 前足(HU POV前景の手) 種別
  var PAW_MAMMAL = [".KK.KK.KK.", "KOOKOOKOOK", "KOOOOOOOOK", "KOWWWWWWOK", "KOOOOOOOOK", ".KOOOOOOK.", "..KKKKKK.."];
  var PAW_TALON  = [".K.K.K.K..", ".KOKOKOK..", ".KOOOOOK..", ".KOOOOOK..", "..KOOOK...", "..KKKKK..."];
  var PAW_FIN    = ["...KK....", "..KOOK...", ".KOOOOK..", "KOOOOOOK.", "KOOOOOOK.", ".KOOOOK..", "..KKKK..."];
  var PAW_HOOF   = [".KOOK.", ".KOOK.", ".KOOK.", ".KWWK.", ".KWWK.", ".KKKK."];
  function dbl(map, gap) { gap = gap || "...."; return map.map(function (r) { return r + gap + r; }); }
  var PAWS = {
    mammal: dbl(PAW_MAMMAL),
    talon:  dbl(PAW_TALON, "..."),
    fin:    dbl(PAW_FIN, "..."),
    hoof:   dbl(PAW_HOOF, "...")
  };

  // 装備キャラ → 種別マッピング
  var SPECIES = {
    jack:    { fam: "dog",   paw: "mammal" },
    bulldog: { fam: "dog",   paw: "mammal" },
    cat:     { fam: "cat",   paw: "mammal" },
    tiger:   { fam: "cat",   paw: "mammal" },
    lion:    { fam: "lion",  paw: "mammal" },
    owl:     { fam: "owl",   paw: "talon" },
    shark:   { fam: "shark", paw: "fin" },
    bear:    { fam: "bear",  paw: "mammal" },
    unicorn: { fam: "horse", paw: "hoof" }
  };
  function speciesId() { var d = eq(); return (d && SPECIES[d.id]) ? d.id : "jack"; }
  function famNow() { return FAM[SPECIES[speciesId()].fam] || FAM.dog; }

  // 脚2コマを切り替える走りスプライト(canvas2枚をトグル) — 装備キャラの種別で体型が変わる
  function charSprite(scale, speedMs) {
    if (typeof Mascot === "undefined" || !Mascot.pixelCanvas) return null;
    var PAL = palFor();
    var fam = famNow();
    var FA = fam.body.concat(fam.la), FB = fam.body.concat(fam.lb);
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
    var box = charSprite(scaleNow(), 110);
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
    var box = charSprite(scaleNow(), 220);
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

  /* ---- HU POV用 ドット絵: 前景の手(装備キャラの種別ごと: 肉球/talon/fin/hoof) ---- */
  function pawsCanvas(scale) {
    if (typeof Mascot === "undefined" || !Mascot.pixelCanvas) return null;
    var map = PAWS[SPECIES[speciesId()].paw] || PAWS.mammal;
    return Mascot.pixelCanvas(map, palFor(), scale || 10, false);
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

  return { run, sign, victoryImgTag, hasImg, pawsCanvas, pickOpponent, oppName, oppImg, rivals, advisorChip, charSprite };
})();
