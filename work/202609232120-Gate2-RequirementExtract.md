# Gate 2 残タスク — 要求・計画の抜粋

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（[`202609232120-RemainTaskExecutionPlan.md`](202609232120-RemainTaskExecutionPlan.md) の各ノードが、500 行を超える原本の代わりに参照する抜粋） |
| 作成日時 | 2026-09-23 JST |
| 原本 1 | [`docs/requirement-definition.md`](../docs/requirement-definition.md)、SHA-256 `6e0c0bda2396b5e716d2c7b8b252dc5fe4758dadf3bcdbd936ca5857c236dcf5`（987 行） |
| 原本 2 | [`docs/implementation-plan.md`](../docs/implementation-plan.md)、SHA-256 `ba446dd8c08390dfb29c757de5f438ab90dcac51f4bc74bc6a775c6acf019b16`（1869 行） |
| 規則 | 各行は原本の該当行を**変更せずに**転記したもの（行番号の見出しと字下げだけを追加）。原本の SHA-256 が上記と異なる場合、本抜粋は無効であり、原本から作り直す |

## 1. 要求定義（原本 1）

- 行 324

  ```text
  | FR-AST-012 | model が score を返さない場合、confidence を捏造・推定表示しない。score がある場合も `正解確率` ではなく `モデルスコア` と表示し、意味、範囲、threshold をモデル manifest から参照可能にする。 | 必須 |
  ```

- 行 325

  ```text
  | FR-AST-013 | Project model による prelabel threshold は、人が確定した validation sample 上の評価から version ごとに決める。汎用 Annotation Assist Model は採用 PoC で固定した threshold policy を使用する。高 score でも人の確認を省略しない [S38]。 | 必須 |
  ```

- 行 417

  ```text
  | FR-LIC-003 | GPL/AGPL 等の copyleft 部品、ソフトウェアの研究限定・非商用限定・用途制限付き部品、および製品のモデル利用条件（非商用の研究・教育目的）より狭い用途制限（例: 研究目的だけを許し教育目的を許さない、再配布を禁止する、利用者を特定組織に限る）を持つ学習済みモデルは、製品全体の配布条件との適合を**法務または repository license decision authority**（`docs/dependency-policy.md` §2.1）が個別に書面承認しない限り同梱しない。承認して同梱する場合は、その狭い制限をアプリ内表示（FR-LIC-012）と `THIRD_PARTY_NOTICES` に明示する。学習済みモデルが非商用限定・研究目的限定であることは、それだけでは除外理由としない。 | 必須 |
  ```

- 行 426

  ```text
  | FR-LIC-012 | アプリ内から第三者ライセンス、基盤重みの由来、必要な attribution、および同梱モデルの利用条件（非商用の研究・教育目的に限る旨と、FR-LIC-003 で承認したより狭い制限）を閲覧できる。 | 必須 |
  ```

- 行 428

  ```text
  | FR-LIC-014 | Annotation Assist Model ごとに、code と checkpoint を分けて名称、版、取得 URL、SHA-256、各ライセンス、model card の intended/out-of-scope use、全公開学習 dataset と各 terms、再配布条件、NOTICE、承認者、承認日を manifest に持つ。判断根拠となる取得日付き一次資料 URL と保存 copy/hash を添付する。いずれかが unknown、製品のモデル利用条件（非商用の研究・教育目的）に適合しない、または製品用途対象外の場合は同梱しない。研究限定・非商用限定であることは、それだけでは除外理由としない（より狭い制限は FR-LIC-003 による）。ただし **checkpoint 層ライセンスまたは学習データ terms を確認できない場合に限り**、FR-LIC-016 の risk acceptance 経路を適用できる。製品用途が一次資料で明示的に対象外とされている checkpoint には適用しない（FR-LIC-015）。 | 必須 |
  ```

- 行 429

  ```text
  | FR-LIC-015 | repository code が permissive license であることだけを根拠に checkpoint を承認しない。OpenAI CLIP は code が MIT でも model card が deployed use を out-of-scope とするため [S46][S47]、本製品の既定 Annotation Assist Model から除外する。 | 必須 |
  ```

