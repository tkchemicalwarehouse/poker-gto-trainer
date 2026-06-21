/* =========================================================
 * cosmetics.js — コスメ(犬・テーブル・演出)の装備&適用レイヤー
 * 解放条件は既存 window.Unlocks.progress()(computeProgress) を参照。
 * 装備状態は localStorage(pgt_locker_v1)。見た目への適用は apply() に集約。
 * 中身(犬種・色の数・条件)は後から CATALOG に足すだけで増える。
 * 詳細設計: docs/cosmetics-design.md
 * ========================================================= */
"use strict";

const Cosmetics = (() => {
  const KEY = "pgt_locker_v1";

  // 進捗(既存の computeProgress)。未ロード時は空。
  const P = () => (window.Unlocks && window.Unlocks.progress ? window.Unlocks.progress() : {});

  // カタログ: 各カテゴリの先頭=既定(cond:常時true)。cond(progress)→解放、goal=未解放ヒント。
  const CATALOG = {
    // 仲間(プレイヤーキャラ)。先頭=既定。img=カットイン/優勝用、runPal=走りドット絵の配色、chip=true でアドバイスボタンに画像表示。
    dogs: [
      { id: "jack",    name: "ジャックコギ",       icon: "🐕", img: "img/dogs/jack-corgi.webp", line: "いざ、勝負。", runPal: { O: "#d98e4a", W: "#fdf6ec", M: "#c0246b" }, cond: () => true,        goal: "最初の相棒" },
      { id: "cat",     name: "トリックキャット",   icon: "🐱", img: "img/dogs/trickcat.webp",  chip: true, runPal: { O: "#9c5a2e", W: "#dca878", M: "#6e3a1f" }, cond: p => p.wins >= 10,  goal: "通算10勝で仲間に" },
      { id: "bulldog", name: "ガチホ・ブル",       icon: "🐶", img: "img/rivals/bulldog.webp", chip: true, runPal: { O: "#4a6a8a", W: "#cdd8e4", M: "#243a52" }, cond: p => p.wins >= 20,  goal: "通算20勝で仲間に" },
      { id: "owl",     name: "オール・オウル",     icon: "🦉", img: "img/rivals/owl.webp",     chip: true, runPal: { O: "#4a4a52", W: "#c0c4c8", M: "#2a8f6a" }, cond: p => p.wins >= 30,  goal: "通算30勝で仲間に" },
      { id: "shark",   name: "オーシャンキング",   icon: "🦈", img: "img/rivals/shark.webp",   chip: true, runPal: { O: "#6a7a8a", W: "#d0d8e0", M: "#2a5ea8" }, cond: p => p.wins >= 40,  goal: "通算40勝で仲間に" },
      { id: "tiger",   name: "ゴールデンタイガー", icon: "🐯", img: "img/rivals/tiger.webp",   chip: true, runPal: { O: "#c89a2f", W: "#f0d98a", M: "#c0392b" }, cond: p => p.wins >= 65,  goal: "通算65勝で仲間に" },
      { id: "lion",    name: "シルバーライオン",   icon: "🦁", img: "img/rivals/lion.webp",    chip: true, runPal: { O: "#9aa0a6", W: "#e2e4e8", M: "#c89a2f" }, cond: p => p.wins >= 90,  goal: "通算90勝で仲間に" },
      { id: "bear",    name: "アイスベア",         icon: "🐻", img: "img/rivals/bear.webp",    chip: true, runPal: { O: "#6a8aa8", W: "#dde8f0", M: "#2a5a8a" }, cond: p => p.wins >= 115, goal: "通算115勝で仲間に" },
      { id: "unicorn", name: "レインボーユニコーン", icon: "🦄", img: "img/rivals/unicorn.webp", chip: true, runPal: { O: "#d8c0a0", W: "#ffffff", M: "#a06cff" }, cond: p => p.wins >= 140, goal: "通算140勝で仲間に" },
    ],
    tables: [
      { id: "classic",  name: "クラシック",       icon: "🟢", cond: () => true,           goal: "既定" },
      { id: "emerald",  name: "エメラルド",       icon: "💚", cond: p => p.tourneys >= 10, goal: "通算10回挑戦で解放" },
      { id: "sapphire", name: "サファイア",       icon: "🔵", cond: p => p.wins >= 1,      goal: "初優勝で解放" },
      { id: "luxe",     name: "ラグジュアリー",   icon: "👑", cond: p => p.wins >= 3,      goal: "通算3回優勝で解放" },
    ],
    fx: [
      { id: "standard", name: "スタンダード",     icon: "✨", cond: () => true,           goal: "既定" },
      { id: "min",      name: "演出ひかえめ",     icon: "🌙", cond: () => true,           goal: "いつでも選択可(酔い/省電力対策)" },
      { id: "luxe",     name: "ラグジュアリー演出", icon: "🎆", cond: p => p.wins >= 5,    goal: "通算5回優勝で解放" },
    ],
  };

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { } }

  function item(cat, id) { return (CATALOG[cat] || []).find(x => x.id === id); }
  function isUnlocked(cat, id) {
    const it = item(cat, id); if (!it) return false;
    try { return !!it.cond(P()); } catch (e) { return false; }
  }
  function unlockedList(cat) { return (CATALOG[cat] || []).filter(x => isUnlocked(cat, x.id)).map(x => x.id); }
  function allDogsUnlocked() { return CATALOG.dogs.every(d => isUnlocked("dogs", d.id)); }

  // 装備中ID(未解放/未設定なら既定にフォールバック)
  function equippedId(cat) {
    const def = CATALOG[cat][0].id;
    const l = load();
    const id = (l.equipped && l.equipped[cat]) || def;
    return isUnlocked(cat, id) ? id : def;
  }

  function equip(cat, id) {
    if (!isUnlocked(cat, id)) return false;
    const l = load(); l.equipped = l.equipped || {}; l.equipped[cat] = id; save(l);
    apply();
    return true;
  }

  // 装備中コスメを見た目に適用(唯一の適用口)。#tableの .ft は触らない。
  function apply() {
    const t = document.getElementById("table");
    if (t) {
      t.classList.remove("theme-classic", "theme-emerald", "theme-sapphire", "theme-luxe");
      t.classList.add("theme-" + equippedId("tables"));
    }
    if (typeof Mascot !== "undefined" && Mascot.setSkin) Mascot.setSkin(equippedId("dogs"));
    if (document.body) document.body.dataset.fx = equippedId("fx");
  }

  // 前回スナップショットと比較し、新たに解放されたコスメを返す(初回はベースライン化し空配列)
  function newlyUnlocked() {
    const l = load();
    const init = !l.seen;
    const seen = l.seen || {};
    const fresh = [];
    for (const cat of Object.keys(CATALOG)) {
      seen[cat] = seen[cat] || [];
      for (const it of CATALOG[cat]) {
        if (isUnlocked(cat, it.id) && seen[cat].indexOf(it.id) === -1) {
          seen[cat].push(it.id);
          if (!init) fresh.push({ cat: cat, name: it.name, icon: it.icon });
        }
      }
    }
    l.seen = seen; save(l);
    return fresh;
  }

  function equippedDog() { return item("dogs", equippedId("dogs")) || CATALOG.dogs[0]; }

  return { CATALOG, isUnlocked, unlockedList, allDogsUnlocked, equip, equippedId, equippedDog, apply, newlyUnlocked, progress: P };
})();
