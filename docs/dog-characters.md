# GTO Odyssey — 犬キャラクター設定書 & 生成プロンプト集

> アートスタイル＝**本格イラスト(じゃんたま調)**、制作＝**画像生成AI**(本書のプロンプトで生成→PNG/透過をアプリに同梱)。
> 命名・キャラは**「プレイヤーの“型”の型パロディ＋架空名」**(実在個人を名指し・そっくりにしない=パブリシティ権回避)。
> 出番＝**①カットイン ②走り抜け ③優勝トロフィー ④バブル看板 ⑤FT看板**(常駐・自席アバターは無し)。

---

## 1. ハイブリッド方式 — 素材は犬1種につき「イラスト顔1枚＋ドット走り(私が作成)」
**カットイン＝華やかイラスト／走り・看板・優勝＝ドット絵で脚を動かす**(VN・ガチャ定番の「立ち絵＝イラスト/動く小キャラ＝ドット」)。

| 素材 | 作る人 | 内容 | 使う出番 |
|---|---|---|---|
| **A. 顔イラスト(バスト)** 透過・**枠/文字なし** | 画像生成AI | じゃんたま級・かわいい寄り | ①カットイン |
| **B. ドット走りスプライト** 横向き・2〜3コマ(脚アニメ) | **私(コード)** | レトロ可愛い・脚パラパラ | ②走り ③優勝 ④バブル看板 ⑤FT看板 |
| 共有プロップ(犬非依存・各1個) | — | 🏆トロフィー / 看板(BUBBLE・FINAL TABLE=既存UI流用) | ③④⑤ |

**出番→素材マッピング**
- ①カットイン: **A(イラスト)** を端から大スライドイン＋ポップ＋名前/セリフ/SE
- ②走り抜け: **B(ドット)** を横スライド＋脚コマ切替＋上下バウンド(AA・ブラインドアップ・**オールイン逆転確定**)
- ③優勝: **B(ドット)** が跳ねて ＋ 🏆トロフィーを前面に
- ④バブル看板 / ⑤FT看板: **B(ドット)** ＋ 看板UI(既存 `bunny-sign` 流用、絵だけ装備犬Bへ差替)
- ※「イラスト顔」と「ドット走り」は**同じ犬として色・小物・耳の特徴を合わせる**(見分け一貫性)

---

## 2. ロースター(型パロディ＋架空名)
※名前・セリフは叩き台。実在個人の名指し・そっくりは避ける方針。

| # | 名前(架空) | 犬種 | “型”(アーキタイプ) | 性格 | 小物 | カットイン台詞(案) | 解放目安 |
|---|---|---|---|---|---|---|---|
| 1 | **ハチ** | 雑種ミックス | 新人グラインダー | 素直・ひたむき | 安サンバイザー | 「次は、飛ばない。」 | 既定 |
| 2 | **コギ** | コーギー | 恐れ知らずのアグロ | 不敵・強気 | サングラス＋蝶ネクタイ | 「ぜんぶ、見えてる。」 | 初優勝 |
| 3 | **ロウ翁** | 柴 | テキサスの老ガンマン | 渋い・動じない | カウボーイハット＋葉巻 | 「若いの、急ぐな。」 | 数回プレイ |
| 4 | **ブリザード** | ハスキー | 氷の読み師 | 無表情・冷静 | 青いサングラス | 「…降りときな。」 | 一致率◎ |
| 5 | **番長** | ブルドッグ | 強気な天才肌 | 口は悪いが強い | 金歯＋葉巻 | 「俺のナッツ、超えてみろ。」 | 累計ハンド |
| 6 | **ソロバン** | ダックス | 計算で粘る長期戦 | 理詰め・冷静 | 丸メガネ | 「EVは、嘘をつかない。」 | FT到達 |
| 7 | **チコ** | チワワ | 極小ハイパーLAG | 小さくて狂暴 | でかバイザー | 「ぜんぶオールイン!!」 | 連勝など |
| 8 | **マダム** | プードル | 優雅なラスボス | 余裕・挑発 | モノクル＋扇 | 「あら、もう店じまい?」 | 上位(全犬手前) |

- **全犬解放の特典**: AA等で**犬群が走る**(`runPack`)。
- 既存ホームの「**KIM DWAN / NGUYEN**」は同じ理由(実在もじり)で**架空名へ要変更**(例: コギ 等に置換)。

