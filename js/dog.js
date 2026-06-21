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

  // 兎(汎用補充キャラ用) — 長い耳
  var RAB_UP = [
    "...K.......K.....",
    "..KOK.....KOK....",
    "..KOK.....KOK....",
    "..KOKKKKKKKOOK...",
    ".KOOOOOOOOOOWOK..",
    ".KOOOOOOOOOOONK..",
    ".KOOOOOOOOOOOKK..",
    ".KWWWWWWWWWWWK..."
  ];
  var RAB_LA = ["..KO........KO....", "..KK........KK...."];
  var RAB_LB = ["....KO....KO......", "....KK....KK......"];

  // 狐 — 尖り耳・スリム胴・白い先の房尾(尾先=W)
  var FOX_UP = [
    "............K.K..",
    ".W.........KOKOK.",
    ".WW.......KOOOOK.",
    ".WMWKKKKKKOOOWOK.",
    ".WMOOOOOOOOOOONK.",
    ".KMOOOOOOOOOOOPK.",
    ".KOOOOOOOOOOOK...",
    ".KWWWWWWWWWWK...."
  ];
  var FOX_LA = ["..KO........KO....", "..KK........KK...."];
  var FOX_LB = ["....KO....KO......", "....KK....KK......"];

  // 狼 — 大柄・尖り耳・背に暗いサドル(M)・房尾
  var WOLF_UP = [
    "...........K.K...",
    "..K.......KOKOK..",
    ".KOK.....KOOOOOK.",
    ".KOOKKKKKMMOOWOK.",
    ".KOOOOOMMMMOOONK.",
    ".KOOOOOOMMMOOOPK.",
    ".KOOOOOOOOOOOOK..",
    ".KWWWWWWWWWWWK..."
  ];
  var WOLF_LA = ["..KO.........KO...", "..KK.........KK..."];
  var WOLF_LB = ["....KO.....KO.....", "....KK.....KK....."];

  var FAM = {
    dog:    { body: DOG_UP,   la: DOG_LA,   lb: DOG_LB },
    cat:    { body: CAT_UP,   la: CAT_LA,   lb: CAT_LB },
    lion:   { body: LION_UP,  la: CAT_LA,   lb: CAT_LB },
    owl:    { body: OWL_UP,   la: OWL_LA,   lb: OWL_LB },
    shark:  { body: SHARK_UP, la: SHARK_LA, lb: SHARK_LB },
    bear:   { body: BEAR_UP,  la: BEAR_LA,  lb: BEAR_LB },
    horse:  { body: HORSE_UP, la: HORSE_LA, lb: HORSE_LB },
    rabbit: { body: RAB_UP,   la: RAB_LA,   lb: RAB_LB },
    fox:    { body: FOX_UP,   la: FOX_LA,   lb: FOX_LB },
    wolf:   { body: WOLF_UP,  la: WOLF_LA,  lb: WOLF_LB }
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
  /* ---- ボット名簿 ----
   * CAST = 最初から卓に座る8キャラ(1文字動物名・専用イラスト/ドット絵あり)
   * GENERIC = 補充用(動物1文字・イラスト無し→ドット絵で表示)。fam/palでドット絵を着色 */
  var CAST = [
    { id: "cat",     name: "猫" },
    { id: "bulldog", name: "犬" },
    { id: "tiger",   name: "虎" },
    { id: "lion",    name: "獅" },
    { id: "shark",   name: "鮫" },
    { id: "owl",     name: "梟" },
    { id: "bear",    name: "熊" },
    { id: "unicorn", name: "馬" }
  ];
  // 補充動物(37種)。主要8キャラと合わせて計45種。fam=ドット絵の体型, pal=配色
  var GENERIC = [
    { id: "g_usagi",   name: "兎", fam: "rabbit", pal: { O: "#e6e6ee", W: "#ffffff", M: "#f0a6c4" } },
    { id: "g_kitsune", name: "狐", fam: "fox",    pal: { O: "#e07a34", W: "#fff0e0", M: "#c85a22" } },
    { id: "g_ookami",  name: "狼", fam: "wolf",   pal: { O: "#8a8f98", W: "#dde2e8", M: "#3a3f48" } },
    { id: "g_tanuki",  name: "狸", fam: "wolf",   pal: { O: "#9c7a4e", W: "#e8d8b8", M: "#4a3420" } },
    { id: "g_koma",    name: "狛", fam: "wolf",   pal: { O: "#b8bcc4", W: "#eef0f4", M: "#6a6e76" } },
    { id: "g_shika",   name: "鹿", fam: "horse",  pal: { O: "#b07a44", W: "#f0e0c4", M: "#6e4420" } },
    { id: "g_roba",    name: "驢", fam: "horse",  pal: { O: "#9a9aa0", W: "#d8d8de", M: "#5c5c64" } },
    { id: "g_rakuda",  name: "駱", fam: "horse",  pal: { O: "#cda86a", W: "#efe0c0", M: "#8a6a38" } },
    { id: "g_koma2",   name: "駒", fam: "horse",  pal: { O: "#6e4a30", W: "#e8d0b0", M: "#3a2614" } },
    { id: "g_kirin",   name: "麒", fam: "horse",  pal: { O: "#e8c860", W: "#fff4c0", M: "#c08a20" } },
    { id: "g_buta",    name: "豚", fam: "bear",   pal: { O: "#e8a0b2", W: "#ffd8e2", M: "#c06078" } },
    { id: "g_hitsuji", name: "羊", fam: "bear",   pal: { O: "#ece6da", W: "#ffffff", M: "#c8b6a0" } },
    { id: "g_ushi",    name: "牛", fam: "bear",   pal: { O: "#5a5a60", W: "#ffffff", M: "#1c1c22" } },
    { id: "g_inoshi",  name: "猪", fam: "bear",   pal: { O: "#6e5238", W: "#c8a878", M: "#3a2a18" } },
    { id: "g_zou",     name: "象", fam: "bear",   pal: { O: "#9aa0a8", W: "#cfd4da", M: "#5c626a" } },
    { id: "g_sai",     name: "犀", fam: "bear",   pal: { O: "#8a8e94", W: "#c0c4ca", M: "#4a4e54" } },
    { id: "g_kame",    name: "亀", fam: "bear",   pal: { O: "#4c8a5c", W: "#c2e0c2", M: "#2a5a3c" } },
    { id: "g_baku",    name: "獏", fam: "bear",   pal: { O: "#3a3a44", W: "#e8e8ee", M: "#1a1a22" } },
    { id: "g_saru",    name: "猿", fam: "cat",    pal: { O: "#9a6a3c", W: "#e2c4a2", M: "#5a3a1c" } },
    { id: "g_nezumi",  name: "鼠", fam: "cat",    pal: { O: "#9a9aa2", W: "#dadae0", M: "#5c5c66" } },
    { id: "g_kaeru",   name: "蛙", fam: "cat",    pal: { O: "#4caa52", W: "#c2f0c2", M: "#2a7a32" } },
    { id: "g_hyou",    name: "豹", fam: "cat",    pal: { O: "#d8a838", W: "#f0dca0", M: "#3a2a14" } },
    { id: "g_ten",     name: "貂", fam: "cat",    pal: { O: "#a4683a", W: "#e0c0a0", M: "#5a3418" } },
    { id: "g_tsubame", name: "燕", fam: "owl",    pal: { O: "#2a3a52", W: "#e8e0d0", M: "#c0392b" } },
    { id: "g_washi",   name: "鷲", fam: "owl",    pal: { O: "#6a4a2c", W: "#e2d2b2", M: "#3a2a16" } },
    { id: "g_taka",    name: "鷹", fam: "owl",    pal: { O: "#7a5630", W: "#e8d8b8", M: "#4a3018" } },
    { id: "g_kamo",    name: "鴨", fam: "owl",    pal: { O: "#3a6a4a", W: "#d8e4c0", M: "#2a4a32" } },
    { id: "g_niwatori",name: "鶏", fam: "owl",    pal: { O: "#d8d2c4", W: "#ffffff", M: "#d4373e" } },
    { id: "g_karasu",  name: "鴉", fam: "owl",    pal: { O: "#2a2a32", W: "#5a5a64", M: "#14141a" } },
    { id: "g_hato",    name: "鳩", fam: "owl",    pal: { O: "#9a9aa4", W: "#d8d8e0", M: "#6a6a74" } },
    { id: "g_suzume",  name: "雀", fam: "owl",    pal: { O: "#a08050", W: "#e8d8b8", M: "#5a4428" } },
    { id: "g_tsuru",   name: "鶴", fam: "owl",    pal: { O: "#eef0f4", W: "#ffffff", M: "#d4373e" } },
    { id: "g_sagi",    name: "鷺", fam: "owl",    pal: { O: "#e4e8ee", W: "#ffffff", M: "#9aa0a8" } },
    { id: "g_kujira",  name: "鯨", fam: "shark",  pal: { O: "#5a6a8a", W: "#c0c8d8", M: "#2a3a5a" } },
    { id: "g_koi",     name: "鯉", fam: "shark",  pal: { O: "#d87a30", W: "#f0d0a0", M: "#a04a10" } },
    { id: "g_maguro",  name: "鮪", fam: "shark",  pal: { O: "#3a6a9a", W: "#c0d8e8", M: "#1a3a5a" } },
    { id: "g_wani",    name: "鰐", fam: "shark",  pal: { O: "#5a7a4a", W: "#c0d8a0", M: "#2a4a2a" } },
    { id: "g_shachi",  name: "鯱", fam: "shark",  pal: { O: "#2a2a30", W: "#ffffff", M: "#14141a" } }
  ];
  // 全45種(主要8 + 補充37)を1つのプールにして、トーナメントごとにシャッフル → 均等な出現率
  function buildPool() {
    return CAST.map(function (c) { return { id: c.id, name: c.name, kind: "char" }; })
      .concat(GENERIC.map(function (g) { return { id: g.id, name: g.name, kind: "generic", fam: g.fam, pal: g.pal }; }));
  }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  var POOL_N = CAST.length + GENERIC.length; // 45
  var bag = [];
  // i番目のボットの正体。i%45==0で再シャッフル(重複なしで一巡)、一巡したら②付き
  function botIdentity(i) {
    if (i % POOL_N === 0) bag = shuffle(buildPool());
    var e = bag[i % POOL_N] || buildPool()[0];
    var rep = Math.floor(i / POOL_N);
    return { id: e.id, name: e.name + (rep > 0 ? "②" : ""), kind: e.kind, fam: e.fam, pal: e.pal };
  }

  // キャラ(ボット)の配色・体型を解決
  function imgForId(id) {
    if (typeof Cosmetics === "undefined" || !Cosmetics.CATALOG) return null;
    var d = Cosmetics.CATALOG.dogs.find(function (x) { return x.id === id; });
    return d ? d.img : null;
  }
  function palForChar(ch) {
    if (ch && ch.pal) return { K: BASE_PAL.K, N: BASE_PAL.N, P: BASE_PAL.P, O: ch.pal.O, W: ch.pal.W, M: ch.pal.M };
    if (ch && ch.id && typeof Cosmetics !== "undefined" && Cosmetics.CATALOG) {
      var d = Cosmetics.CATALOG.dogs.find(function (x) { return x.id === ch.id; });
      if (d && d.runPal) return { K: BASE_PAL.K, N: BASE_PAL.N, P: BASE_PAL.P, O: d.runPal.O, W: d.runPal.W, M: d.runPal.M };
    }
    return palFor();
  }
  function famForChar(ch) {
    var key = (ch && ch.fam) || (ch && ch.id && SPECIES[ch.id] && SPECIES[ch.id].fam) || "dog";
    return FAM[key] || FAM.dog;
  }

  /* ---- HUの相手 = 実際にヘッズアップまで残ったボットのキャラ ---- */
  var curOpp = { id: "cat", name: "猫", kind: "char" };
  function setOpponent(ch) { if (ch) curOpp = ch; }
  function oppId() { return curOpp ? curOpp.id : null; }
  function pickOpponent() { curOpp = { id: CAST[0].id, name: CAST[0].name, kind: "char" }; return curOpp; } // 後方互換(通常はsetOpponentを使用)
  function oppName() { return curOpp ? curOpp.name : "RIVAL"; }
  function oppImg() { return (curOpp && curOpp.kind === "char") ? imgForId(curOpp.id) : null; } // イラストがある時だけ。generic は null
  // generic(イラスト無し)用: 相手のドット絵(静止1コマ・左向き)
  function oppSprite(scale) {
    if (typeof Mascot === "undefined" || !Mascot.pixelCanvas || !curOpp) return null;
    var fam = famForChar(curOpp);
    return Mascot.pixelCanvas(fam.body.concat(fam.la), palForChar(curOpp), scale || 8, true);
  }

  /* ---- 戦利品図鑑(コレクション)用のチップ画像。HU相手とは別管理 ---- */
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
  function rivals() { return RIVALS; }

  return { run, sign, victoryImgTag, hasImg, pawsCanvas, botIdentity, setOpponent, oppId, pickOpponent, oppName, oppImg, oppSprite, rivals, advisorChip, charSprite };
})();
