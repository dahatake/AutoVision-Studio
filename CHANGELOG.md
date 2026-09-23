# Changelog

このファイルの記載形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従い、バージョン番号は [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

Gate 2 lane（モデル承認）の監査・実測・採用処理を実施しました。分類と検出の学習→ONNX 変換→CPU 推論の一致検証（parity）を実機で測定し、検出側で当初失敗した原因を学習 epoch の掃引によって特定して解消しました。AutoML の有限予算を分類・検出それぞれについて CPU と CUDA の実機測定から確定しました。検出用の基盤重みについては、ライセンス決定権限者の判断により権利ゲートを充足として設定したうえで、実行基盤間の出力一致（CPU・DirectML）を実測し、帰属表示文案と採用記録を作成していったんモデル一覧へ登録しました。その後に推論性能を実測したところ、採用記録の受け入れ基準（レイテンシと処理速度）を満たさないことが判明したため、fail-closed の規定に従って判定を保留へ差し戻し、登録を取り消しています。権利面の判断は取り消していません。承認済みモデルは 0 件、`resources/models/manifest.json` は空・`ready=false` を維持し、Gate 2 は **BLOCKED** のままです。

その後、新設した FR-LIC-016（ライセンス・学習データ条件を確認できない重みに対するリスク受容の経路）に基づき、Gate 2 の残タスクを実行しました。分類用の基盤重み（torchvision の MobileNetV3 Large、ImageNet 学習済み）は、実行基盤間の出力一致・推論性能・初期重みとしての精度・既知脆弱性の照会をすべて測定前に定めた基準で通過したため承認し、モデル一覧へ登録しました。検出用の基盤重みは、後処理のスコア閾値を 0.05 にした場合に限り性能基準を満たすことを実測しましたが、その閾値が製品の推論設定として確定しておらずモデル一覧で強制できないため、保留を維持しています。補助モデルは、画像分類側（SigLIP）が CPU での推論性能が基準に届かず、物体検出側（Grounding DINO tiny）が ONNX 変換後の出力が PyTorch と一致しないため、いずれも保留です。承認済みモデルは 1 件、`ready=false` を維持し、Gate 2 は **BLOCKED** のままです。

さらに、要求定義の学習済みモデルの利用条件を「商用製品へ組み込めること」から「非商用の研究・教育目的での利用と同梱・再配布が許されること」へ訂正し（v0.7 Draft）、この条件で利用できるモデルを再調査しました。ソフトウェアのライセンス条件は変えていません。研究目的限定や非商用限定であることだけではモデルを除外しなくなった一方、製品の条件より狭い制限を持つモデルは書面承認と画面上の明示を要します。OpenAI CLIP は、モデルカードが商用・非商用を問わず実運用を対象外としているため、引き続き除外します。

最後に、所有者の委任に基づき、検出用の基盤重みには実時間推論の基準を適用しない（学習後のモデル版で検証する）と判断し、保留していた検出用の基盤重みを承認してモデル一覧へ登録しました。承認済みモデルは基盤重みの分類・検出の 2 件で、補助モデル 2 役と補助品質の比較試験が未充足のため、`ready=false` を維持し、Gate 2 は **BLOCKED** のままです。

続けて、補助モデル（C7）の残タスクを実行しました。画像分類の補助モデルでは、TinyCLIP の想定用途を一次資料で確認できなかったため候補から外し、SigLIP の CPU 推論の改善として量子化を 1 案だけ試しましたが、出力の一致と推論性能のどちらも基準に届かず、保留を維持しました。物体検出の補助モデルでは、新しい第一候補 OWL-ViT base patch32 の取得物を配布元の値と照合し、ONNX 変換後の出力が PyTorch と一致することを確認しましたが、CPU での推論性能が基準に届かないため保留としました。補助モデルが 2 役とも未承認のため、補助品質の比較試験は実行していません。承認済みモデルは 2 件のまま、`ready=false` を維持し、Gate 2 は **BLOCKED** のままです。あわせて、モデル一覧の形式を改め、出荷可能（`ready=true`）とするには補助モデル 2 役それぞれの比較試験に合格した記録を必須にしました。

その後、`/work/` の残タスク統合実行計画に沿って、実行の前提条件を確認し、利用者・所有者の操作を必要としない調査を行いました。その結果、Gate 2 の実行前提が 3 件満たされていないため、Gate 2 の処理は開始していません。満たされていない前提は、別セッションが計画を編集していないことの利用者による確認、npm `12.0.0` の用意、計画とノード一覧における状態の記録規則の不足です。画面まわりの残課題（親 UIR-025 の残条件 9 件と、UIR-041Q・UIR-084 の前提）を現在のコードと記録から判定し直した結果は、完了 4 件・未完了 7 件でした。すべての残タスクの状態と、再開に必要な利用者の確認・所有者の判断を記録しています。製品コード、モデル一覧、ADR は変更していません。

### Added

- 残タスクの実行記録を追加しました。`work/20260924-0306-RemainTaskRun-Baseline.md` には、実行前提の確認結果（PRE-00〜03）、Gate 2 の計画とノード一覧の SHA-256、両者の照合に使った検査 script `work/20260924-0306-PRE03-InventoryCheck.ps1` の結果、計画を編集するセッションへの修正依頼を記録しています。`work/20260924-0300-UirStatusRedetermination.md` は UIR-025 の残条件と UIR-041Q・UIR-084 の前提を判定し直した記録です。`work/20260924-0325-RemainTaskTerminalState.md` と検査 script `work/20260924-0325-TERM01-Check.ps1` は、全ノードと未完了事項 15 件の終端状態の記録です。Gate 2 の終端化の記録がないため、この終端記録は完了条件を満たしていません（検査は exit 1）。
- 物体検出の補助モデル OWL-ViT base patch32 の一致検証と性能を測る spike `spikes/models/owlvit_assist_parity.py`、結果記録 `spikes/models/owlvit-assist-result.md`、採用記録 `docs/model-governance/owlvit-base-patch32-adoption.md`（保留）を追加しました。一致検証は PyTorch・ONNX Runtime CPU・ONNX Runtime DirectML の 3 経路で合格し、性能は DirectML が基準内、CPU が基準外でした。性能モードは基準未達、または要求した実行基盤で session が作られない場合に非ゼロで終了します。検証用 fixture ではスコア閾値を超える検出が 0 件で、検出単位の一致は未確認であることも記録しています。
- TinyCLIP の一次資料（モデルカード、配布メタデータ、公開リポジトリの README・LICENSE・学習手順、論文の抜粋）の保存コピー `docs/model-governance/evidence/tinyclip-*` を追加しました。想定用途と対象外用途の記載はなく、蒸留元（OpenCLIP ViT-B/16）の重みの系譜も確認できないため、候補から外しています。
- C7 残タスクの実行計画・記録（`work/20260923-1437-C7-RemainingTasksExecutionPlan.md`、`work/20260923-1520-OWLViT-ControlledArtifact.md`、`work/20260923-1546-TinyCLIP-PrimarySourceSurvey.md`、`work/20260923-2003-C7-RemainingTasksExecution.md`）を追加しました。
- `docs/adr/0004-spike-decisions.md` に C7 残タスクの判定（§5.1.14）を、`docs/model-governance/classification-assist.md`（§22・§23）と `docs/model-governance/detection-assist.md`（§22）に候補ごとの結果を追加しました。
- 非商用の研究・教育目的を前提とした利用可能モデルの再調査記録 `work/20260923-1015-NonCommercialModelSurvey.md` を追加しました。物体検出の補助モデルでは OmDet-Turbo が第一候補、今回の訂正で新たに対象となった OWL-ViT が次点です。画像分類の補助モデルには、すべての要件を満たす候補がまだありません。本調査は採用決定ではなく、取得・変換・一致検証・性能測定は未実施です。
- Gate 2 残タスクの判断根拠となる、2026-09-23 付けのリポジトリ所有者によるリスク受容の書面 `docs/model-governance/evidence/2026-09-23-owner-risk-acceptance.md` を追加しました。対象は分類用基盤重み（MobileNetV3 Large）と物体検出の補助モデル（Grounding DINO tiny の Hugging Face 配布版）の 2 件に限定し、対象外の成果物と、確認できなかった項目を列挙しています。publisher による許諾の表明ではありません。
- 分類用基盤重みの一致検証・性能・初期重みとしての精度を測る spike `spikes/models/classification_checkpoint_parity.py` と結果記録 `spikes/models/classification-checkpoint-result.md`、および採用記録 `docs/model-governance/mobilenet-v3-large-imagenet1k-v2-adoption.md`（承認、承認者 dahatake、2026-09-23）を追加しました。初期重みとしての精度は乱数初期化と同点の偶然水準であり、有益性を示すものではないことを記録しています。
- 補助モデルの一致検証と性能を測る spike `spikes/models/siglip_assist_parity.py`・`spikes/models/grounding_dino_assist_parity.py`、結果記録 `spikes/models/siglip-assist-result.md`・`spikes/models/grounding-dino-assist-result.md`、採用記録 `docs/model-governance/siglip-base-patch16-224-adoption.md`・`docs/model-governance/grounding-dino-tiny-adoption.md`（いずれも保留）を追加しました。これらの spike は製品の依存関係に含めない隔離環境でのみ実行し、製品のロックファイルは変更していません。
- 判断根拠の一次資料（torchvision の MobileNetV3 モデル説明と重み定義、学習レシピ、ImageNet の利用条件、補助モデル 2 件のモデルカードと配布メタデータ、検出側の学習レシピ）の保存コピーを `docs/model-governance/evidence/` に追加しました。保存コピーを改行変換から保護するため `.gitattributes` に対象ディレクトリを追加しています。
- 検出用基盤重みの一致検証 spike に、後処理のスコア閾値を指定する `--score-thresh` と、初期重みとしての精度を乱数初期化と比較する `--mode transfer` を追加しました。性能モードは受け入れ基準で合否を判定し、未達なら非ゼロで終了します。
- `scripts/models/manifest-schema.test.mjs` に、登録済みの各モデルの値（ハッシュ、取得元、根拠資料、承認者、学習データ等）が採用記録に記載されていること、およびリスク受容に基づく帰属表示に必要な開示文が含まれることを確認する検査を追加しました（38 件）。

- 分類の学習→ONNX 変換 parity を実測する spike `spikes/models/classification.py` と結果記録 `spikes/models/classification-result.md`（SPI-15 / G2-05）。AutoML 試行コストを測る `--mode automl-mini-run` を含みます。
- 検出の学習→ONNX 変換 parity を実測する spike `spikes/models/detection.py` と結果記録 `spikes/models/detection-result.md`（SPI-16 / G2-06）。学習 epoch を変えて原因を切り分ける `--epochs` を含みます。
- Annotation Assist 品質 baseline の測定 harness `spikes/models/assist_benchmark.py` と結果記録 `spikes/models/assist-result.md`（SPI-17 / G2-07）。承認済みモデルが無い場合に fail-closed で停止します。
- 取得済み検出 checkpoint の実行基盤間の出力一致を実測する spike `spikes/models/detection_checkpoint_parity.py` と結果記録 `spikes/models/detection-checkpoint-parity-result.md`（SPI-12 / G2-02 の DP-01・DP-04）。PyTorch・ONNX Runtime CPU・ONNX Runtime DirectML の 3 経路を比較し、DirectML が利用できない環境では測定せず停止します。
- 検出用基盤重み SSDLite320 MobileNetV3 Large（COCO_V1）の採用記録 `docs/model-governance/ssdlite320-mobilenet-v3-large-coco-v1-adoption.md` を作成しました。権利面の決定者は dahatake、決定日は 2026-09-22 です。帰属表示文案はアーキテクチャコード・重み・学習データの 3 層を分けて記載しています。最終判定は性能実測の結果により保留です。
- 判断根拠となる一次資料の保存コピーを `docs/model-governance/evidence/` に追加しました（TorchVision のライセンス、COCO の利用条件、TorchVision のモデル説明ページ、および所有者によるリスク受容の記録）。各コピーの SHA-256 は採用記録に記載しています。検出用基盤重みは保留のため、これらのうち COCO の利用条件、SSDLite のモデル説明ページ、2026-09-22 のリスク受容記録を参照するモデル一覧の登録は現在ありません（TorchVision のライセンスは分類用基盤重みの登録から参照しています）。
- 検出の AutoML 試行コストを測る `--mode automl-mini-run` と、実行デバイスを選ぶ `--device` を `spikes/models/detection.py` へ追加しました。学習枚数を割った端数が 1 になるバッチサイズを自動で除外します。一致検証モードは従来どおり CPU 固定で、それ以外の指定を拒否します。
- 検出 checkpoint の推論性能（レイテンシ・処理速度・ピークメモリ）を測る `--mode performance` を一致検証 spike へ追加しました。メモリは標準ライブラリのみで取得し、新しい依存を増やしていません。
- `docs/adr/0004-spike-decisions.md` に Gate 2 lane の実行記録（§5.1）を追加しました。
- `docs/model-governance/classification-base.md` に、事前学習重み候補 8 件の再調査結果（§12）を一次資料 URL と取得日付きで追加しました。
- `docs/model-governance/detection-base.md`・`classification-assist.md`・`detection-assist.md` に、利用者の採用指示と controlled retrieval の実測記録を追加しました。

### Changed

- `resources/models/manifest.json` の `releaseStatus.reason` に、C7 残タスクの結果（SigLIP の量子化が出力の一致と CPU 推論性能の基準を満たさなかったこと、TinyCLIP を候補から外したこと、OWL-ViT の CPU 推論性能が基準外であること）を追記しました。登録モデルと `ready=false` は変えていません。
- `spikes/models/siglip-assist-result.md`（§7）と `docs/model-governance/siglip-base-patch16-224-adoption.md`（§16）に、CPU 推論の改善として試みた量子化（ONNX Runtime の動的量子化）の結果を追記しました。PyTorch との出力の差が許容差を大きく超え（15 枚中 3 枚で最上位の候補が変わる）、CPU の推論性能も基準に届かないため、保留を維持します。同じ手順で再測定できるよう、量子化の経路を spike に残しています。
- モデル一覧の schema `resources/models/manifest.schema.json` を `2.0.0` に改め、`releaseStatus.ready=true` とするには、補助モデルの分類・検出それぞれについて、補助なしの作業と比べて最終品質が悪化せず作業時間の中央値が短縮したことを示す記録（`releaseStatus.assistQuality`）を必須にしました（NFR-ANN-006 / POC-16）。出荷可能と判定していた既存の条件を狭める変更のため、メジャーを上げています。`resources/models/manifest.json` の `schemaVersion`、`scripts/models/manifest-schema.test.mjs`（否定 test 8 件を追加）、`docs/dependency-policy.md`、`docs/model-governance/adoption-template.md` を合わせて更新しました。
- 補助品質の測定 harness `spikes/models/assist_benchmark.py` を、新しい schema と循環しないよう `ready=true` を前提条件から外し、補助あり・補助なしの作業記録が同じ gold set の項目だけを 1 回ずつ含むことの検査、記録の型（項目 ID・提案の有無・有限で負でない秒数）の検査、作業時間の中央値の出力を加えました。
- `docs/implementation-plan.md` の D-15（AutoML の最大 Trial 数・最大時間）を、Windows 実機の測定値に基づく有限予算へ更新しました。分類は最大 Trial 数 20、最大時間が CPU 180 秒・CUDA 120 秒です。検出は利用者の許可を得た暫定測定に基づき、最大 Trial 数 20・CPU 420 秒・CUDA 120 秒としました。実運用規模の予算は未決定のまま保持します。
- `docs/adr/0004-spike-decisions.md` の `SKIPPED_BY_USER` 一覧に、利用者指示による SPI-17 段階 3（実作業セッションの記録）を追加しました。スキップは合格への読み替えではなく、NFR-ANN-006 の出荷条件は未充足のまま残ります。
- 検出用 Curated Base Weight（SPI-12 / G2-02）の権利ゲートを、ライセンス決定権限者の判断に基づき充足として設定しました。根拠書面は後日提出予定であり、この設定は publisher によるライセンス表明の存在を意味しません。
- 補助モデル（SPI-13 / SPI-14、分類・検出）の権利ゲートについても、同じ権限者の判断により充足として設定しました。モデル一覧への登録は、実行基盤の一致検証と採用記録の作成を待ちます。検出の補助モデルは publisher の外部コード実行を伴うため、セキュリティ審査も未通過です。
- SSDLite320-MobileNetV3 の実チェックポイントについて、PyTorch と ONNX Runtime（CPU および DirectML）の出力一致を実測し、モデル一覧登録の前提であった実行基盤検証の未実施項目を解消しました。3 比較とも検出 294 件が完全に対応し、座標の最大差は許容値の約 7 分の 1 です。この実測は承認ではなく、精度の主張も含みません。YOLOX-Nano の同検証は未実施です。
- `resources/models/manifest.json` に検出用基盤重みを 1 件登録し、状態説明文を部分承認の内容へ更新しました。リリース可否は `ready=false` のままです。重みのライセンス識別子には、SPDX のローカル参照構文による `LicenseRef-AutoVisionStudio` を用いています。これは publisher による許諾表明ではなく、リポジトリ所有者のリスク受容に基づく記載です。**その後の性能実測により登録は取り消し、モデル一覧は空へ戻しました。**
- 検出用基盤重みの最終判定を、推論性能の実測結果に基づいて保留へ差し戻しました。レイテンシと処理速度が採用記録の受け入れ基準を満たさないため、採用テンプレートの規定（必須項目が不適合なら承認と記入できない）に従った措置です。権利面の決定は取り消していません。再登録には、最適化した推論経路での基準充足、基盤重みへの実時間推論基準の適用可否の裁定、または性能未達の受容のいずれかが必要です。
- AutoML の予算に検出の CUDA 値（最大 20 試行 / 120 秒）を追加しました。あわせて、CPU では試行結果が 2 回とも完全に一致する一方、CUDA では一致しない（この条件の CUDA 学習は非決定的である）ことを記録しました。
- `scripts/models/manifest-schema.test.mjs` を、モデル一覧が空であることを前提とする検査から、部分承認の内容を検証する検査へ更新しました。あわせて、参照している根拠資料と採用記録が実在し SHA-256 が一致することを確認する検査を追加しました（36 件）。
- 補助品質ベンチマークの停止理由の文面を、現在の未充足要因（権利ではなく実行基盤の一致検証と採用記録）へ更新しました。
- 独立レビューの指摘に基づき、モデル承認に関する各記録の状態記述を登録後の内容へ同期しました。検出用基盤重みの調査記録には承認と登録の記録を追記し、過去の調査時点の記述はその旨を明示したうえで保持しています。判断記録の概要と、補助モデルの各調査記録、一致検証の結果記録についても、現状と矛盾する記載を修正しました。

- 要求定義に FR-LIC-016 を新設し、publisher の一次資料から確認できない重みライセンス・学習データ条件について、リポジトリのライセンス決定権限者による受容を条件付きで認める経路を定めました。条件は、未確認項目の列挙、氏名と日付を伴う書面決定、SPDX のローカル参照識別子への置き換え、アプリ内表示と帰属表示ファイルでの開示、そして技術要件（ハッシュ・安全形式・一致検証・実行基盤互換・性能）を緩和しないことです。一次資料が商用利用や実運用を明示的に禁止または対象外としている重みには適用しません。
- 上記に合わせて、既存のライセンス要件（部品の個別承認、ImageNet 由来、COCO 由来、補助モデル）と依存関係ポリシーの失敗時規則、承認ゲートの記述、開発規約、実装計画の要求対応表を整合させました。未確定語彙をそのまま登録することは引き続きできません。
- 要求定義書を v0.6 Draft（246 要求）へ更新し、README の基準版宣言とハッシュを同期しました。
- 緩和後のライセンス要件で採用可能なモデル候補を、一次資料を取得して調査しました（`work/20260923-0546-RelaxedLicenseModelSurvey.md`）。分類の基盤重みは既存依存の torchvision の ImageNet 学習済み重みが第一候補、補助モデルは画像分類側と検出側それぞれに、追加コードの実行を必要としない配布形態の候補が存在することを確認しました。研究用途を前提と明記しているモデルは、ライセンスではなく想定用途の不適合により対象外としています。本調査は採用決定ではなく、取得・ハッシュ再計算・変換・一致検証・性能測定はいずれも未実施です。
- `resources/models/manifest.json` に分類用基盤重み（MobileNetV3 Large、ImageNet 学習済み）を登録し、状態説明文を現在の承認状況と未達理由へ更新しました。重みのライセンス識別子はリポジトリローカルの `LicenseRef-AutoVisionStudio` で、帰属表示文にリスク受容である事実と未確認項目を明記しています。`ready=false` のままです。
- 検出用基盤重みを後処理のスコア閾値 0.05 で再測定し、出力一致（既定閾値と全桁一致）と性能基準の充足、初期重みとしての精度が乱数初期化を上回ることを確認しました。いったん承認して登録しましたが、敵対的レビューの指摘（閾値が製品の推論設定として未確定で、モデル一覧では強制できない）を受け、同日に保留へ戻して登録を取り消しました。再開には、検出の後処理閾値の確定、または基盤重みへの実時間推論基準の適用可否に関する所有者の判断が必要です。
- 検出用基盤重みの採用記録で未調査だった既知脆弱性を GitHub Advisory Database で照会し、Critical/High が 0 件であることを記録しました。学習レシピの保存コピーも追加しています。
- ADR-0004 に Gate 2 残タスクの実行記録（§5.1.12）を追加し、分類・検出の各調査記録に 2026-09-23 の評価結果への参照を追記しました。
- 要求定義書を v0.7 Draft（246 要求、件数は不変）へ更新し、学習済みモデルの利用条件を「非商用の研究・教育目的」へ訂正しました。対象は製品価値、実現性判定、ライセンス要件（FR-LIC-002 / 003 / 006 / 012 / 014 / 016）、基盤重みの許可条件、リスク、PoC・受入条件、要求対応表、用語定義です。モデル一覧の許諾フィールド名の改訂を未決事項 TBD-09 として追加し、README の基準版宣言とハッシュを同期しました。
- 上記に合わせて、依存関係ポリシーの禁止カテゴリーと補助モデルの規則、採用記録テンプレートの確認項目、補助モデルの各調査記録（v0.7 以降の読み替え表）を整合させました。
- 分類用基盤重み（MobileNetV3 Large）の採用記録とモデル一覧の帰属表示に、同梱が非商用の研究・教育目的に限られることと、許諾フィールドがこの利用条件での許可を表すことを追記しました。
- 所有者の委任に基づく判断の記録 `docs/model-governance/evidence/2026-09-23-owner-rulings.md` を追加しました。検出用基盤重みは初回学習に用いる重みであり、カメラ推論の対象は学習後のモデル版であるため、基盤重みの採用判定には実時間推論の基準を適用しないこととしました（実時間推論の基準は、推論機能の実装時に学習後のモデル版で検証し、緩和しません）。あわせて、OWL-ViT 系のモデルカードが教育目的に言及しない点は、製品の利用条件より狭い制限として扱うこととしました。
- 物体検出の補助モデルの新候補について、所有者（dahatake、Product Manager）による 2026-09-23 付けのリスク受容の書面 `docs/model-governance/evidence/2026-09-23-owner-risk-acceptance-c7-detection.md` を追加しました。対象は OWL-ViT base patch32 で、研究目的に限って提供する条件付きです。重みを取得し、計算したハッシュが配布元の公開値と一致することを確認しています。第一候補としていた OmDet-Turbo は、追加調査で文字列処理部分が OpenAI CLIP の重みから構築されていると判明したため（OpenAI CLIP のモデルカードは実運用を対象外とする）、対象から外して保留にしました。採用決定ではなく、一致検証・性能・補助品質の測定と、採用時の所有者の署名が必要です。
- 上記の判断に基づき、検出用基盤重み（SSDLite320 MobileNetV3 Large）の採用記録を承認とし、モデル一覧へ登録しました（承認済み 2 件、`ready=false` のまま）。関連する調査記録・判断記録・結果記録の現状記述を更新しています。

### Removed

- 検出 checkpoint の一致検証 spike から、どこからも使用されず、指定された場合に観測していないパスを結果へ記録しうる `--checkpoint` オプションを削除しました。対象ファイルは固定の定数から解決し、結果に記録するパスは実際のパスから導出します。削除後に再実行し、3 比較の判定と生成 ONNX のハッシュが変わらないことを確認しています。

### Fixed

- 検出 parity の判定が、学習不足により検出スコアが密集した条件で失敗していた問題を解消しました。スコアが分離する条件で PyTorch と ONNX Runtime の検出集合が完全に一致し、AP@0.5 の差が 0 になることを実測しました。
- 検出 parity の平均適合率が VOC 方式の補間になっていなかった実装を修正しました。
- 検出 parity で、順位整列による参考比較がラベル不一致の判定へ二重に計上されていた問題を修正しました。
- 検出 parity で、スコア閾値以上の検出が存在しない画像があるとスコア範囲の集計が異常終了しうる問題を修正しました。
- 分類 spike の parity モードが、実行デバイスの指定を無言で受理して決定性を無効化しうる問題を修正しました。parity モードは CPU 固定とし、それ以外の指定を拒否します。

### Security

- 採用候補の checkpoint 7 件について、制限付き読み込み（`weights_only=True`）と safetensors ヘッダー解析による payload 検証を実施し、いずれもテンソルと基本型のみで構成されることを確認しました。これにより FR-SEC-007 の未実施項目を解消しました。
