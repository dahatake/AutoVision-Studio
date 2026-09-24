# Gate 2 主 run の分割判定のやり直し（PRE-04 の一部）

- 規約: `tools/atg/skill/references/planning.md` §1.1（ATG 0.2.3、`EXT-ATG` 完了。確認記録 `work/20260924-0620-EXT-ATG-Confirmation.md`）
- 対象: Gate 2 正本 `work/202609232120-RemainTaskExecutionPlan.md` §6.1 で `SPLIT_REQUIRED` とした 6 行（G2T-11、G2X-01a〜c、G2A-03、G2A-04、G2F-01m、G2F-01a2）
- 行番号は 2026-09-24 07:10 時点のファイル内容に対するもの（1 始まり、両端を含む）。ノード開始時にファイルの行数が下表と違う場合は、そのノードを進めずに判定をやり直す（§1.1）。

## 1. 判定

| ノード | 500 行超の file（行数） | 読む行範囲（編集箇所を含む） | 範囲の合計 | 編集箇所 | 参照ファイル数 | 判定 |
|---|---|---|---:|---|---:|---|
| G2T-11 | `spikes/models/detection_checkpoint_parity.py`（605） | `spikes/models/detection_checkpoint_parity.py:1-104`、`:188-298`、`:382-603` | 437 | `run_transfer`（382-441）と `main`（442-603）の引数処理 | 6 | `PROCEED` |
| G2X-01a | `src/main/samples/sample-assets.test.ts`（1021） | `src/main/samples/sample-assets.test.ts:1-153`（import・fixture・setup。最初の `it` の本文より前） | 153 | なし（診断のみ） | 3 | `PROCEED` |
| G2X-01b | `src/main/data/reference-source.test.ts`（1731） | `src/main/data/reference-source.test.ts:1-422`（import・fixture・`describe` の行。最初の `it` の本文より前） | 422 | なし（診断のみ） | 3 | `PROCEED` |
| G2X-01c | `src/main/data/copy-source.test.ts`（1066）、`src/main/data/copy-source.ts`（706） | `src/main/data/copy-source.test.ts:1-114`、`:162-197`（以前に失敗が観測された test「uses bounded reads and completes short writes…」。現時点では単独実行で再現していない）。`src/main/data/copy-source.ts:1-64`、`:205-220`（`assertProject`）、`:377-396`（`hashOpenedFile`）、`:495-706`（`copySourceFile`） | 150 / 312 | なし（診断のみ） | 4（上記 2 件、`src/main/projects/project-directory.ts` 238 行、本 file） | `PROCEED` |
| G2A-03 | `scripts/models/manifest-schema.test.mjs`（626） | `scripts/models/manifest-schema.test.mjs:1-300` | 300 | `EXPECTED_APPROVED_ENTRIES`（210） | 5 | `PROCEED` |
| G2A-04 | `src/renderer/features/settings/SettingsPage.test.tsx`（617） | `src/renderer/features/settings/SettingsPage.test.tsx:1-91`、`:165-377` | 304 | 「ライセンス・情報」の test（206〜377 の中に追加） | 6 | `PROCEED` |
| G2F-01m | `scripts/models/manifest-schema.test.mjs`（626） | `scripts/models/manifest-schema.test.mjs:1-300` | 300 | 212〜218 の既存 test の書き換えと、その直後への test 追加 | 6 | `PROCEED` |
| G2F-01a2 | `docs/implementation-plan.md`（1869） | `docs/implementation-plan.md:1255-1270` | 16 | Gate 2 状態行（1262） | 3 | `PROCEED` |

参照ファイル数には本 file（各ノードの `contract.inputs` に入る）を含む。どのノードも 9 件に達しないため、判定は変わらない（planning.md §1）。

G2X-01a / 01b / 01c では、5 回の実行で失敗が再現し、その原因を調べるために失敗した test の本文（上表の範囲の外）を読む必要が出た場合は、§1.1 に従ってそのノードを進めず、その test の行範囲を加えて判定をやり直す。

### 1.1 G2X-01a の判定のやり直し（2026-09-24）

- 契機: G2X-01a の敵対的レビュー（rubber-duck agent `e69861f1`）の spot-check（`vitest.cmd run src\main\samples\sample-assets.test.ts` を 1 回）が exit 1 で、4 件が 30 秒の timeout で失敗した（`sample-assets.test.ts:343-351` の parameterized な integrity test 3 件 `license` / `attribution` / `coco`、`:353-355` の image-size の `longer`）。これらは上表の範囲 `1-153` の外にある。
- 判定: `src/main/samples/sample-assets.test.ts`（1021 行。行数に変化なし）の読む範囲を `:1-153`、`:340-360` とする。範囲の合計は 174 行で 500 行以下、参照ファイル数は 3 のまま。判定は `PROCEED`。