- 行 430

  ```text
  | FR-LIC-016 | checkpoint 層のライセンスまたは学習データ terms を publisher の一次資料から確認できない Curated Base Weight / Annotation Assist Model は、次を**すべて**満たす場合に限り、repository license decision authority（`docs/dependency-policy.md` §2.1）の risk acceptance により同梱できる。(1) 一次資料調査を実施し、確認できた事実と**確認できなかった項目を列挙**して採用記録に残す（推測で補わない）。(2) 権限者が氏名・役割・決定日付きで書面決定し、その記録を採用記録から参照する。(3) manifest の該当 license 層に `LicenseRef-<製品名>` 形式の repository ローカル識別子を用い、**publisher による許諾表明ではない**旨を `noticeText` に明記する。schema が `const: true` を課す `commercialUseConfirmed` / `redistributionPermitted` / `commercialDerivativesPermitted` については、その値が**権限者の決定に基づくものであり publisher の確認ではない**ことを同じ `noticeText` で宣言する。schema の field 名を改訂するまで（TBD-09）、`commercialUseConfirmed` と `commercialDerivativesPermitted` は製品のモデル利用条件（非商用の研究・教育目的）での利用・派生の許可を表すものとして扱い、その旨を `noticeText` に明記する。manifest に `unknown` 等の未確定語彙を書かない（FR-LIC-010 は維持する）。(4) アプリ内ライセンス表示（FR-LIC-012）と `THIRD_PARTY_NOTICES` に、risk acceptance である事実と未確認項目を表示する。(5) SHA-256、安全形式、ONNX parity、実行基盤互換、性能などの**技術要件は緩和しない**。一次資料が製品のモデル利用条件での利用（非商用の研究・教育目的）または deployed use を**明示的に禁止している、または intended use から明示的に除外（out-of-scope）している** checkpoint には本経路を適用しない（FR-LIC-015。OpenAI CLIP がこれに該当する）。本経路は外部法務の意見を代替せず、配布主体が変わる場合は再審査する。 | 必須 |
  ```

- 行 654

  ```text
  | NFR-ANN-003 | 補助候補生成中も annotation UI の入力、保存、画面遷移を妨げない。worker 異常終了時も手動 annotation を継続できる。 |
  ```

- 行 655

  ```text
  | NFR-ANN-004 | 同じ image hash、checkpoint hash、prompt、preprocess、threshold、seed の組み合わせでは deterministic inference を使用し、同一候補を再現できる。非決定的演算が残る場合は manifest とレポートに明記する。 |
  ```

- 行 657

  ```text
  | NFR-ANN-006 | 採用候補モデルは、代表的な分類/検出データで manual-only と assisted の比較試験を行い、最終 Ground Truth の品質を悪化させず、annotation 所要時間を短縮することを出荷条件とする。測定条件と結果を model adoption record に保存する。 |
  ```

- 行 797

  ```text
  | POC-03 推論性能 | Windows推奨構成で、承認済み軽量モデルを30分連続実行し、全推論service time 100ms未満、capture-to-display p95 100ms以下、10Hzの全フレーム処理、drop=0を満たす。 |
  ```

- 行 802

  ```text
  | POC-08 ONNX parity | 候補ごとに元モデルと ONNX の出力・評価差が定義した許容範囲内である。許容範囲はモデル採用記録に固定する。 |
  ```

- 行 810

  ```text
  | POC-16 初期モデル支援 | 分類と検出の採用候補ごとに、完全オフライン、CPU/CUDA、installer同梱、license manifest、候補表示、accept/edit/reject、未確認候補の学習除外を確認する。representative gold setでmanual-onlyより最終品質を悪化させずannotation中央所要時間を短縮する。MPSは将来対応とする。 |
  ```

- 行 903

  ```text
  | TBD-06 | 分類・検出の Annotation Assist Model | SigLIP / Florence-2 / Grounding DINO 等は技術候補に留め、checkpoint、学習データ由来、再配布、実機性能、最終 annotation 品質を監査して各 1 つを承認する | 実装着手前、POC-16 完了時 |
  ```

- 行 905

  ```text
  | TBD-08 | モデル支援の有用性 threshold | representative gold set と manual-only baseline を定義し、coverage、最終品質、所要時間の採用基準を class/task ごとに固定する | POC-16 計画時 |
  ```

## 2. 実装計画（原本 2）

- 行 318

  ```text
  | Gate 2 | Windowsで分類/検出のCurated Base WeightとAssist checkpointが法務・hash・実機品質gateを通過し、Windows CPU/acceleratorのAutoML budgetを実測決定。 | 未承認モデルを同梱しない。manual annotation/core のみ継続可。 |
  ```

- 行 414

  ```text
  | SPI-11 | Classification base weight 監査 | `docs/model-governance/classification-base.md` | A-06 | license/data/intended use/re-distribution が全て known。RD TBD-02。 |
  ```

