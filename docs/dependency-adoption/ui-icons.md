# Fluent System Icons — M1用8 SVGのC9採用記録

| 項目 | 内容 |
|---|---|
| 調査・記録日 | 2026-09-07（JST）。原本取得終了のUTC日時は§2 |
| 対象 | UIR-006。M1の5作業タブ＋Project一覧・設定・戻るに使う8図形 |
| 方針判断 | 利用者によるDU-12=Aの条件付き採用判断。外部法務意見・同梱・出荷の承認ではない |
| 技術状態 | **親担当の原bytes検証結果を記録：10/10件のSHA-256・byteSize・Git blob照合PASS、SVG構文・許可要素／属性検査8/8件PASS** |
| 完了判定 | **UIR-006完了**。10原本の照合・文書検証後、別担当の独立レビューで指摘なし。後続UIR-011/015/016も完了、UIR-017は技術PASS・本人確認待ち。製品配布条件は未完了 |
| 区分・出力範囲 | C9、MIT。採用調査時の出力は本ファイルだけ。後続の同梱・表示実績は§5/6へ追記し、原本hashは保持する |

## 1. 採用範囲と固定取得元

- 根拠はUI/UX改善計画 §3.1/3.4・UIR-006/011、[依存ポリシー](../dependency-policy.md) §1/2/3/7/9/10、[開発規約](../../CONTRIBUTING.md) §2/5。2026-09-07の利用者によるデフォルトA承認を条件付き方針判断とする。MITは既存allowlist内であり、新しい例外ライセンス手続きは作らない。
- 公式repositoryは[microsoft/fluentui-system-icons](https://github.com/microsoft/fluentui-system-icons)、固定revisionは[`5bae3fb7771054c252a54b1d9210e9c03439fa1b`](https://github.com/microsoft/fluentui-system-icons/commit/5bae3fb7771054c252a54b1d9210e9c03439fa1b)。GitHubのauthor/committer日時はともに`2026-09-04T08:13:57Z`で、各SVGの更新日時ではない。
- **Regular・20×20の8図形だけ**を既存React/CSS/native SVGで使う。独自描画・絵文字・icon fontより出典と見た目を揃えられる小さな部分集合を選ぶ。24px、Filled/Color、予備図形は取得・同梱しない。
- 取得先は§3/4の固定HTTPS raw URL計10個だけ。`main`、浮動tag、CDN、全体ZIP、別ミラーへ切り替えない。原図の`assets/`と加工済みpackageを区別し、版識別子にはcommitを使う。
- `@fluentui/react-icons`、`@fluentui/svg-icons`、Fluent UI kit、sprite、font、loader、SVGOを追加しない。C1/C2 package・lockの変更はない。
- 本文の名称・revision・用途・ライセンス・取得元・hash表を、既存ポリシー§7の**C9 asset manifest／inventory**とする。別の汎用manifest・生成frameworkは不要。最終SBOMへの反映は§6の別確認とする。

## 2. 原本取得・検証結果（親担当の実測報告）

- 親担当がNode **24.19**の組込み`fetch`で10固定raw URLをメモリ内取得。全10件で`redirect: 'error'`、HTTP `200`、非空かつ`64 KiB未満`のbodyを確認した。
- **取得終了：`2026-09-06T18:45:49.368Z`（UTC）＝`2026-09-07T03:45:49.368+09:00`（JST）**。UTCの取得日を9月7日とは記録しない。
- SHA-256とbyteSizeの対象は`response.arrayBuffer()`由来の**原ファイルbody bytes**。表示テキスト・DOM・Markdown・改行正規化／再エンコード後の値ではなく、HTTP headerや圧縮転送streamでもない。
- 同じbodyに`blob `＋10進byteSize＋NULのGit object headerを前置してGit blob SHA-1も計算。親担当が現行台帳の期待Git blob値と**全10行の対応を別途照合し、10/10件完全一致PASS**。以下の40桁値はこの期待値であり、原SHA-256とは別物。
- JSDOMでSVG構文を解析し、許可要素を`svg`・`path`、許可属性を`width`・`height`・`viewBox`・`fill`・`xmlns`・`d`だけに限定した検査は**8/8件PASS**。全8件は20×20、`viewBox="0 0 20 20"`、root `fill="none"`、単一`path`の`fill="#212121"`。
- script・イベント属性・外部参照・埋込画像・animation等は許可しない。`xmlns="http://www.w3.org/2000/svg"`は名前空間識別子であって通信先ではない。この原本検査は製品UIの動作試験ではない。
- 初回のブラウザ補助取得は`Protocol error (Storage.getCookies): Method not found: Storage.getCookies`で失敗しhash未取得だったが、**後続のNode取得成功で原bytes検証待ちは解消**した。
- 採用調査の編集担当は上記の親担当報告を台帳へ反映しただけで、再取得・再計算・ターミナル実行はしていない。その後のローカル同梱はUIR-011として§5へ別記する。

## 3. C9 asset inventory：8図形

用途は同梱する8図形の割当であり、対応する業務機能の完成を示さない。全行に同revisionのroot MIT LICENSEと§4の通知方針を適用する。画面枠への接続実績は§6で分離する。

| キー・日本語表示／用途 | 上流の正確な相対path | 固定raw URL | Git blob SHA-1（期待値・照合PASS） | 原bytes SHA-256 | byteSize |
|---|---|---|---|---|---|
| `projects`・Project一覧：共通入口 | `assets/Folder/SVG/ic_fluent_folder_20_regular.svg` | [raw](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/5bae3fb7771054c252a54b1d9210e9c03439fa1b/assets/Folder/SVG/ic_fluent_folder_20_regular.svg) | `45fefb47fedb175e2b1eb796758493405d41f944` | `7fb7fb2567a518b9e09997c9ddd4588a78c9e02fd1c3e2bb714efa7798a2e560` | 648 |
| `import`・取り込む：作業タブ1 | `assets/Folder Open/SVG/ic_fluent_folder_open_20_regular.svg` | [raw](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/5bae3fb7771054c252a54b1d9210e9c03439fa1b/assets/Folder%20Open/SVG/ic_fluent_folder_open_20_regular.svg) | `adb015687ef69bdecab90183fc6659734dbdc048` | `c5f8b2db9af20a454c1f05ce6eda4b21c99f1b8677b14b6d7d07d5817140a487` | 1222 |
| `annotations`・教師データ：作業タブ2 | `assets/Image Edit/SVG/ic_fluent_image_edit_20_regular.svg` | [raw](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/5bae3fb7771054c252a54b1d9210e9c03439fa1b/assets/Image%20Edit/SVG/ic_fluent_image_edit_20_regular.svg) | `40752fa08ee27f178e48d852ff2cfc077762ea58` | `9133ac4216dd3ed92bb257faae9ea1683568bdee5aecb354a33aa9033e08cf44` | 1505 |
| `training`・学習：作業タブ3 | `assets/Play/SVG/ic_fluent_play_20_regular.svg` | [raw](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/5bae3fb7771054c252a54b1d9210e9c03439fa1b/assets/Play/SVG/ic_fluent_play_20_regular.svg) | `05a0ec3f98ee72567238bfeee1ffa980553d8b0b` | `0666c1378f63d4d5c32f91b4107086bc14799dff306027976be591da8843ae45` | 491 |
| `reports`・結果：作業タブ4 | `assets/Data Line/SVG/ic_fluent_data_line_20_regular.svg` | [raw](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/5bae3fb7771054c252a54b1d9210e9c03439fa1b/assets/Data%20Line/SVG/ic_fluent_data_line_20_regular.svg) | `fbf3b57d9825cac3991940bc26256cca7ec0aff6` | `8fe32a2b247e2025586dff6d8785557eebd0dd285aaf3ddc9dabd5e2ff4e3156` | 1100 |
| `camera`・カメラで試す：作業タブ5 | `assets/Camera/SVG/ic_fluent_camera_20_regular.svg` | [raw](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/5bae3fb7771054c252a54b1d9210e9c03439fa1b/assets/Camera/SVG/ic_fluent_camera_20_regular.svg) | `9a02bd8b182958d6ad04feef991396c20fcea5a4` | `950376e33dbf494c11adb3c13776ae620959c720a071ff6358ba4e7260a0a7ff` | 1255 |
| `settings`・設定：共通入口 | `assets/Settings/SVG/ic_fluent_settings_20_regular.svg` | [raw](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/5bae3fb7771054c252a54b1d9210e9c03439fa1b/assets/Settings/SVG/ic_fluent_settings_20_regular.svg) | `54752c20fe6c380b1f2b5bcbef8738295e2cc1d0` | `ac5bdb808bed91dc8c0b6f346e7a0a1ee1901fc4b50f5641987498a65e200685` | 3314 |
| `back`・戻る：設定等から閲覧復帰 | `assets/Arrow Left/SVG/ic_fluent_arrow_left_20_regular.svg` | [raw](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/5bae3fb7771054c252a54b1d9210e9c03439fa1b/assets/Arrow%20Left/SVG/ic_fluent_arrow_left_20_regular.svg) | `32618604e0ece64de2688e01ce14c2959a25c0c3` | `db86c904f14b430f6100b1c6bfe7e9b44fdc0ab375bcbbf9c74d371c87389009` | 706 |

結果用の正式名は**Data Line**（`data_line_chart`ではない）。Playは「学習」の画面入口でjobを開始せず、Cameraもタブ閲覧で権限・streamを開始しない。Arrow Leftは閲覧復帰でありundo/cancelではない。

## 4. LICENSE／NOTICEと製品ロゴの除外

| 上流path | 固定raw URL | Git blob SHA-1（期待値・照合PASS） | 原bytes SHA-256 | byteSize |
|---|---|---|---|---|
| `LICENSE` | [raw LICENSE](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/5bae3fb7771054c252a54b1d9210e9c03439fa1b/LICENSE) | `bc9c36b28f467f7006c4e5f1be4ca0a1a0b895f3` | `69bc45dc42b9acb96a69823adbc6ae538374e3c0bde169b855b32c48eaaef52f` | 1078 |
| `NOTICE` | [raw NOTICE](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/5bae3fb7771054c252a54b1d9210e9c03439fa1b/NOTICE) | `c67aa7958e681d0fd131167c0b47992cee30dbdb` | `2fb367a84df52c8b6f8401119708014b327f595554d41712d7407151c9ce73ef` | 3911 |

- MIT LICENSEの著作権行は**`Copyright (c) 2020 Microsoft Corporation`**。商用利用・改変・再配布等を許可し、著作権・許諾表示の保持を条件とする。全文を無保証・責任制限まで保持し、著作権年を閲覧年に変更しない。研究限定・非商用限定・copyleftの要求はない。
- **root NOTICEは全文を保持**する。冒頭の説明と「Provided for Informational Purposes Only」を省略せず、`replace`（2020 Alessandro Maclaine）、`avocado`（2020 Alex Lockwood）、`yargs`（2020 yargs）の3項目・各MIT文面を独自要約に置き換えない。
- NOTICE中の3部品は情報提供として記載された上流ツールであり、本採用のruntime dependency追加ではない。8図形自体に追加JavaScript runtime／transitive packageは不要だが、monorepo全体を監査・配布承認したとは扱わない。
- [Fluent 2 Iconography](https://fluent2.microsoft.design/iconography)はSystem／Product launch／File typeを区別し、System IconsをMITのopen sourceと明記する。対象は汎用System Iconsの8図形だけ。
- [Microsoft Trademark and Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks)のブランド資産許諾をMITから推定しない。Microsoft／Windows／Office／Copilot等の**製品ロゴ、ブランド画像・font、製品識別ロゴへの流用は対象外**。提携・推奨・承認等を示唆しない。

## 5. UIR-011の加工・同梱実績

2026-09-07、UIR-011は次の**4ファイルだけ**を出力した。19個の対象test、型検査、原本との8本の全geometry比較が通過し、独立レビューは指摘なし。これは製品installer内のpayload検証ではない。

| 出力 | 内容・検証 |
|---|---|
| `src/renderer/components/SystemIcon.tsx` | 8図形を静的に実装する既存React/native SVG component |
| `src/renderer/components/SystemIcon.test.tsx` | 8種類の対応、geometry保持、単色継承、読み上げ重複なし・非focus、外部参照なし |
| `resources/licenses/fluent-system-icons.LICENSE.txt` | 検証した同revisionのLICENSE全文 |
| `resources/licenses/fluent-system-icons.NOTICE.txt` | 検証した同revisionのNOTICE全文 |

- `viewBox`と`path d`の数値・コマンド・順序を保持し、`path`の`#212121`だけを`currentColor`へ変更する。root `fill="none"`、表示20pxを保ち、装飾用`aria-hidden="true"`・`focusable="false"`を付ける。
- 任意SVG文字列・任意URL・動的asset registry、`dangerouslySetInnerHTML`、外部`use`、icon CDN、runtime fetchは使わない。通常build/testに原本取得を組み込まない。
- 日本語ラベル・操作名・navigation/tabs semanticsは呼出し側が持ち、装飾SVGをtab stopにしない。selected/focusを色だけに頼らない。20px図形と操作領域を区別し、32px以上／主操作約40px／coarse pointer時44px以上、contrast、light/dark、高コントラスト、200%は後続UIで検証する。
- 配布経路は**検証済み原本→選定pathのローカルcomponent＋通知→既存Renderer build→Windows最終payload**。原SVGと加工後component／bundle／payloadのhashを混同しない。通知の改行変換があれば原bytesと作業ツリー／配布bytesを分けて記録する。

作業ツリーraw bytesのSHA-256は、`SystemIcon.tsx`が`61cd3320e387f56a75ec3b94e52dbfdb813ae93311ec18b0522327ece2ada42e`、LICENSE（1099 bytes）が`9be360c19bf5502c7927a6ca365a7504b620b408cdf6e3e2413fa63a325bd381`、NOTICE（3963 bytes）が`46fc95a58b4185fd2eaa8a8ab5399c1272bcaf8ee0ce13b186cbed499485c507`。LICENSEはCRLF変換だけ、NOTICEはCRLF変換と終端改行1つの追加だけが原本との差で、全文を逐語照合した。原本hashの§3/4を書換えず、raw同一とは扱わない。

## 6. 残るレビュー・UI・配布確認

| 項目 | 状態と担当範囲 |
|---|---|
| 独立レビュー・UIR-006判定 | **完了**。2026-09-07、別担当がC9規約、必要図形、固定版、原hashと加工後hashの分離、MIT/NOTICE本文と配布境界を照合し指摘なし。文書診断0・台帳10/10照合・全文書検証も通過。後続条件は別判定 |
| ローカルコピー・加工・component test | **UIR-011完了**。§5の原本比較、19 tests、型検査、独立レビューを実施 |
| M1の通知閲覧 | **UIR-015/016完了**。設定「ライセンス・情報」でローカル2通知全文を表示。UIR-017の技術測定で100%/200%の各全文一致とkeyboard末尾到達を確認 |
| M1実表示・keyboard・読み上げ・本人確認 | **技術確認PASS、UIR-017全体は本人確認待ち**。実測28ケース/PNGと200% keyboard37観測を[実ウィンドウ記録](../../tests/manual/ui-shell-review.md)へ保存。Narrator・本人理解・全製品UIの合格へ転用しない |
| 最終SBOM・通知・Windows payload／offline | **未実施、UI・LICゲート未完了**。LIC-01で本台帳のrevision・hash・取得元・加工内容とMIT／NOTICE全文をSBOM・`THIRD_PARTY_NOTICES`へ関連付け、UIR-068の実通知表示と配布実体を別途確認する |

UIR-001の前提判定・独立レビュー・後続着手は親担当が所有する。UIR-002やmodel/sample Gateを追加前提にせず、新しい利用者判断も要求しない。図形・サイズ・revision・用途・配布主体・通知条件の変更時は該当範囲を再確認する。本記録は製品全体の依存・署名・offline検証を免除しない。

## 7. 一次資料の参照

既存調査ではGitHub Contentsで8 SVGとroot LICENSE/NOTICEの全文・blob IDを確認した。関連資料の閲覧記録日は2026-09-07（JST）。原bodyの実取得終了は§2のUTC/JST日時、commit日時は§1、著作権年は§4と区別する。

| 固定revisionの資料 | 確認範囲 |
|---|---|
| [README.md](https://github.com/microsoft/fluentui-system-icons/blob/5bae3fb7771054c252a54b1d9210e9c03439fa1b/README.md) | System Icons、Plain SVGと原図のassets directory。他プラットフォームのpackage版は採用版に流用しない |
| [packages/svg-icons/README.md](https://github.com/microsoft/fluentui-system-icons/blob/5bae3fb7771054c252a54b1d9210e9c03439fa1b/packages/svg-icons/README.md) | regular/filledの単色・currentColor継承。package/loader導入例は採用しない |
| [LICENSE本文](https://github.com/microsoft/fluentui-system-icons/blob/5bae3fb7771054c252a54b1d9210e9c03439fa1b/LICENSE) | MIT全文。原bytesの証拠は§4のraw URL・hash |
| [NOTICE本文](https://github.com/microsoft/fluentui-system-icons/blob/5bae3fb7771054c252a54b1d9210e9c03439fa1b/NOTICE) | 冒頭・3項目・各MIT全文。保持方針と原bytesの証拠は§4 |

公式repository／commitは§1、選定8 SVGの全raw URLは§3、Fluent 2／商標ガイドは§4に保持する。探索用検索結果・Webの画像表示はhash証拠に使わず、footer年を発行・更新日としない。