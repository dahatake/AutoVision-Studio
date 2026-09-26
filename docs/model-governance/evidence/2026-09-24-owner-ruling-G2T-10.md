# Owner ruling G2T-10 — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 18 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §8.2 の G2T-10（C6 分類 checkpoint の transfer 学習後の ONNX parity）の許容差 |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft の FR-TRN-018（355 行） |

## 経緯

G2T-10 の 2026-09-24 の測定は、SPI-15 の絶対許容差（logit `1.0e-04`。`spikes/models/classification.py:51`）で判定し、3 比較すべての logit 最大差（`16384.0`、`12288.0`、`8192.0`）が許容差を超えて `FAIL`（exit 1）となった（[`classification-checkpoint-result.md`](../../../spikes/models/classification-checkpoint-result.md) §8）。一方、要求定義 FR-TRN-018 の既定の許容差は、生 tensor の `rtol <= 1e-3` かつ `atol <= 1e-4` と、分類の top-1 一致率 99.5% 以上である。実装担当は、この 2 つの基準の違いを示し、どちらを G2T-10 の判定基準にするかを所有者に問うた（選択肢の文面は会話で提示したもので、repository には記録がない。A は FR-TRN-018 の既定の許容差を使う案）。

## 回答の原文

> G2T-10: A（allclose の形で解釈する）

## 判断

G2T-10 の判定基準を、FR-TRN-018 の既定の許容差に替える。

1. 生 tensor（logit）は allclose の形（`rtol = 1e-3`、`atol = 1e-4`）で判定する。
2. top-1 一致率は 99.5% 以上。

所有者の回答は、allclose の相対項 `rtol × |b|` の `b` をどちらの tensor にするかを定めていない。この向きで PASS / FAIL が変わりうるため、実装担当は向きを選ばず、両方向（`|a − b| <= 1e-4 + 1e-3 × |b|` と `|a − b| <= 1e-4 + 1e-3 × |a|`）をともに満たすことを要求する。これは向きの選択を避けるための実装上の取り決めであり、所有者の判断ではない。

## 範囲

- 本判断は所有者による判定基準の変更であり、Gate 2 主 run の契約の non-goal「parity・性能・品質の基準を測定後に変えない」（`work/202609232120-atg-contract-main.json`）は実装担当の裁量を禁じるもので、所有者の判断による改訂はその例外として新しい契約に明記する。
- 前回の `FAIL` の結果は履歴として残し、書き換えない。新しい基準で改めて測定し、結果は測定から記録する。
- softmax 確率の最大差と top-5 集合の一致は FR-TRN-018 の既定の許容差に含まれないため、G2T-10 では判定に使わず、観測値として結果に残す。
- FR-TRN-018 のほかの項目（最適化指標の絶対低下 0.005 以下）は回答の対象ではないため、本判断に含めない。

## 本判断が意味しないこと

1. 測定の結果（PASS / FAIL）を先に決めない。
2. SPI-15（`classification.py`）の許容差と、G2T-10 以外の測定（parity mode、performance mode）の基準を変えない。
3. ほかの所有者判断を含まない。

選択: A

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
