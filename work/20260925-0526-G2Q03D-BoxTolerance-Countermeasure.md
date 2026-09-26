# G2Q-03D — 検出の box 許容差の不合格に対する対策案

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（対策の立案）。所有者の選択を得るまで、コード・記録・ATG の run は変更しない |
| 作成日時 | 2026-09-25 05:26 JST |
| 起点 | 所有者の回答（2026-09-25 05:26 JST）:「許容できません。対策案を立案してください。」。私の前回の報告（「拡大された OWL-ViT の box に px の許容差 1e-3 をそのまま適用するかどうか、所有者の判断が必要です」）への回答 |
| 解釈 | G2Q-03D が box の px 許容差だけで不合格のまま終わる現状は受け入れられず、解消策を求めている、と解釈した。許容差の値を黙って緩めることの承認とは解釈していない（§4 の選択が要る） |
| 対象 | [`owlvit-assist-result.md`](../spikes/models/owlvit-assist-result.md) §7.3 の `verdict: FAIL`（ATG 実行 `84e8cb29-8aa9-40b6-bcab-411bfae30eff` の node G2Q-03D） |

## 1. 事実（出典つき）

1. **不合格の中身。** 3 つの比較とも、検出数（2,820 / 2,820）、対応のない検出（0）、label、score の差（最大 `1.5395e-06`、許容差 `1.0e-04`）はすべて合格した。不合格は box の差だけで、最大差は `7.4707e-02` / `4.9835e-02` / `4.8096e-02` px。許容差は `1.0e-03` px（[`owlvit-assist-result.md`](../spikes/models/owlvit-assist-result.md) L116-L122）。
2. **model の生出力の段階では合格している。** `pred_boxes`（入力画像に対する相対座標 `cxcywh`）は、全 20 item の全 patch で `np.allclose(rtol=1e-3, atol=1e-4)` を満たした（[`owlvit-assist-result.md`](../spikes/models/owlvit-assist-result.md) L116-L123。判定の実装は [`owlvit_assist_parity.py`](../spikes/models/owlvit_assist_parity.py) の `raw_diff`、L173-L183、呼び出しは L404-L417）。box の px は、この相対座標に原寸（1,024 px）を掛けて作っている（同 script の `all_patches`、L117-L134）。
3. **`1.0e-03` px は別の model で決めた値である。** 値は SPI-16（SSDlite320 MobileNetV3、CNN）の定数 [`detection.py`](../spikes/models/detection.py) L54 の `BOX_TOLERANCE` で、SSDlite の実測値は `3.0518e-05` px だった（[`detection-result.md`](../spikes/models/detection-result.md) L115）。OWL-ViT（ViT）に使う値として導出した記録は、`docs/` と C7 の計画の検索では見つからなかった。C7D-02 の計画では「検出は `detection_checkpoint_parity.compare`」と関数ごと固定しており（[`owlvit-assist-result.md`](../spikes/models/owlvit-assist-result.md) L40）、その関数がこの定数を参照している（[`detection_checkpoint_parity.py`](../spikes/models/detection_checkpoint_parity.py) L233-L237）。
4. **要求定義の規定。**
   - POC-08:「元モデルと ONNX の出力・評価差が定義した許容範囲内である。許容範囲はモデル採用記録に固定する」（[`requirement-definition.md`](../docs/requirement-definition.md) L802）。
   - FR-TRN-018: 生 tensor は `rtol <= 1e-3` かつ `atol <= 1e-4`。検出の評価指標の絶対低下は 0.005 以下（mAP@[0.50:0.95]）。例外は開発・リリース責任者が根拠・影響・モデル別の承認値を採用記録に残す（[`requirement-definition.md`](../docs/requirement-definition.md) L355）。FR-TRN-018 は利用者が学習した model（成功モデル）の規定で、補助モデルに直接かかるのは POC-08 である。
   - 要求定義には、検出の box に px の絶対許容差を置く規定はない（L355・L802 のほか、`許容差|rtol|atol|parity` の検索で該当なし）。