- 行 415

  ```text
  | SPI-12 | Detection base weight 監査 | `docs/model-governance/detection-base.md` | A-06 | 同上。 |
  ```

- 行 416

  ```text
  | SPI-13 | Classification assist 監査 | `docs/model-governance/classification-assist.md` | A-06 | SigLIP等を一次資料・hashで判定。RD §13.3。 |
  ```

- 行 417

  ```text
  | SPI-14 | Detection assist 監査 | `docs/model-governance/detection-assist.md` | A-06 | Florence-2/Grounding DINO等を一次資料・hashで判定。 |
  ```

- 行 418

  ```text
  | SPI-15 | Classification train/export parity | `spikes/models/classification.py`, `spikes/models/classification-result.md` | SPI-11, SPI-08 | 小さな権利確認済み fixture で train→ONNX→CPU parity。 |
  ```

- 行 419

  ```text
  | SPI-16 | Detection train/export parity | `spikes/models/detection.py`, `spikes/models/detection-result.md` | SPI-12, SPI-08 | 同上、box/score/label と mAP差を実測。 |
  ```

- 行 420

  ```text
  | SPI-17 | Assist quality baseline | `spikes/models/assist_benchmark.py`, `spikes/models/assist-result.md` | SPI-13, SPI-14 | gold set で coverage/accept/edit/reject/time を manual-only と比較。 |
  ```

- 行 421

  ```text
  | SPI-18 | Gate 1/2 判定（二部構成） | `docs/adr/0004-spike-decisions.md`, `resources/models/manifest.json` | Gate 1部: A-07, SPI-01/02/05/07/08/10, skip記録SPI-03/09/19。Gate 2部: SPI-11〜17 | 下記のGate別条件で採否・実測値を分けて記録し、全体完了には両部を要求する。SPI-03/09/19をPASSへ変更せず、SPI-04/06は依存せず、未承認modelはmanifestに追加しない。 |
  ```

- 行 424

  ```text
  **SPI-18の二部判定（2026-09-06追記、2026-09-07明示スキップ反映）:** 表の依存欄はSPI-18全体の完了依存であり、次の二つの判定を同じADRへ別々に記録する。新しいSPI IDやGateは追加しない。
  ```

- 行 426

  ```text
  - **Gate 1部:** A-07、およびSPI-01、SPI-02、SPI-05、SPI-07、SPI-08、SPI-10について、既定の完了条件・test・独立レビューがすべてPASSし、SPI-03/09/19の`SKIPPED_BY_USER`と各残存リスクを記録した時点で、SPI-11〜17を待たずにGate 1の`CONDITIONAL_GO`を判断できる。これはcore/manual annotationの開発開始判断に限定し、従来の全PoC architecture feasibility PASSではない。
  ```

- 行 427

  ```text
  - **Gate 2部:** SPI-11〜17の監査・Windows実測、承認済みcheckpoint、parity、assist品質、D-15の有限AutoML budgetを引き続き要求する。素材サンプルやGate 1部の合格をmodel承認へ転用しない。
  ```

- 行 428

  ```text
  - Gate 1部だけ記録してもSPI-18全体を完了にしない。Gate 2未充足ならその部とmodel依存タスクは未完了のまま、Gate 1の`CONDITIONAL_GO`にのみ依存するcore/manual annotationを既存依存順で進める。
  ```

- 行 429

  ```text
  - SPI-03/09/19はスキップでありPASSではない。clean-host onedir、camera→pipeの30分、Windows OS reboot後Referenceの各PoCを別名で開発前提へ戻さず、既存の未実施証拠も書き換えない。一方、PKG-11等の正式package、INF-14/15、DAT-12/15の通常受入は、それぞれの製品機能実装後に独立して検証する。
  ```

- 行 527

  ```text
  ### Phase H — Annotation Assist
  ```

- 行 529

  ```text
  Gate 2 で承認された分類用・検出用 model だけを実装する。候補ごとの汎用 plugin API は作らない。
  ```

- 行 684

  ```text
  | PKG-01 | Model payload verifier | `scripts/models/verify.py`, `scripts/models/verify.test.py`, `resources/models/manifest.json` | AST-01, Gate 2 | manifestの`sourcePath`にある`vendor/models/`のapproved hash/sizeだけを通し、同一bytesを`payloadPath`へ対応付ける。downloadしない。 |
  ```