---

## 3. アートディレクション(全犬で統一)
コレクション物は“バラバラに見えない”のが命。全犬で次を固定：
- **キャラ**: **全キャラ“かわいい寄り”で統一**。ちびキャラ体型(2.5〜3頭身)・丸い大きな頭・うるうるの大きな瞳・丸みのあるシルエット。クールな性格の犬(ブリザード/マダム等)も「かわいいけど一癖」の範囲で。四足の実犬ベース、擬人化しすぎない。
- **画風**: モバイルガチャのキー絵風／柔らかいセルシェード／太く綺麗な線／鮮やかな彩度／**特大の瞳・ぷにっと丸い造形＝かわいさ最優先**。
- **背景**: **完全透過**(合成のため必須)。被写体は中央・余白少なめ。
- **小物**: 表で指定したものを必ず装備(キャラの識別子)。
- **一貫性のコツ**: 同じツール・同じスタイル文・できれば**1体目を“スタイル参照”にして残りを生成**。解像度はポートレート1024²、全身1024²目安。

### プロンプト雛形(英語推奨・スロットを差替)
**共通スタイル(先頭に固定・全キャラ かわいい寄り)**
```
super cute chibi [BREED] dog mascot character, adorable kawaii style,
big round head, huge sparkly expressive eyes, soft rounded shapes,
2.5-head chibi proportions, mobile gacha game key art, soft cel shading,
clean bold lineart, vibrant colors, poker theme, wearing [ACCESSORY],
[EXPRESSION/PERSONA mood], 2D anime illustration, high detail,
centered, transparent background
```
**末尾(ネガティブ)**
```
--no text, watermark, real person likeness, photorealistic, background, multiple subjects, playing cards, holding cards
```
※「poker theme」はトランプを呼びやすい。**ポーカー味は「visor＋チップ」で出し、カードはネガティブで排除**(カードはゲーム側で描画するため不要)。
- ポートレート(A)用に追記: `bust shot, facing viewer, dramatic close-up`
- 全身(B)用に追記: `full body, side 3/4 view, standing slightly proud pose`

### スターター「ハチ」記入例
**A. ポートレート(かわいい寄り・カード無し)**
```
super cute chibi mixed-breed mongrel puppy mascot, adorable kawaii style,
big round head, huge sparkly honest eyes, soft rounded shapes,
scruffy brown and cream fur, one floppy dark ear one perky ear,
hopeful cheerful rookie expression, wearing an orange poker sun visor,
poker chips floating, small empty paws, bust shot facing viewer,
mobile gacha game key art, soft cel shading, clean bold lineart, vibrant colors,
2D anime illustration, high detail, centered, transparent background
--no playing cards, holding cards, poker cards, text, watermark, real person, photorealistic, background
```
**B. 全身(かわいい寄り・カード無し)**
```
super cute chibi mixed-breed mongrel puppy mascot, adorable kawaii style,
big round head, huge sparkly eyes, soft rounded shapes, 2.5-head chibi proportions,
scruffy brown and cream fur, one floppy dark ear one perky ear,
wearing an orange poker sun visor, full body, standing slightly proud happy pose,
small empty paws, mobile gacha game key art, soft cel shading, clean bold lineart,
vibrant colors, 2D anime illustration, high detail, centered, transparent background
--no playing cards, holding cards, poker cards, text, watermark, real person, photorealistic, background
```

---

## 4. 実装メモ(アート完成後に着手)
- `cosmetics.js` の犬定義を `{ id, name, persona, line, portrait:"img/dogs/xxx_face.png", body:"img/dogs/xxx_body.png" }` に拡張。
- 描画は**ピクセルcanvas→`<img>`(透過PNG)** に切替。`Mascot.run`/`runPack` は body 画像をスライド。
- **新規: カットイン演出** `Mascot.cutin(id, line)` = ポートレートを端から大表示＋台詞＋SE。
- **置換**: `bunnyWalk`(看板) → 装備犬 body ＋ 看板UI流用。優勝モーダルの🏆絵文字 → 装備犬 body ＋ トロフィー画像。
- 画像は `img/dogs/` に同梱(透過PNG/WebP)。ゼロ依存は外れるが軽量・キャッシュ可。
- まず**スターター「ハチ」1種で縦の1本**(カットイン・走り・優勝・看板)を通してから量産。