5. **OWL-ViT の採用記録の現状。** parity の行は「検出単位: 未確認」、許容基準は `compare` を参照したままである（[`owlvit-base-patch32-adoption.md`](../docs/model-governance/owlvit-base-patch32-adoption.md) L107）。
6. **G2Q-03D が合格しても OWL-ViT は承認されない。** 採用記録の保留の理由（[`owlvit-base-patch32-adoption.md`](../docs/model-governance/owlvit-base-patch32-adoption.md) L140）のうち、本件が解消するのは (3) の「その score 帯での検出単位の parity」だけである。次は残る。
   - (1) CPU の p95 / throughput の基準未達は、所有者の判断 G2D-01 により、C7 では測定値として記録し合否に使わない（[`adoption-template.md`](../docs/model-governance/adoption-template.md) L209）。したがって残る blocker ではなく、記録する制約である。ただし採用記録 L140 は G2D-01 の前の記述のまま (1) を保留の理由に挙げており、lane Z で G2D-01 に合わせる（§5.1）。
   - (2) 比較試験 §12（利用者の session G2Q-04/05 は所有者の指示で除外中）。
   - (3) のうち、製品の seed・prompt 形式などの設定の確定。G2Q-03D で案を記録したが、採用記録 §9 には未反映。
   - (4) C8 の学習データの `unknown` 項目。
   - (5) transformers の依存採用判断と advisory の照会。
   - (6) risk acceptance の署名。
   - Gate 2 は **BLOCKED** のままである。
   - 注記（2026-09-25 06:20 以降）: 本 file の (1)〜(6) は、当時の採用記録 L140 の番号である。その後の lane Z で (1) を削って番号を振り直したため、現在の採用記録では、当時の (2)→(1)、(3)→(2)、(4)→(3)、(5)→(4)、(6)→(5) になる（`work/20260925-0620-RemainingItems-BlockerAnalysis.md` §1）。本 file の後の節の番号も当時のもの。

## 2. 原因の見立て（推論。未検証の部分を明記）

- 生出力の相対座標の差は、最大で `1.4734e-04`（C7D-02 の fixture、[`owlvit-assist-result.md`](../spikes/models/owlvit-assist-result.md) L44）程度である。これを 1,024 倍すると 0.1 px 前後になり、§7.3 の実測（0.048〜0.075 px）と桁が合う。**実装の誤りではなく、実行基盤ごとの浮動小数点演算の差が拡大で px に現れたもの**と考えられる。ただし、演算のどの部分で差が生じているかは測っていない。
- `1.0e-03` px を 1,024 px の画像で満たすには、相対座標で約 `1e-6` の一致が要る。これは FR-TRN-018 の `atol 1e-4` より約 100 倍厳しい。

## 3. 対策案

