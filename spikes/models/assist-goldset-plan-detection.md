# G2Q-01D: 検出の gold set と判定基準の案（TBD-08）

本書は数値の**案**である。確定は G2D-07D で所有者が行う（Gate 2 計画 `work/202609232120-RemainTaskExecutionPlan.md` §8.9）。確定の前に session を記録しない。

- 対象の C7: 検出 OWL-ViT base patch32（所有者の判断 `docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-05.md`）。
- 要求: NFR-ANN-006（最終 Ground Truth の品質を悪化させず、annotation 所要時間を短縮する）、POC-16（representative gold set で manual-only より最終品質を悪化させず、中央所要時間を短縮する）、TBD-08（coverage、最終品質、所要時間の採用基準を class / task ごとに固定する）。出典は `work/202609232120-Gate2-RequirementExtract.md` 70・88・100 行。
- harness: `spikes/models/assist_benchmark.py`（入力は 1 item 1 行の JSON Lines。20〜24 行）。

## 1. gold set の出典と権利

- 画像と gold box: `resources/samples/gwhd-2021`（`manifest.json` の `images[]` と `annotations.coco.json`。box は元 dataset の annotation で、model の出力ではない）。license は同 directory の `LICENSE.txt`（CC-BY-4.0）、出典は `ATTRIBUTION.txt`。
- gold box を model の出力から作らない（Gate 2 計画 §8.10）。

## 2. item 数

- 案: 20 item（fixture の全画像。1 item は 1 画像）。根拠: `resources/samples/gwhd-2021/manifest.json` の `images[]` の件数。
- gold box は計 1079 個、class は `wheat_head` の 1 種。根拠: `annotations.coco.json` の `annotations` と `categories` の件数。
- 画像ごとの box 数は 21〜83 個（中央値 54）。根拠: 同 file の `image_id` ごとの集計。

## 3. 被覆の下限

- scene: `manifest.json` の `domain` の 9 種（Arvalis_2 が 4 画像、ETHZ_1 が 5 画像、Rres_1 が 3 画像、Arvalis_6 と ULiège-GxABT_1 が各 2 画像、ほか 4 種が各 1 画像）をすべて含む。根拠: 同 manifest の `domain` の集計。
- object size（COCO の面積の区分。small は 32×32 未満、large は 96×96 以上）: small 9 個以上、medium 858 個以上、large 212 個以上。根拠: `annotations.coco.json` の `bbox` の幅×高さの集計（全件を使うため、これより多くは取れない）。
- C7 の提案の coverage（提案があった item の割合）の下限は 0.5 以上とする案（既存資料に値が無く、TBD-08 は coverage を基準に含めることだけを定める）。所有者の判断事項。

## 4. 被覆の検査コマンド

gold set manifest（`vendor/models/_spike/assist/goldset-detection.json`）について、scene の種類と size の区分ごとの box 数が下限以上であることを検査する。正常終了で合格。

```powershell
& vendor\models\_spike\venv\Scripts\python.exe -c "import json,sys; m=json.load(open(r'vendor\models\_spike\assist\goldset-detection.json',encoding='utf-8')); it=m['items']; b=[x['bbox'][2]*x['bbox'][3] for i in it for x in i['boxes']]; s=sum(a<1024 for a in b); l=sum(a>=9216 for a in b); sys.exit(0 if len({i['domain'] for i in it})>=9 and s>=9 and len(b)-s-l>=858 and l>=212 and all(x['class']=='wheat_head' for i in it for x in i['boxes']) else 1)"
```

## 5. 判定式

