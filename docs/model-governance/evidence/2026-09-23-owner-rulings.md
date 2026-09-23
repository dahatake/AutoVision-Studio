# Owner rulings record — 2026-09-23（委任による判断）

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の指示に基づく判断の記録） |
| 権限者（委任者） | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 判断者（委任を受けた者） | 実装担当（本 repository の作業者）。D1・D2 の内容は判断者が選んだものであり、権限者が個別に選んだものではない |
| 決定日 | **2026-09-23** |
| 記録者 | 実装担当（本 repository の作業者） |
| 決定の経緯 | 権限者が 2026-09-23 11:17 に、提示された「次に必要な判断」のうち 1（C6 検出の閾値）と 2（OWL-ViT の教育目的）について「要求定義書に照らし合わせて合理的な選択で OK」と指示した。本書は、その委任に基づき判断者が要求定義書から選んだ判断を書面化したものである |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |
| 先行記録（変更しない） | [`2026-09-22-owner-risk-acceptance.md`](2026-09-22-owner-risk-acceptance.md)、[`2026-09-23-owner-risk-acceptance.md`](2026-09-23-owner-risk-acceptance.md) |

---

## D1. Curated Base Weight（C6）に POC-03 の実時間推論閾値を適用しない

### 判断

採用記録 [`adoption-template.md`](../adoption-template.md) §11 の `≤ 100 ms` / `≥ 10 FPS`（POC-03 由来）の採用基準は、**C6 の採用判定には適用しない**。POC-03 と NFR-PERF-004 は、製品のカメラ推論経路（学習後の Model Version）で INF phase に検証する。

### 要求定義書上の根拠

| 根拠 | 内容 |
|---|---|
| §5 用語と管理単位（Curated Base Weight） | 「初回学習に用いる、製品側でライセンスと由来を承認した基盤重み」。推論に用いる model とは定義していない |
| §5 用語と管理単位（Model Version） | 「成功した Training Run から生成される不変の学習済みモデル一式」 |
| FR-INF-001 | 「推論画面で、同一 Project の成功済み Model Version を選択できる」。カメラ推論の対象は Model Version であり、C6 そのものではない |
| POC-03 / NFR-PERF-004 | 「承認済み軽量モデルを 30 分連続実行し …」。camera 取得から表示までの経路を対象とし、FR-INF-013 / 014 により表示閾値は Inference Profile で利用者が設定する |
| FR-INF-014 | 信頼度しきい値は Project の Inference Profile に保存する。C6 の採用時点では製品の推論閾値は決まらない |

このため、C6 の採用記録で POC-03 を合否基準にすると、推論経路・後処理閾値が未確定の段階で、推論に直接使わない重みを判定することになる（2026-09-23 の SSDLite の保留はこの状態であった）。

### C6 に適用する技術基準（緩和しないもの）

SHA-256、安全形式、CPU / DirectML の ONNX parity、対象用途（Fine-Tuning 初期重み）としての精度、AutoML budget（D-15）、既知脆弱性の照会。FR-LIC-016(5) の技術要件を緩和するものではない。

### 本判断が意味しないこと

1. POC-03 / NFR-PERF-004 を緩和しない。INF phase で Model Version の推論経路に対して検証し、満たさなければ製品リリースは失敗する。
2. 2026-09-23 の SSDLite の測定（既定後処理 `score_thresh=0.001` で不適合、`0.05` で適合）は参考値として採用記録に残し、INF phase の閾値設計の入力とする。
3. C7（Annotation Assist Model）への適用は本判断の対象外である。

## D2. OWL-ViT / OWLv2 の intended use に教育目的の記載がないこと

### 判断

`google/owlvit-base-patch32` と `google/owlv2-base-patch16-ensemble` の model card は intended use を "a research output for research communities"、primary intended users を "AI researchers" と記載し、教育目的に言及しない。これは製品のモデル利用条件（非商用の研究・教育目的）より**狭い用途制限として扱う**（FR-LIC-003）。

### 帰結

いずれかを採用する場合は、(1) FR-LIC-003 の書面承認、(2) アプリ内表示（FR-LIC-012）と `THIRD_PARTY_NOTICES` への「研究目的に限る」旨の明示、を要する。採用するまでは効力を持たない判断であり、本書は採用を決定しない。

### 要求定義書上の根拠

FR-LIC-003（製品の条件より狭い用途制限は書面承認と表示を要する）、`adoption-template.md` §8（製品用途が intended use に含まれない場合は同梱不可。ただし研究・教育の一方だけが含まれる場合は、FR-LIC-003 の書面承認と表示がある場合に限り同梱可）。教育目的を intended use に含まれると推測で補わない（FR-LIC-016(1)）。

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
