# GTO Odyssey — コスメ(報酬)システム 全体設計

> 月¥200サブスク・ゲーム内課金なし。継続動機は「強くなる」だけでなく **集める/育てる(キャラ・テーブル・演出)** で作る = 雀魂(ジャンたま)型のリテンション設計。
> 本書は (A)全体設計 (B)初回実装スコープ (C)役割分担 をまとめた単一の正本。色数・犬種数などの“中身の量”は後から追加する前提で、**仕組み(器)を先に固める**。

---

## A. 製品方針

- **課金**: 月¥200サブスクのみ。pay-to-win なし・コスメのガチャ/直販なし。
- **継続の核**: ①GTO上達(実用) ②コレクション(犬・テーブル・演出の解放) ③分散の体感。
- **解放の通貨は「お金」ではなく「プレイ実績」**。条件達成 → 解放 → 装備、のループ。
- 解放演出は派手に(達成の快感)。普段の盤面はオーソドックス、報酬で華やかさを足していく。

---

## B. コスメは3カテゴリ

| カテゴリ | 中身 | 既存資産 | 切替の仕組み |
|---|---|---|---|
| **テーブル(Table)** | フェルト色・レール・金ライン・外周グロー | ✅ CSS変数化済み(`#table` の `--felt-*`/`--rail`/`--pinline`/`--rail-glow`) | `#table` に `theme-xxx` クラス1個 |
| **演出(FX)** | カットイン・紙吹雪・チップ/カード演出の“強度” | 一部実装(優勝紙吹雪・マスコット走り・効果音) | `body[data-fx="min|standard|luxe"]` |
| **キャラ(Dog)** | マスコット犬。home常駐・AA走り・BLIND UP旗・勝利・(将来)座席アバター | ✅ ピクセル描画基盤(`mascot.js`の `Mascot`/`Scene`、コーギー"KIM") | `Mascot.setSkin(dogId)` |

3カテゴリとも **「装備中ID」を1つ持ち、起動時に適用するだけ**。報酬解放は「解放済みリストにIDを足す」だけで、見た目側は無改修。

---

## C. データ構造(器)

### C-1. コスメ・カタログ(静的データ / `js/cosmetics.js`)
```js
const COSMETICS = {
  tables: [
    { id:"classic",  name:"クラシック", tier:0, unlock:{type:"default"} },
    { id:"emerald",  name:"エメラルド", tier:1, unlock:{type:"tournaments", n:10} },
    { id:"sapphire", name:"サファイア", tier:1, unlock:{type:"wins", n:1} },
    { id:"luxe",     name:"ラグジュアリー", tier:3, unlock:{type:"allDogs"} },
  ],
  fx: [
    { id:"standard", name:"スタンダード", tier:0, unlock:{type:"default"} },
    { id:"luxe",     name:"ラグジュアリー", tier:2, unlock:{type:"wins", n:5} },
    // min(演出オフ)はアクセシビリティ用に常時選択可
  ],
  dogs: [
    { id:"mutt",    name:"雑種(あいぼう)", tier:0, unlock:{type:"default"} },
    { id:"shiba",   name:"柴犬",   tier:1, unlock:{type:"tournaments", n:5} },
    { id:"corgi",   name:"コーギー(KIM)", tier:1, unlock:{type:"wins", n:1} },
    { id:"bulldog", name:"ブルドッグ", tier:2, unlock:{type:"ftReach", n:10} },
    { id:"husky",   name:"ハスキー", tier:2, unlock:{type:"gtoAcc", pct:85 } },
    // …犬種は後から追加(数値・条件は仮)
  ],
};
```
- `unlock.type` は **既存の成績データ(`loadRecord()`)に紐づく述語**。実際の数値・種類は後決め。
- `tier` は解放難度の目安(コレクション画面の並び/見せ方用)。

### C-2. 所持/装備プロフィール(`localStorage`: `gto_locker`)
```js
{
  unlocked: { tables:["classic"], fx:["standard"], dogs:["mutt"] },
  equipped: { table:"classic", fx:"standard", dog:"mutt" },
}
```