- 最終 box の入力（根拠: FR-ANN-010、製品の実装 `src/main/data/revision-manifest.ts` 10〜40・204 行）: 各 session の作業の後に製品で確定した Dataset Revision の manifest（作業フォルダーの `datasets/<revisionId>/manifest.json`）。記録者は、これを session file と同じ directory へ `<session file の stem>.revision.json` として複写し、その SHA-256 を受け渡しメモ `<session file>.meta.txt` に書く。harness は G2Q-02 で `--assisted-revision` / `--manual-revision` の明示入力として受け取り、メモの SHA-256 と照合し、両 manifest の SHA-256 を出力 JSON に含める（Gate 2 計画 §8.11 の (2)・(3)）。「最新の revision」を探して使わない。
- 照合（根拠: 同じ実装の `items[]`・`schema`）: gold set の item とは manifest の `items[].imageSha256` で照合する。class（各 box の class） は同じ manifest の `schema`（Label Schema の snapshot）で class の名前へ解決し、gold の class の名前と比べる。gold set の item が manifest に無い、複数回ある、`disposition` が `excluded`、または manifest の `taskType` が違う場合、その session は無効として記録し直す（fail-closed）。`outcome` から最終 box を推定しない。session の JSON Lines の形式は変えない。
- 最終品質: 同じ item の中だけで、session の最終 box と gold box を IoU の大きい順に 1 対 1 で対応させ、IoU 0.5 以上の対を一致として、全 20 item の box をまとめた F1 を求める。assisted を `Qa`、manual-only を `Qm` とする。IoU 0.5 の根拠: FR-REP-003 の AP50 の閾値。最終 annotation は信頼度を持たないため mAP@[0.50:0.95]（FR-TRN-017）は使えない。指標の選択は所有者の判断事項。
- 品質の非劣化: `Qa >= Qm - δ`（δ は次節）。
- 所要時間: item ごとの `seconds` の中央値で比較し、`median(assisted) < median(manual-only)` を短縮とする（POC-16、`assist_benchmark.py` の docstring）。根拠: POC の「中央所要時間を短縮」と、harness が中央値で比較すること。
- 合格は、品質の非劣化と所要時間の短縮の両方を満たす場合だけ。どちらかを満たさなければ不合格（fail-closed）。
- class ごとの確認: class は `wheat_head` の 1 種だけのため、全体の判定が class ごとの判定を兼ねる（§2 の class の件数が根拠）。

## 6. 非劣化の閾値

- δ の案: F1 の絶対低下 0.005。根拠: FR-TRN-018 の検出の既定許容差（mAP@[0.50:0.95] の絶対低下 0.005 以下）と同じ値。値は所有者の判断事項。
- scene ごとの閾値は置かない案（1 画像だけの scene が 4 種あり、scene ごとの F1 は判定に使えるほど安定しない）。scene ごとの F1 は観測値として記録する。所有者の判断事項。

## 7. sample 数の根拠

- 20 item は fixture の全画像で、これ以上の画像は repository に無い（§2）。統計的な検出力の計算は行っていない。この件数で非劣化を統計的に示せるとは主張しない。所有者の判断事項。

## 8. 測定の順序

- 案: assisted を先、manual-only を後に記録する。根拠: 同じ作業者が同じ画像を 2 回見るため、後の session が慣れで速くなる。manual-only を後にすると、その効果は manual-only に有利に働き、所要時間の短縮を過大に示さない側になる。
- 2 つの session の間隔は 24 時間以上の案。所有者の判断事項（既存資料に値が無い）。
- 記録の手段は EXT-41（`work/20260924-0730-EXT-41-Plan.md`）。

## 9. gold set manifest の形式

Gate 2 計画 §8.10 のとおり。`expected_item_count` と `items[]` を持ち、各 item は `item_id`、`image`（相対 path）、`image_sha256`、`domain`（`manifest.json` の値）、`boxes`（各要素は COCO の `bbox` の `[x, y, 幅, 高さ]` と `class`）、`source`（dataset 名と revision、または URL）、`license` を持つ。画像は Git の追跡外の `vendor/models/_spike/assist/` の下に置く。

## 10. 除外の条件

- 画像の SHA-256 が `resources/samples/gwhd-2021/manifest.json` の値と一致しない item は gold set に入れない（Gate 2 計画 §8.10 の検査）。
- session の途中で測り忘れた item がある場合、その session は記録し直す（EXT-41 計画 §3）。item を除外して判定しない。

## 11. 変更の規則

- 本書の数値は、所有者の判断事項として G2D-07D の承認で確定し、session を記録する前に固定する。
- 測定の後に数値・判定式・item を変えない。変える場合は、新しい所有者の判断の記録を作り、session を記録し直す。