## 2. 正本との関係（逸脱の記録）

- 正本 §7.0 は「§6.1 を判定し直し、本計画とノード一覧を更新してから主 run の graph を作る」としている。一方、2400 計画 §16 は本 session による正本の変更を禁止し、§17.7 は正本の hash が PRE-01 の値から変わった場合に Gate 2 の新しい node を起動せず PRE-00 からやり直すとしている。PRE-00 は利用者本人の確認が必要で、利用者は「C: 私が後で行います」と回答している。
- このため、正本とノード一覧は変更しない。判定のやり直しの結果は本 file に記録し、主 run の graph の各ノードの `contract.inputs` に本 file を加えて行範囲を束縛する。正本 §6.1 の表の「判定」列は正本の上では `SPLIT_REQUIRED` のままであり、この点は正本 §7.0 からの逸脱として Baseline の記録と TERM-01 に書く。
- ノード ID の集合は変えない（ノード一覧 §1 の 44 件のまま）。
- **実行主体の運用判断（所有者の判断ではない）:** 正本 §7.0 どおりに正本を更新すると PRE-00（利用者本人の確認）が必要になり、主 run を起動できない。この扱いを利用者に `ask_user` で問い合わせた（2026-09-24）が、回答は「The user is not available to answer your question. Choose a pragmatic option best aligned with the context of the request.」だった。利用者の指示「D: 実施してください」（Gate 2 を実施する）と「不明点はデフォルトのプランを採用してください」に沿う実務的な選択として、正本を変更せずに本 file を束縛して主 run を起動する。正本 §7.0 と 2400 計画 PRE-00 からの逸脱であり、所有者がこの扱いを承認したことを意味しない。利用者が後で PRE-00 を行い、正本の更新を求める場合は、主 run の結果をそのまま Gate 2 の通過根拠にせず、やり直しの要否を判断する。

## 3. 敵対的レビュー（独立 reviewer、agent `0df40b05`）

- 1 回目: blocking 2（§2 の逸脱の扱い、G2X-01c の `hashOpenedFile` の範囲漏れ）、minor 3（参照ファイル数、01a/01b の境界の記述、01c の「既知の失敗」の記述）。→ 全件を反映した。§2 は利用者への問い合わせ（回答なし）と実行主体の運用判断として明記した。
- 2 回目: 本 file は指摘なし。主 run の graph・verify script・G2D-11 の判断記録について blocking 5（inputs の漏れ、reader / writer の競合、`Recorded` の exit code、DoD より弱い検査、G2D-11 の「用意の完了」の過大な記録）。→ 全件を反映した（graph の lock key、verify の強化、G2D-11 を `選択: 未確定` に修正）。
- 3 回目: blocking 3（EXT-41 / EXT-X1 の inputs に別計画の実行記録がない、G2Q-01CM / DM の画像の書込みが未宣言、G2Q-01C / D の検査が数値ごとの根拠を束縛しない）。→ 全件を反映した（実行記録 `work/20260924-0730-EXT-<ID>-ExecutionRecord.md` を inputs へ追加。画像は件数が計画確定まで不明のため `vendor/models/_spike/assist/images-<task>/` を write_set に置き、各画像の hash は出力の manifest で束縛し、verify で全 `image` が同 directory 配下であることを検査。数値行ごとに直後の根拠 / 「所有者の判断事項」を検査し、数値案が必須の 4 見出しは数値行 1 件以上を要求）。fixture による検査で、`Sections` が 1 件のとき配列が文字列へ展開され `$s[0]` が先頭 1 文字になる不具合を検出し、`@(...)` で修正した。
- 4 回目: blocking 1（`GoldsetCheck` が path の検査より先に画像を読む）。→ path の検査（`images-<task>/` 配下、`..` と絶対 path の拒否、`resolve()` 後の包含）を hash の計算より前へ移した。fixture 6 件（正常 0、`..`・他 task・直下・絶対 path 2 件はすべて 1）で確認した。
- 5 回目: blocking 0。PRE-04 を完了とする。
- G2D-11 が成立しないことに伴う注記: 各ノードの `NPM12` の検査で使う npm 12.0.0 は、権限者の指示「A: インストールしてください。」で導入したものであり、導入方法が組織承認済みであることは未確認である（`docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-11.md`）。