---

## ヘッズアップ(HU)対決演出 — 一人称(POV)構図
HU(残り2人)突入で専用の対決画面に切替。横並びは縦スマホで窮屈なので**奥行きのPOV構図**にする。

**構図(上→下)**
- 上: **相手犬がテーブルの向こう側から“顔＋手(前足)”を出す**(全身着席でなく卓縁から覗く=ラウンダーズ風)。手札(カードバック)を持つ。相手スタック表示。
- 右上: **ディーラー犬**(クルピエ)を小さく常駐。
- 中央: 場札(コミュニティ)＋**チップstackを場に積む**(9人卓では消したチップをHUは空くので復活: 自分側/相手側/ポット中央の物理チップ)。
- 手前下: **自分=コーギーの手だけ**が下から伸びて手札を持つ。YOUスタック。
- 最下部: アクション(フォールド/コール/レイズ)。

**突入演出(VSスプラッシュ)**: 相手が卓の向こうから登場→チップが積まれる→自分の手が上がる→中央「VS / 決着戦」+両者名→フラッシュしてPOVの場に着地。自キャラ(犬)を大きく見せるのはこの瞬間(プレイ中は手だけなので)。

**必要アート**: ①自分の手(前景・コーギーの手/装備犬色) ②相手犬(卓の向こうから顔+手, ランダム表示なので複数) ③ディーラー犬(クルピエ)。実カード/チップ額は可変なのでゲーム側描画、手・相手・ディーラーは静止画。

**実装フック**: state.fieldLeft===2(HU成立)で専用レイアウト/スプラッシュへ。既存HU機構(Ranges.huOpen等)はそのまま。規模大なのでアート用意後に着手。

---

## HUライバル＝キャラ化(方向B・2026-06-17決定)
チップ(メダル)を「対戦相手の体」に使うと“生き物 vs 物体”でしっくり来ない。→ **相手=動物キャラ(顔+手の生き物)**、**チップ=そのキャラを倒すと貰える勲章/トロフィー(図鑑・報酬)**に役割変更。チップ8枚は報酬側で全活用。

**必要アート: 各ライバルのキャラ絵**(チップの世界観を引き継ぐ)。POV用に「卓の向こうから顔+手を出し、手札を持つ」構図・透過・スタイル統一。

**共通スタイル(生成プロンプト先頭)**
```
cute but cool mobile game character, [ANIMAL] gambler, anthropomorphic,
leaning forward over a green poker table toward the viewer, both hands/paws on the table edge
holding two face-down playing cards, facing camera, confident smug expression,
soft cel shading, clean bold lineart, vibrant, high detail, 2D anime illustration,
transparent background
--no text, watermark, real person, photorealistic, background, full body, poker chip, coin
```
**8ライバルのペルソナ(チップ設定を継承)**
- cat: スチームパンクの山高帽ギャンブラー猫(片眼鏡)「SCRATCH & WIN」
- bulldog: 鋲付き首輪のタフな番犬「STEADY HOLD」/どっしり
- owl: 緑の眼の賢い眼鏡ディーラー梟「ALL'S REVEALED」
- shark: スーツを着た不敵なサメ「OCEAN'S KING」
- tiger: 王冠の黄金トラ・威厳「GOLDEN TIGER」
- lion: 王冠の銀のライオン・気高い「SILVER LION」
- bear: 氷の鎧の白熊・冷酷「ICE BEAR」
- unicorn: 虹と金の優雅なユニコーン・ラスボス「RAINBOW UNICORN」

**記入例(shark)**
```
cute but cool mobile game character, shark gambler in a business suit, anthropomorphic,
leaning forward over a green poker table toward the viewer, both fins on the table edge
holding two face-down playing cards, facing camera, confident smug grin, sharp teeth,
soft cel shading, clean bold lineart, vibrant, high detail, 2D anime illustration,
transparent background
--no text, watermark, real person, photorealistic, background, full body, poker chip, coin
```

**実装(アート到着後)**: rivalに char 画像を追加→HUのVS演出/POVの相手は char を表示。チップは「ライバル」改め「トロフィー/戦利品」図鑑＋撃破報酬に。当面の相手placeholderはチップ or ドット犬のまま。スタイルは「かわいい寄り/クール寄り」要調整(まず1体生成して方向確認)。
