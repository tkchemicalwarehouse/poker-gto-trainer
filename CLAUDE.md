# GTO Odyssey — プロジェクト指針

MTT中盤戦(5〜30BB)＋ヘッズアップの GTO 学習アプリ。静的 HTML/CSS/vanilla JS、GitHub Pages 公開、
将来 月¥200 サブスクで販売予定(Apple/Android ストア、ベトナム法人)。詳細は auto-memory の
`poker-gto-trainer.md` / `poker-hu-accuracy.md` を参照。

---

## 最優先: 誠実さの憲章 ★このアプリの背骨★

**なぜ最優先か:** 先生(このアプリ)の言葉に価値があるのは、**その答えが正しいから**だけ。
嘘や根拠のない断定は、ただ間違っているだけでなく、**それを信じて勉強した人を負けやすくする**。
遊んでくれた人が負けやすくなる未来は、このアプリの存在意義を真っ向から裏切る最悪の結果。
だから誠実さは「機能」ではなく**大前提**。精度・派手さ・体裁よりも常に優先する。

### 3原則(ユーザーの言葉)
1. **わからない場合は「わからない」と言う。**
2. **どちらでもよい時は「どちらでもよい」と言う。** 無差別点で無理に一手を選ばない(迷わず混合を提示するのがGTO)。
3. **毎日一歩でも真実に近づく。**

> 難しすぎて本物のソルバーでも・将来のより賢いモデルでも一意に決められないスポットは、
> その旨を正直に認め「直観を信じてよい、それもポーカー」と伝える。無理にハッキリ答えない方が誠実。

### 実装・作業でこれをどう守るか(具体ルール)
- **厳密(solved)と近似(heuristic)を区別し、近似を厳密のように見せない。**
  - 厳密: プッシュ/フォールド・オールイン・rejam(EQ169のナッシュ均衡)、自前ソルブのプリフロップ。
  - 近似: 深いスタックのオープン幅・フラットコール・ポストフロップ(本物のCFR未導入)。
- **GTO頻度や%を捏造しない。** エンジンが出せない精度を主張しない。「約」「目安」を適切に使う。
- **EVが誤差内/無差別の局面は「混合・どちらでもよい」と提示**(既存の mixed / caution 判定を活かす)。
- **Claude→ユーザーの報告も同じ基準。** できた事は事実で、できていない/未検証/テスト失敗は正直に。
  「直した」は検証してから言う。推測を確定のように書かない。
- 新機能・レンジ変更は**検証できないものを販売品に入れない**。不確かなら明示するか、見送る。

---

## 開発メモ(操作上の要点)
- **デプロイ** = `git push origin master`(GitHub Pages)。
- **作業ツリーは別の「デザインセッション」と共有**。自分の分離可能なファイルだけをコミットし、
  相手の作業中差分(犬キャラ dog.js/cosmetics.js/mascot.js, index.html 等)は触らない。
- **回帰テスト**: `node tools/validate-reference.cjs`(外部数値35件)。HU検証は `node tools/validate-hu.cjs`。
- レンジ生成: `tools/gen-*.cjs`(equity→nash→rejam→openraise)。HU研究: `tools/gen-hu.cjs`(深部は近似・本番未配線)。
- **検証カウンタは自動計測**(ホームの「累計カウンタ」): 監査/検証ツール(mega-validate / validate-reference /
  selfplay-audit / deviation-audit / extract-comments)は末尾で `tools/record-verification.cjs` を呼び、
  **実際に回した実数**を `tools/verification-log.json`(証跡)に追記 → `js/verification-auto.js` を自動再生成。
  カウンタ(`verification-ledger.js`)が手書き台帳 + 自動計測を合算。**手で数えない**(忘れ/水増し防止)。
  → 監査を回したら生成された `js/verification-auto.js` と `verification-log.json` をコミットするだけ。
  憲章遵守 = ツールが実際に数えた判断数/ハンド数/チェック数のみ。新規ツールにも `recordVerification({tool,checks,hands})` を入れる。
  手書き台帳(`verification-ledger.js` の `entries`)は「ソルバー求解(eq)」と過去の基準値用。新規ソルブ時のみ追記。
- HU精度向上フェーズ1の手順は `tools/HRC-SOLVE-SPEC.md`。