### C-3. 適用フック(`applyCosmetics()`)
起動時・装備変更時に呼ぶ唯一の適用口:
```js
function applyCosmetics() {
  const eq = Locker.equipped;
  table.className = "..." + " theme-" + eq.table;   // フェルト
  document.body.dataset.fx = eq.fx;                  // 演出強度
  Mascot.setSkin(eq.dog);                            // 犬
}
```

### C-4. 解放評価(`evaluateUnlocks()`)
トーナメント終了時などに成績を見て新規解放を判定 → 解放済みに追加 → **解放演出**(後述)。
```js
// 例: 既存statsから導出
tournaments = rec.tournaments.length
wins        = rec.tournaments.filter(t=>t.result==="win").length
ftReach     = rec.tournaments.filter(t=>t.ft).length        // 要: FT到達フラグ記録
gtoAcc      = ok/decisions*100
```
> 解放条件の**最終的な数値・バランス・課金状態(サブスク有効か)との連動**はメイン開発側で確定。設計側(本タスク)は述語の“型”と評価フックまでを用意。

---

## D. 解放(報酬)体験 — ジャンたま型

- **達成の瞬間が主役**: トーナメント終了画面/ホーム復帰時に「🎉 新しい仲間/テーブルを解放!」モーダル + 効果音 + 当該犬/卓のプレビュー。
- **コレクション画面(犬舎 / Kennel)**: 新メニュー。所持済みは装備切替、未所持は**シルエット＋解放条件**を表示(「あと優勝1回」等)→ 次の目標が見える=継続動機。
- カテゴリタブ: 🐕 犬 / 🟢 テーブル / ✨ 演出。
- **装備プレビュー**: 選ぶとホームの対決シーン/卓スウォッチに即反映。

---

## E. 犬キャラ設計(中核)

### E-1. コンセプト
- **スタートは雑種(mutt)** = 「あいぼう」。プレイヤーの最初の相棒。
- 条件クリアごとに**犬種が解放**され、装備して使える(柴・コーギー・ブルドッグ・ハスキー…数は後決め)。
- **既存のコーギー"KIM"は解放犬種の1つ**として自然に内包。
- **上位報酬=全犬解放**: 達成すると特別挙動。例) **AAが配られると犬群(全解放犬)がぞろぞろ走り抜ける**(通常は装備中の1匹)。

### E-2. 犬の“出番”(露出ポイント)
| 場面 | 既存 | 犬スキン適用 |
|---|---|---|
| ホーム常駐 | Scene(対決シーン) | 装備犬がちょこんと座る/ぴょこぴょこ |
| AA配牌 | `Mascot.run({callout})` | 装備犬が走る / 全開放時は**犬群** |
| BLIND UP | `Mascot.run({flagText})` | 装備犬が旗を持って走る |
| 優勝演出 | トロフィー+紙吹雪 | 装備犬が万歳/ジャンプ |
| (将来)座席アバター | — | 各席に犬の顔ピクセルを表示 |

### E-3. 技術: マスコットのスキン化
- 現状 `mascot.js` は単一犬(KIM)の `PALETTE`+`MAP`(22×20)を `pixelCanvas` で描画。
- **`DOG_SKINS = { mutt:{palette,map}, shiba:{...}, corgi:{KIMの既存}, ... }`** に拡張し、`Mascot.setSkin(id)` で現行スキンを差し替え。`buildEl/run/bunnyWalk` はスキン参照に変更。
- 犬群: `Mascot.runPack(ids[])` = 複数スキンを時間差で走らせる(既存`run`の多重化)。
- 1犬種=ドットマップ1枚(+必要なら走り/勝利の差分1〜2枚)。**追加コストが小さい**のが利点。

---

## F. 演出(FX)階層
- `data-fx="min"`: 演出最小(酔い/低スペック配慮・アクセシビリティ)。常時選択可。
- `data-fx="standard"`: 既定。基本の走り/紙吹雪/効果音。
- `data-fx="luxe"`: 報酬。**カットイン**(勝負所で犬の大ポートレート+セリフ)、紙吹雪増量、チップ/カード演出強化、AA犬群など。
- デモ画面(①)は `luxe` + 全解放犬 + Luxeテーブルを固定でフル表示。

