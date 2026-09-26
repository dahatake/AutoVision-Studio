# G2Q-01C: 分類の gold set と判定基準の案（TBD-08）

本書は数値の**案**である。確定は G2D-07C で所有者が行う（Gate 2 計画 `work/202609232120-RemainTaskExecutionPlan.md` §8.9）。確定の前に session を記録しない。

- 対象の C7: 分類 SigLIP base（所有者の判断 `docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-05.md`）。
- 要求: NFR-ANN-006（最終 Ground Truth の品質を悪化させず、annotation 所要時間を短縮する）、POC-16（representative gold set で manual-only より最終品質を悪化させず、中央所要時間を短縮する）、TBD-08（coverage、最終品質、所要時間の採用基準を class / task ごとに固定する）。出典は `work/202609232120-Gate2-RequirementExtract.md` 70・88・100 行。
- harness: `spikes/models/assist_benchmark.py`（入力は 1 item 1 行の JSON Lines。20〜24 行）。

## 1. gold set の出典と権利

- 画像と gold label: `resources/samples/beans`（`manifest.json` の `images[]`。各 item の `label` は元 dataset の class で、model の出力ではない）。license は同 directory の `LICENSE.txt`、出典は `ATTRIBUTION.txt`。
- gold label を model の出力から作らない（Gate 2 計画 §8.10）。

## 2. item 数

- 案: 60 item（fixture の全件）。根拠: `resources/samples/beans/manifest.json` の `images[]` の件数。
- class ごとに 20 item（angular_leaf_spot、bean_rust、healthy）。根拠: 同 manifest の `label` の値ごとの件数。
- 1 item の重みは 1/60（約 0.0167）。根拠: item 数からの計算。

## 3. 被覆の下限

- 案: 3 class のそれぞれに 20 item 以上。根拠: fixture の class ごとの件数（全件を使うため、これより多くは取れない）。
- C7 の提案の coverage（提案があった item の割合）の下限は 0.5 以上とする案（既存資料に値が無く、TBD-08 は coverage を基準に含めることだけを定める）。所有者の判断事項。

## 4. 被覆の検査コマンド

gold set manifest（`vendor/models/_spike/assist/goldset-classification.json`）について、class ごとの item 数が下限以上であることを検査する。正常終了で合格。

```powershell
& vendor\models\_spike\venv\Scripts\python.exe -c "import json,collections,sys; m=json.load(open(r'vendor\models\_spike\assist\goldset-classification.json',encoding='utf-8')); c=collections.Counter(i['label'] for i in m['items']); sys.exit(0 if set(c)=={'angular_leaf_spot','bean_rust','healthy'} and min(c.values())>=20 else 1)"
```

## 5. 判定式

- 最終 label の入力（根拠: FR-ANN-010、製品の実装 `src/main/data/revision-manifest.ts` 10〜40・204 行）: 各 session の作業の後に製品で確定した Dataset Revision の manifest（作業フォルダーの `datasets/<revisionId>/manifest.json`）。記録者は、これを session file と同じ directory へ `<session file の stem>.revision.json` として複写し、その SHA-256 を受け渡しメモ `<session file>.meta.txt` に書く。harness は G2Q-02 で `--assisted-revision` / `--manual-revision` の明示入力として受け取り、メモの SHA-256 と照合し、両 manifest の SHA-256 を出力 JSON に含める（Gate 2 計画 §8.11 の (2)・(3)）。「最新の revision」を探して使わない。
- 照合（根拠: 同じ実装の `items[]`・`schema`）: gold set の item とは manifest の `items[].imageSha256` で照合する。class は同じ manifest の `schema`（Label Schema の snapshot）で class の名前へ解決し、gold の class の名前と比べる。gold set の item が manifest に無い、複数回ある、`disposition` が `excluded`、または manifest の `taskType` が違う場合、その session は無効として記録し直す（fail-closed）。`outcome` から最終 label を推定しない。session の JSON Lines の形式は変えない。
- 最終品質: session の最終 label が gold label と一致した item の割合（accuracy）。assisted を `Qa`、manual-only を `Qm` とする。
- 品質の非劣化: `Qa >= Qm - δ`（δ は次節）。
- 所要時間: item ごとの `seconds` の中央値で比較し、`median(assisted) < median(manual-only)` を短縮とする（POC-16、`assist_benchmark.py` の docstring）。根拠: POC の「中央所要時間を短縮」と、harness が中央値で比較すること。
- 合格は、品質の非劣化と所要時間の短縮の両方を満たす場合だけ。どちらかを満たさなければ不合格（fail-closed）。
- class ごとの確認: class ごとに `Qa_c >= Qm_c - δ_c`（δ_c は次節）も満たす。根拠: TBD-08 の「class / task ごとに固定する」。

## 6. 非劣化の閾値

- 全体の δ の案: 1/60（1 item 分）。根拠: item 数の最小の単位。δ を零にすると 1 件の誤りで不合格になり、manual-only の誤りの揺らぎと区別できない。値は所有者の判断事項。
- class ごとの δ_c の案: 1/20（class の 1 item 分）。根拠: class ごとの item 数の最小の単位。値は所有者の判断事項。

## 7. sample 数の根拠

- 60 item は fixture の全件で、これ以上の画像は repository に無い（§2）。統計的な検出力の計算は行っていない。この件数で非劣化を統計的に示せるとは主張しない。所有者の判断事項。

## 8. 測定の順序

- 案: assisted を先、manual-only を後に記録する。根拠: 同じ作業者が同じ画像を 2 回見るため、後の session が慣れで速くなる。manual-only を後にすると、その効果は manual-only に有利に働き、所要時間の短縮を過大に示さない側になる。
- 2 つの session の間隔は 24 時間以上の案。所有者の判断事項（既存資料に値が無い）。
- 記録の手段は EXT-41（`work/20260924-0730-EXT-41-Plan.md`）。

## 9. gold set manifest の形式

Gate 2 計画 §8.10 のとおり。`expected_item_count` と `items[]` を持ち、各 item は `item_id`、`image`（相対 path）、`image_sha256`、`label`（gold label）、`source`（dataset 名と revision、または URL）、`license` を持つ。画像は Git の追跡外の `vendor/models/_spike/assist/` の下に置く。

## 10. 除外の条件

- 画像の SHA-256 が `resources/samples/beans/manifest.json` の値と一致しない item は gold set に入れない（Gate 2 計画 §8.10 の検査）。
- session の途中で測り忘れた item がある場合、その session は記録し直す（EXT-41 計画 §3）。item を除外して判定しない。

## 11. 変更の規則

- 本書の数値は、所有者の判断事項として G2D-07C の承認で確定し、session を記録する前に固定する。
- 測定の後に数値・判定式・item を変えない。変える場合は、新しい所有者の判断の記録を作り、session を記録し直す。