| 案 | 内容 | 根拠 | 利点 | 欠点・リスク | 見積 |
|---|---|---|---|---|---|
| **A（推奨）** | OWL-ViT の goldset mode の検出単位 parity を、次の A1〜A3 で判定し、採用記録に固定する（POC-08）。px の box 差は記録するが判定に使わない。**A1**: 生出力 `logits` と `pred_boxes`（相対座標）の両方を `np.allclose(rtol=1e-3, atol=1e-4)` で判定する（既存の検査のまま）。**A2**: 検出集合の一致は現行の `compare` と同じ条件で判定する。対象は、画像ごとの件数、IoU `≥ 0.99`（[`detection.py`](../spikes/models/detection.py) L53 の `MATCH_IOU`）での対応、label の一致、score 差 `≤ 1e-4`。**A3**: backend ごとに、その backend 自身の box と score から gold set の F1（IoU 0.5、1 対 1）を計算し、`abs(F1_backend − F1_torch) ≤ 0.005` とする。改善の方向も差として扱う | A1 は FR-TRN-018 の生 tensor の既定値（L355）そのもの。A2 は SPI-16 以来の既存の定数。**A3 は新しい提案**で、0.005 は FR-TRN-018 の検出の値（mAP@[0.50:0.95] の絶対低下）と G2D-07D の F1 の非劣化幅（[`2026-09-24-owner-ruling-G2D-07D.md`](../docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-07D.md) L21。これは assisted と manual の比較の値で、backend 間の parity の値ではない）を**類推で借りた**もの | A1・A2 は、今回の測定値に合わせて作った数値ではない。A1 と A2 は §7.3 の実測で既に満たしている。box の幾何の一致は、A1（全 patch の相対座標）と A2（検出ごとの IoU `≥ 0.99`）の 2 段で押さえる | **測定で不合格を見た後に判定を組み直す**ことになる（後付けの基準変更）。§4 の所有者の書面に明記し、§7.3 の FAIL の記録は消さない。A3 は未測定で、再測定で不合格になる可能性がある。A3 の指標は FR-TRN-018 の mAP ではなく F1 で、所有者が明示的に承認する必要がある。IoU `≥ 0.99` は、小さい box では px の差に敏感になる（今回は 2,820 件すべてが対応した） | 約 3 時間（実装 45 分、確認 30 分、再測定と ATG run 45 分、記録とレビュー 60 分） |
| B | 判定は変えず、数値の差を小さくして `1.0e-03` px を満たす（例: ONNX Runtime の graph 最適化を無効にする） | 判定の変更がない | 基準を変えない | **実現できるかは未検証**。最小の差（CPU ↔ DirectML の `4.8096e-02` px）でも許容差の約 48 倍である。DirectML の kernel の計算順を session の設定で制御できるかは確認していない。本番と異なる session 設定で合格しても、製品の推論設定と一致しない。失敗すれば A か D に戻る | 調査 1〜2 時間（成否は不明） |
| C | px の許容差を OWL-ViT 用の新しい値（例: 0.1 px や 1 px）にする | POC-08 の「採用記録に固定」には沿う | 変更が小さい | 値の根拠がなく、実測を見て決めた数値になる。A より恣意性が高い | 約 1.5 時間 |
| D | OWL-ViT を検出の補助モデルの候補から外し、別の checkpoint を再調査する（[`requirement-definition.md`](../docs/requirement-definition.md) L764） | 要求定義の代替経路 | 判定を変えない | 前回の候補 Grounding DINO tiny は parity が大きく不合格だった（[`grounding-dino-assist-result.md`](../spikes/models/grounding-dino-assist-result.md) L45-L47）。権利の調査・変換・測定をやり直す必要があり、同じ許容差で同じ問題が起きる可能性がある | 数日 |

推奨は **A** である。理由:

1. A1・A2 の数値（`rtol 1e-3`・`atol 1e-4`・IoU `0.99`・score `1e-4`）は、測定の前から要求定義または既存の定数にあった。A3 の `0.005` は既存の値の類推で、今回の測定値から作った数値ではない。
2. POC-08 は許容範囲を「モデル採用記録に固定する」としており、model ごとに判定を定めることは想定されている。POC-08 は「出力・評価差」の両方を求めており、A1・A2 が出力の差、A3 が評価の差にあたる。
3. 他の model（SSDlite、Grounding DINO、基盤重み）の判定、共有の `compare`、定数 `BOX_TOLERANCE` は変えない（§5.1）。

## 4. 所有者に決めてもらう事項

| ID | 質問 | 選択肢 | 推奨 |
|---|---|---|---|
| G2Q-03D-T | G2Q-03D の検出単位 parity をどう扱うか | A / B / C / D（§3） | **A**。A を選ぶ場合は、(1) 後付けの基準変更であること、(2) A3 の指標を F1 とし、許容幅を `abs(ΔF1) ≤ 0.005` とすることの 2 点を、書面に明記する |

所有者の回答は、根拠書面 `docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md` に原文で記録する。A の具体的な判定（A1〜A3）は、書面と採用記録に書く。