---

## G. 実装ずみ(2026-06-14時点・本書の前提)
- 名称 **GTO Odyssey**(ロゴ`GTOdyssey`)、タグライン「次は、飛ばない。」、表紙=モダンプレミアム。
- 全画面プレミアム・パス(成績/講座/弱点/シミュ/遊び方/モーダル/ゲーム周辺)。
- プレイテーブル質感格上げ + **フェルトのテーマ変数化**(classic既定 / emerald / sapphire / luxe)。
- プレイ微修正(カードのスーツ1個化+数字拡大、席チップ非表示、勝率%/WIN-LOSEを枠上へ)。

---

## H. 初回実装スコープ(次に作る分) — “器”を動かす最小セット
中身(犬種・色の数)は後追加。まず仕組みを通す。**2026-06-14 に1〜7を実装・検証済み(8は任意/未着手)。**

- [x] **1. データ層**: `js/cosmetics.js`(`Cosmetics`: CATALOG犬/卓/演出 + cond述語) + `Locker`(localStorage `pgt_locker_v1` 装備状態) + `Cosmetics.apply()`(唯一の適用口)。解放状態は既存 `window.Unlocks.progress()` を参照して算出。
- [x] **2. マスコットのスキン化**: `mascot.js` に `DOG_SKINS`(mutt/corgi/shiba パレット着せ替え) + `Mascot.setSkin()` / `getSkin()` / `runPack()`。**既定=mutt(雑種)**、KIMは`corgi`として温存。柴を解放見本に。※現状は同一体型のパレット差分。犬種固有マップは将来 `DOG_SKINS[id].map` で差し込み可。
- [x] **3. テーブル装備連動**: `apply()` が装備テーマを `#table` に付与(`.ft`は非干渉)。
- [x] **4. FXフラグ**: `body[data-fx="standard|min|luxe"]`。min はモーション抑制(suit-float/mascot-run/confetti/trophy-rays非表示・home-bg等アニメ停止)。
- [x] **5. コレクション画面(犬舎)**: 既存「🎁 実績・解放」画面(`screen-unlocks`/`renderUnlocks`)を拡張。`cosmeticsSectionHTML()`+`wireCollection()` で 犬/卓/演出を表示、所持=タップ装備(装備中ハイライト)、未所持=🔒シルエット+解放条件。
- [x] **6. 解放告知**: トーナメント終了HTML `freshUnlockHTML()` に `Cosmetics.newlyUnlocked()` を合流(初回はベースライン化、以降は新規解放のみ告知+効果音)。解放条件評価は cond(progress) でライブ算出。
- [x] **7. 上位報酬**: `checkAARun` で全犬解放時 `Mascot.runPack(unlockedDogs)` = **AA→犬群**。
- [ ] **8. デモモード(任意・後でも可)**: luxe固定の見せ画面(①)。

> 「解放→装備→見た目変化→次の目標が見える」ループが端から端まで稼働。以降は **CATALOG に犬種/色/条件をデータ追加するだけ**で増やせる。犬種固有のドット絵(雑種以外の専用マップ)・カットイン演出・座席アバターは今後の“中身”追加。

---

## I. 役割分担
- **デザイン(本タスク)**: コスメの見た目(ドット犬・テーマ・カットイン)、コレクション画面UI、適用フック、述語の“型”と評価フックの骨組み、解放演出。
- **メイン開発**: 解放条件の最終数値/バランス、サブスク有効判定との連動、アカウント跨ぎ同期(将来クラウド保存)、課金基盤。
- 連結点は明確: `Locker`(所持/装備データ)と `COSMETICS`(条件述語) の2ファイル。

---

## J. 拡張余地(将来)
- 座席アバター(対戦相手も犬に)、犬ごとのボイス/セリフ、季節テーマ、実績バッジ、フレンド対戦での見せ合い、クラウド同期。
