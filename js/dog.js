/* =========================================================
 * dog.js — 装備中の犬(画像)を各場面で動かす
 * 出番: カットイン / 走り抜け / 看板ウォーク(バブル・FT) / 優勝
 * 画像が無い犬(ドットスキン)は Mascot にフォールバック。
 * ========================================================= */
"use strict";

const Dog = (() => {
  function eq() { return (typeof Cosmetics !== "undefined" && Cosmetics.equippedDog) ? Cosmetics.equippedDog() : null; }
  function src() { var d = eq(); return d && d.img ? d.img : null; }
  function hasImg() { return !!src(); }

  // 画面を走り抜ける(旗・吹き出し対応)
  function run(opts) {
    opts = opts || {};
    var s = src();
    if (!s) { if (typeof Mascot !== "undefined" && Mascot.run) Mascot.run(opts); return; }
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
    var img = document.createElement("img"); img.src = s; img.alt = ""; img.className = "dog-sprite dog-gallop";
    wrap.appendChild(img);
    document.body.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 4300);
  }

  // 看板ウォーク(BUBBLE / FINAL TABLE)
  function sign(lines) {
    var s = src();
    if (!s) { if (typeof Mascot !== "undefined" && Mascot.bunnyWalk) Mascot.bunnyWalk(lines); return; }
    var wrap = document.createElement("div"); wrap.className = "dog-run dog-walk";
    var sg = document.createElement("div"); sg.className = "bunny-sign";
    sg.innerHTML = lines.map(function (t, i) { return '<div class="bs-line bs-' + i + '">' + t + '</div>'; }).join("");
    wrap.appendChild(sg);
    var img = document.createElement("img"); img.src = s; img.alt = ""; img.className = "dog-sprite dog-sway";
    wrap.appendChild(img);
    document.body.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 7600);
  }

  // カットイン(大きく登場+名前+セリフ+SE)
  var cutBusy = false;
  function cutin(opts) {
    opts = opts || {};
    var d = eq(), s = src();
    if (!s || cutBusy) return;
    cutBusy = true;
    var ov = document.createElement("div"); ov.className = "dog-cutin";
    ov.innerHTML =
      '<img src="' + s + '" class="dog-cutin-img" alt="">' +
      '<div class="dog-cutin-plate"><div class="dog-cutin-name">' + (opts.name || (d && d.name) || "") + '</div>' +
      '<div class="dog-cutin-line">' + (opts.line || (d && d.line) || "") + '</div></div>';
    document.body.appendChild(ov);
    if (typeof Sfx !== "undefined" && Sfx.play) { try { Sfx.play("win"); } catch (e) { } }
    setTimeout(function () {
      ov.classList.add("out");
      setTimeout(function () { ov.remove(); cutBusy = false; }, 400);
    }, opts.hold || 1900);
  }

  // 優勝モーダル用の犬画像要素(無ければnull)
  function victoryImgTag() {
    var s = src();
    return s ? '<img src="' + s + '" class="dog-victory" alt="">' : "";
  }

  return { run, sign, cutin, victoryImgTag, hasImg };
})();