## 5. A を選んだ場合の実行計画

### 5.1 変更

| 対象 | 変更 |
|---|---|
| [`owlvit_assist_parity.py`](../spikes/models/owlvit_assist_parity.py)（744 行。G2D-09 により行範囲で読む） | goldset mode（L284 以降）だけを変える。(1) `compare`（L403）の呼び出しをやめ、同じ file 内の goldset 専用の比較で A2 を判定する（[`detection.py`](../spikes/models/detection.py) L168 の `match_detections` を使う）。(2) backend ごとに `all_patches` と `iou_pairs` を計算し直し（現在は torch だけ。L346-L359）、F1 を求めて A3 を判定する。(3) JSON に `parity_policy`（A1〜A3 の定義と根拠書面の path）、`f1_by_backend`（backend ごとの TP・提案数・F1）、px の box 差（記録用）を書く。parity mode（L670）は変えない |
| [`owlvit-assist-result.md`](../spikes/models/owlvit-assist-result.md) | §7.5 を追加する（§7.3 の FAIL は残す） |

共有の [`detection_checkpoint_parity.py`](../spikes/models/detection_checkpoint_parity.py) の `compare` は変更しない。px の box 差を判定から外すのは OWL-ViT の goldset mode の中だけに閉じ、他の経路（同 file の L490-L492・L652-L654、[`grounding_dino_assist_parity.py`](../spikes/models/grounding_dino_assist_parity.py) L378-L386、OWL-ViT の parity mode）は今までどおり `1.0e-03` px で判定する。

ATG の node の外（lane Z）で更新するもの:

| 対象 | 変更 |
|---|---|
| 根拠書面（新規） | §4 のとおり |
| [`owlvit-base-patch32-adoption.md`](../docs/model-governance/owlvit-base-patch32-adoption.md) L107・L140 | L107 の許容基準を A1〜A3 に置き換え、結果を記録する。L140 の保留の理由 (1) を G2D-01 に合わせて「測定値として記録（合否に使わない）」と改め、(3) の検出単位の parity の結果を反映する。保留の判定は変えない |
| TERM-01、`CHANGELOG.md` | 結果を記録する |

変更しないもの: `detection.py`、`detection_checkpoint_parity.py`、SigLIP、`resources/models/manifest.json`、ADR、製品コード、ATG kit（版の更新なし）。

### 5.2 ATG run（main6）

main4 の契約は旧判定を前提にしているため、新しい run（main6）を作る。形は main4・main5 と同じで、node は G2Q-03D の 1 つだけ。

| 成果物 | path |
|---|---|
| 生成 script | `work/20260925-0526-make-main6.py` |
| graph / 契約 | `work/20260925-0526-atg-graph-main6.json` / `work/20260925-0526-atg-contract-main6.json` |
| verify script | `work/20260925-0526-Gate2Main6-verify.ps1` |
| A1〜A3 の再計算 script | `work/20260925-0526-check-parity-A.py` |
| 状態 | `work/20260925-0526-Gate2Main6-atg-state/`（handoff を含む） |
| 記録 | `work/20260925-0526-Gate2Main6-G2Q-03D-Review.md`、`-Acceptance.md`、`-Report.md` |

