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
    dogs: [
      { id: "jack",  name: "ジャックコギ", icon: "🐕", img: "img/dogs/jack-corgi.png", line: "いざ、勝負。", cond: () => true, goal: "最初の相棒" },
      { id: "shiba", name: "柴犬",         icon: "🦊", cond: p => p.tourneys >= 3, goal: "3回トーナメントに挑戦で解放" },
      { id: "corgi", name: "コーギー",     icon: "🐶", cond: p => p.wins >= 1,     goal: "初優勝で解放" },
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