- node の write set（main4 の G2Q-03D と同じ形）: `spikes/models/owlvit_assist_parity.py`、`spikes/models/owlvit-assist-result.md`、`vendor/models/_spike/owlvit-goldset.json`、`work/20260925-0526-Gate2Main6-G2Q-03D-Review.md`、`lock:owlvit-record`。`contract.outputs` と root の成果物には、この 4 file を宣言する。
- `contract.inputs`: verify script、`owlvit_assist_parity.py`、`owlvit-assist-result.md`、検出の gold set 計画、OWL-ViT の採用記録、gold set、本書、根拠書面（G2Q-03 と新規の G2Q-03D-parity）、`work/20260925-0420-check-selection.py`、`work/20260925-0526-check-parity-A.py`。
- 生成 script、graph、契約、verify script、`check-parity-A.py` は `run begin` の前に作る。Acceptance・Report は `run finish` の前後に作る（main4・main5 と同じ。node の書込み検査の対象外）。lane Z（根拠書面を除く、採用記録・TERM-01・CHANGELOG）は `run finish` の後に行う。根拠書面は、所有者の回答を記録するため `run begin` の前に作る。
- node の verify: main4 の G2Q-03D の検査（CHECKJSON・RECORDED・ISPASS・RUFF・`work/20260925-0420-check-selection.py`）に、次の 2 つを加える。
  - CHECKJSON の必須キーに `parity_policy`・`f1_by_backend` を加える。
  - `work/20260925-0526-check-parity-A.py <出力 JSON>` を実行する。この script は、JSON に書かれた集計値の検査である。検査の内容は、A2 の集計値（件数の一致、対応のない検出 0、label 不一致 0、score 差 `≤ 1e-4`）、A3 の `abs(ΔF1) ≤ 0.005`、`f1_by_backend` の key が 3 backend ちょうどであること、値が有限で [0, 1] にあること、F1 = 2TP / (提案数 + gold box 数) であること。TP や IoU の対応付けそのものは JSON から再計算できないため、幾何の正しさは §5.3 の合成入力の確認と node のレビューで確かめる。
- 手順: `contract check` → `graph check` → `run begin` → `node start` → 実装・測定 → 敵対的レビュー → `node check-writes` → `node finish` → `report` → `run finish`。root の `acceptance_command` は main5 と同じにする（npm `12.0.0` の確認、`npm run verify:docs`、`node --test scripts/models/manifest-schema.test.mjs`。[`20260925-0420-atg-contract-main5.json`](20260925-0420-atg-contract-main5.json) の `acceptance_command`）。node の判定は node の verify（`work/20260925-0526-Gate2Main6-verify.ps1 G2Q-03D`）で行う。

### 5.3 完了条件

- [ ] 根拠書面に所有者の選択 A が原文で記録され、後付けの基準変更であること、A3 の指標と式が書かれている。
- [ ] `ruff`（`ml\.venv\Scripts\ruff.exe`）が `owlvit_assist_parity.py` で exit 0。
- [ ] `git diff --stat` で、`detection_checkpoint_parity.py`・`detection.py`・`grounding_dino_assist_parity.py` に変更がない（共有の判定が変わっていない）。
- [ ] A3 が backend 自身の box を使うことの確認。`/work/` の一時 script で、goldset 専用の F1 の関数に合成入力を与えて確かめる。合成入力は、件数を変えずに ONNX 側の 1 box だけが gold との IoU 0.5 の境界をまたぐものとし、その backend の F1 が torch と異なることを確かめる。spike の file には test を加えない。
- [ ] `owlvit_assist_parity.py --mode goldset` を再実行し、出力 JSON を `owlvit-assist-result.md` §7.5 に SHA-256 と exit code つきで記録する。`verdict` が `PASS` でなければ node を失敗として記録し、判定はそれ以上変えない。
- [ ] 閾値の選択が変わっていない（`confidenceThreshold` が `0.0002533551160013303` のまま。`work/20260925-0420-check-selection.py` が exit 0）。
- [ ] main6 で `node finish` と `run finish` が `accepted: true`。`node check-writes` で宣言外の書込みがない。
- [ ] `git diff --check`、`npm run verify:docs`（npm 12.0.0）、TERM-01 の検査 script が exit 0。
- [ ] 敵対的レビューで、判定が fail-open になる経路がないこと、共有の経路の判定が変わらないことを確認し、blocking 0。

## 6. 本書が主張しないこと

1. OWL-ViT の parity が合格したとは主張しない。A1・A2 は §7.3 の実測で満たしているが、A3 は未測定である。
2. 案 B が実現できないとは断定しない（未検証）。
3. OWL-ViT の承認、Gate 2 の通過は、本件が解消しても成立しない（§1 の 6）。
