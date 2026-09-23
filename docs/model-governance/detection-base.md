# SPI-12 — 検出 Curated Base Weight 監査記録

> **厳格な fail-closed research record / 法的助言ではない**
> 本記録は公開一次資料から確認できた技術情報と不足証拠を分離して記録する。法的助言、利用許諾、採用承認ではない。C5 コードの permissive license を C6 checkpoint または C8 学習データへ拡張しない。必須項目に `UNKNOWN`、`MISSING`、`NOT_RUN` のいずれかが一つでも残る限り、対象 weight を同梱、既定選択、Fine-Tuning、変換、または manifest 登録してはならない。

## 0. 記録メタデータと結論

| 項目 | 値 |
|---|---|
| タスク | SPI-12 — Detection base weight 監査 |
| カテゴリー | C6（Curated Base Weight） / C5（構造コード） / C8（学習元データ）を独立審査 |
| 対象用途 | ローカル物体検出 Fine-Tuning の基盤重み |
| 調査日・URL 取得日 | **2026-09-03** |
| 記録作成者 | GitHub Copilot（技術調査のみ。承認権限なし） |
| プロジェクトの直接依存 pin | `torch==2.11.0`、`torchvision==0.26.0`（`ml/pyproject.toml`） |
| TorchVision 固定ソース | `pytorch/vision@336d36e8db990a905498c73933e35231876e28bc`、`version.txt = 0.26.0` |
| PyTorch loader 調査ソース | `pytorch/pytorch@70d99e998b4955e0049d13a98d77ae1b14db1f45`。同 commit の `version.txt` は `2.11.0a0` のため、`torch==2.11.0` wheel の正確な source provenance の証明には使わず、当該 source snapshot の loader 挙動だけに使用 |
| 法務・repository license decision authority の署名 | **利用者の risk acceptance を 2026-09-22 に受領**（§15）。**法務確認そのものは未実施** |
| 承認者・承認日 | **dahatake / 2026-09-22**（§15.6 の採用記録で氏名を確定。根拠書面は後日提出） |
| 再審査期限 | **MISSING**。§12 の解除証拠が揃った場合、または artifact、license、dataset terms、製品用途が変わった場合に再審査する |
| checkpoint binary download | **実施済み（2026-09-22）**。§14.2 に byte size・SHA-256・安全 load の実測を記録。**推論・ONNX export は未実施** |
| 最終判定 | **SSDLite320-MobileNetV3 Large は承認（§15.10、2026-09-23）**。権利 gate は充足、hash・安全 load・parity・対象用途の精度・CVE 照会は通過。推論性能（既定後処理で不適合、`score_thresh=0.05` で適合）は、owner 裁定 D1 により C6 の判定に用いない。**YOLOX-Nano は未承認のまま**（parity 未実施・DB-T1 未解消） |
| G-DEP-07 / Gate 2 | **検出 C6 の権利要件は充足扱い。Gate 2 全体は BLOCKED**（2026-09-23 時点で分類 C6・検出 C6 は承認済み。分類 C7・検出 C7 が未充足、SPI-17 は `NOT_RUN`） |
| SPI-12 完了条件 | **権利 gate は利用者決定で充足。license / data / intended use / redistribution の一次資料は依然 known ではない**（§15.2） |
| manifest | **登録**（`ssdlite320-mobilenet-v3-large-coco-v1`、§15.10）。§15.8 で取り消し、§15.9 で一度再登録した後に同日取り消した経緯がある。manifest は分類 C6・検出 C6 の 2 件、`releaseStatus.ready=false` |

### 0.1 状態語

| 状態 | 意味 |
|---|---|
| `UNKNOWN` | 一次資料から事実を確定できない |
| `MISSING` | 必須の証拠文書、保存コピー、署名、hash、NOTICE 等が存在しない、または本調査で確保できていない |
| `NOT_RUN` | 技術試験または実測を実行していない |
| `HOLD` | 未承認。解除証拠が揃うまで同梱・製品利用・manifest 登録不可 |

`UNKNOWN` を推測で埋めず、`MISSING` を URL の存在だけで充足とせず、`NOT_RUN` を upstream 公開値で代替しない。

### 0.2 候補別判定

> **本項は 2026-09-03 調査時点の判定である。** 2026-09-22 の controlled retrieval（§14）により完全 SHA-256・safe load・asset 同定が解消し、同日の利用者決定（§15）により権利 gate が充足扱いとなった。**現在の判定は §15.5 を参照すること。**

| 候補 | 厳密な対象 | 判定 | 主な停止理由 |
|---|---|---|---|
| TorchVision SSDLite320-MobileNetV3 Large | `SSDLite320_MobileNet_V3_Large_Weights.COCO_V1` / `ssdlite320_mobilenet_v3_large_coco-a79551df.pth` | **HOLD（2026-09-03 時点）**。→ 現在は **承認（§15.10）** | 当時の停止理由: checkpoint 固有 license、商用利用、再配布条件、完全 SHA-256、COCO 各画像の権利 chain、保存済み一次資料、承認署名、safe load、ONNX/parity/実機試験が不足。このうち性能以外は解消し、性能は後処理閾値の条件付きでのみ合格した |
| YOLOX-Nano | YOLOX release `0.1.1rc0` asset ID `42724999` / `yolox_nano.pth` | **HOLD** | release API の `digest: null`、checkpoint 固有 license と完全 provenance が不足。固定 README の別配布 URLと選択 asset の等価性、および tag source と release note の前処理が未解決。COCO 画像権利、保存済み一次資料、承認署名、safe load、ONNX/parity/実機試験も不足 |

この `HOLD` は AutoVision Studio の現行証拠ゲートに対する判断であり、第三者一般の利用を違法と判断するものではない。

## 1. 適用した fail-closed 規則

| 規則 | 本記録での適用 |
|---|---|
| `docs/dependency-policy.md` §3 | `UNKNOWN`、研究限定、非商用限定、用途制限を承認へ読み替えない |
| 同 §4 / FR-LIC-005 | C5 コード、C6 checkpoint、C8 学習データを別々に判定する |
| 同 §5 | 浮動 alias ではなく exact enum、tag、commit、asset ID、file 名を記録する |
| 同 §6.1 / FR-LIC-004 | 名称、版、URL、64 桁 SHA-256、checkpoint license、データ由来・terms、再配布、NOTICE、一次資料保存 hash、承認者、承認日を必須とする |
| 同 §9 / FR-LIC-011 | 製品 runtime のモデル download を禁止する |
| 同 §10 | 証拠未完の C6 を追加、lock、manifest 登録しない |
| 同 §12 | G-DEP-07 の必須項目に不足があるため Gate 2 を停止する |
| FR-LIC-006 | ImageNet 由来が不明または存在する weight を自動的に商用可としない |
| FR-LIC-007 | COCO annotations と画像権利を分離し、COCO 由来 weight を自動承認しない |
| FR-LIC-008 | Open Images 非使用を完全 provenance なしに断定しない |
| FR-SEC-007 | `.pth`、`state_dict`、既知 loader という名称だけで安全形式と判定しない |

## 2. Candidate A — TorchVision SSDLite320-MobileNetV3 Large

### 2.1 厳密な識別情報と artifact metadata

| 項目 | 値 |
|---|---|
| 正式 API 名 | `torchvision.models.detection.ssdlite320_mobilenet_v3_large` |
| exact enum | `SSDLite320_MobileNet_V3_Large_Weights.COCO_V1` |
| `DEFAULT` alias | 固定 TorchVision source では `DEFAULT = COCO_V1`。将来版の alias は採用根拠にしない |
| 構造コード version / commit | `torchvision 0.26.0` / `336d36e8db990a905498c73933e35231876e28bc` |
| checkpoint file | `ssdlite320_mobilenet_v3_large_coco-a79551df.pth` |
| 公式 URL | `https://download.pytorch.org/models/ssdlite320_mobilenet_v3_large_coco-a79551df.pth` |
| HTTP metadata 上の正確な size | `14,069,355` bytes。2026-09-03 の body 非取得調査値。HTTP metadata の保存コピーは **MISSING** |
| enum metadata の `_file_size` | `13.418`。upstream の近似 metadata であり、正確な byte size または hash の代替にしない |
| 公式 SHA-256 情報 | filename の `a79551df` のみ |
| 完全 SHA-256 | **UNKNOWN**。`a79551df` を 64 桁へ補完しない |
| hash 検査の意味 | 固定 TorchVision source は `check_hash=True` を渡す。調査した PyTorch Hub source は filename の 8 桁以上を SHA-256 **prefix** として比較するだけ |
| パラメータ数 | upstream metadata: `3,440,060` |
| upstream 公開指標 | COCO val2017 `box_map = 21.3`。AutoVision Studio の実測ではない |
| checkpoint 本体の取得・再 hash | **NOT_RUN** |

### 2.2 C5 — 構造コード

| 項目 | 調査結果 |
|---|---|
| repository | `https://github.com/pytorch/vision` |
| 固定 commit | `336d36e8db990a905498c73933e35231876e28bc` |
| code license | `BSD-3-Clause` |
| code の利用・再配布条件 | source/binary 再配布時の copyright notice、条件、免責文の保持、および権利者・contributor 名による endorsement 禁止を license 本文で確認 |
| NOTICE inventory | 固定 commit の recursive tree API は `truncated: false` で、basename が `NOTICE` または `NOTICE.*` の path は 0 件。これは最終配布 packet の完成を意味せず、製品 payload の license / copyright / attribution packet は **MISSING** |
| 判定 | **C5 license text identified / 条件付き確認**。これは C6/C8 の許可ではなく、製品 payload の notice 完了も意味しない |

TorchVision 文書自身が、pre-trained model には学習 dataset 由来の独自 license / terms があり得て、用途の permission を利用者が判断する責任があると明記する。この注意を BSD-3-Clause で上書きしない。

### 2.3 C6 — exact checkpoint

| 項目 | 調査結果 |
|---|---|
| checkpoint 固有 license | **UNKNOWN** |
| checkpoint license の immutable 文書 | **MISSING** |
| copyright / rightsholder | **UNKNOWN** |
| 商用利用 | **UNKNOWN** |
| installer への再配布 | **UNKNOWN** |
| Fine-Tuning・形式変換・派生 weight の条件 | **UNKNOWN** |
| checkpoint 固有 NOTICE / attribution | **UNKNOWN / MISSING** |
| 64 桁 SHA-256 | **UNKNOWN** |
| publisher signature / checksum manifest | **MISSING** |
| exact artifact の build provenance | **UNKNOWN**。enum と recipe link はあるが、exact bytes の builder、入力 snapshot、生成ログ、署名を結ぶ保存済み chain of custody はない |
| C6 判定 | **HOLD** |

BSD-3-Clause は取得した TorchVision C5 code の license である。weight file の名称、公式配布 host、公開 benchmark、短い hash prefix は、checkpoint 固有の商用利用・再配布許諾を構成しない。

### 2.4 C8 — 学習データ由来

| 項目 | 調査結果 |
|---|---|
| 公称 training dataset | COCO。weight metadata は COCO val2017 指標を示し、固定 detection recipe は `--dataset coco` を指定 |
| 固定 recipe の主な設定 | 8 GPU、660 epochs、cosine annealing、LR `0.15`、batch size `24`、weight decay `0.00004`、`ssdlite` augmentation |
| recipe と exact bytes の関係 | metadata は「paper と similar な recipe」と記載するだけで、exact artifact の完全な再現 provenance は **UNKNOWN** |
| 公開 recipe の backbone initialization | 固定 `train.py` は CLI 既定値 `None` を `weights_backbone` へ渡し、固定 README の SSDLite command は `--weights-backbone` を指定しない。したがって、その公開 recipe 実行経路は pretrained backbone weight を要求しない |
| exact artifact の backbone lineage | **UNKNOWN**。公開 recipe と exact checkpoint bytes を結ぶ生成記録がないため、選択 artifact が ImageNet 非由来だとは証明しない |
| その他の学習・事前学習データ | **UNKNOWN** |
| COCO annotations / website | COCO Consortium が CC BY 4.0 と明記 |
| COCO images | COCO Consortium は画像 copyright を所有しないと明記し、利用者に Flickr 条件への準拠と責任を求める |
| 画像ごとの権利 | **UNKNOWN**。Flickr には CC BY、CC BY-SA、CC BY-NC、CC BY-ND、CC0 等の異なる選択肢があり、COCO 学習画像ごとの license snapshot、権利者、帰属、人物・商標等の追加権利 inventory は **MISSING** |
| annotation license と画像 license の関係 | CC BY 4.0 が適用されるのは COCO annotations / website。全画像または checkpoint 自体を一括して CC BY 4.0 としない |
| checkpoint の商用利用・再配布への影響 | **UNKNOWN**。dataset terms が weight へ継承する／しないという法的結論を本記録は出さない |
| legal approval | **MISSING** |
| C8 判定 | **不適合状態（必須証拠不足）** |

CC BY 4.0 は licensor が権限を持つ copyright 等だけを許諾し、privacy、publicity、trademark 等の全権利を解消しない。annotation の attribution 条件を確認したことは、COCO 全画像の商用学習権または派生 checkpoint 再配布権の確認にはならない。

### 2.5 upstream task / preprocess / output

| 項目 | 固定 source から確認できた内容 | 製品側状態 |
|---|---|---|
| task | 物体検出 | 対応候補だが未承認 |
| input | PIL image、single `(C,H,W)`、batched `(B,C,H,W)` を preset が受け、float `[0,1]` へ変換。SSD model は画像ごとの `(C,H,W)` tensor list を受ける | exact product input contract は **UNKNOWN** |
| internal shape | fixed `320 × 320` | ONNX 固定 shape は **NOT_RUN** |
| normalization | model 内部 defaults は mean/std とも `(0.5, 0.5, 0.5)` で `[0,1]` を概ね `[-1,1]` へ変換 | train/export/runtime の同一性は **NOT_RUN** |
| output | image ごとの `boxes[N,4]` (`xyxy`、元画像範囲)、`labels[N]`、softmax-based `scores[N]` | project class mapping は **UNKNOWN** |
| upstream postprocess defaults | score threshold `0.001`、NMS `0.55`、top-k candidates `300`、detections/image `300` | 採用 threshold policy ではない。製品既定値は **UNKNOWN** |
| label set | TorchVision の COCO category metadata、model class count は background 込み 91 | custom project schema への head 置換・index mapping は **UNKNOWN** |
| score meaning | class softmax score after SSD postprocess | calibration / correctness probability は **NOT_RUN** |
| prompt | `N/A（C6 物体検出）` | — |
| deterministic inference | upstream source に deterministic product guarantee なし | **NOT_RUN / UNKNOWN** |

## 3. Candidate B — YOLOX-Nano

### 3.1 厳密な識別情報と release asset

| 項目 | 値 |
|---|---|
| 正式名称 | YOLOX-Nano |
| repository | `https://github.com/Megvii-BaseDetection/YOLOX` |
| tag | `0.1.1rc0` |
| tag が指す commit | `e1052df71842031413f6030723c3607b839c80ce`（Git ref API の object type は `commit`） |
| release ID / 名称 | `48035658` / `0.1.1 pre release` |
| checkpoint file | `yolox_nano.pth` |
| release asset ID | `42724999` |
| 公式 asset URL | `https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.pth` |
| exact byte size | `7,694,953` bytes（GitHub release API） |
| GitHub release API digest | **`digest: null`** |
| 完全 SHA-256 | **UNKNOWN**。`null` から hash を生成・推定しない |
| checkpoint 本体の取得・再 hash | **NOT_RUN** |
| upstream 公開仕様 | 固定README/model zooのstorage assetについて input `416 × 416`、0.91M params、1.08G FLOPs、COCO val AP 25.3。選択したrelease asset ID `42724999`へこの値を転用しない。AutoVision Studio の実測ではない |

### 3.2 source / asset linkage の未解決点

1. 固定 commit の README にある YOLOX-Nano benchmark の GitHub weight link は、選択した YOLOX repository release asset ではなく、`https://github.com/Megvii-BaseDetection/storage/releases/download/0.0.1/yolox_nano.pth` を指す。
2. 選択した `0.1.1rc0` asset ID `42724999`は `7,694,953` bytes、README/model zooの`storage/0.0.1` asset ID `40804716`は `7,653,737` bytesで、**byte-identicalではない**（差 `41,216` bytes）。tensor等価性、変換関係、どちらがどの公開指標に対応するかは **UNKNOWN**、publisher equivalence/provenance statementは **MISSING**。
3. release note は「mean/std の normalization を除去し、旧 weight は incompatible」と述べる。一方、tag が指す固定 commit の `tools/demo.py` は `(0.485, 0.456, 0.406)` / `(0.229, 0.224, 0.225)` を `preproc` に渡し、`preproc` は `/255`、mean subtraction、std division を実行する。
4. したがって、選択 asset がどの source revision、前処理、training configuration で生成されたかは **UNKNOWN**。tag 名と asset 同梱だけで exact build provenance を推定しない。

### 3.3 C5 — 構造コード

| 項目 | 調査結果 |
|---|---|
| 固定 code | `Megvii-BaseDetection/YOLOX@e1052df71842031413f6030723c3607b839c80ce` |
| code license | `Apache-2.0` |
| code の利用・再配布条件 | Apache-2.0 本文の license copy、変更表示、copyright / patent / trademark / attribution notice 保持、存在する NOTICE の伝播等を要する |
| patent 条項 | Apache-2.0 §3 の contributor patent grant を確認。ただし exact checkpoint や training images の権利へ拡張しない |
| repository NOTICE inventory | 固定 commit の recursive tree API は `truncated: false` で、basename が `NOTICE` または `NOTICE.*` の path は 0 件。これは attribution 不要の証明ではなく、製品配布 packet は **MISSING** |
| product dependency adoption | YOLOX code は現行 project lock に採用されていない。transitive dependency / CVE / packaging 審査は **NOT_RUN** |
| 判定 | **C5 license text identified / 条件付き確認**。C6/C8 の許可ではない |

### 3.4 C6 — exact checkpoint

| 項目 | 調査結果 |
|---|---|
| checkpoint 固有 license | **UNKNOWN** |
| checkpoint license の immutable 文書 | **MISSING** |
| release body の license statement | checkpoint へ適用される明示 statement を確認できず **MISSING** |
| copyright / rightsholder | **UNKNOWN** |
| 商用利用 | **UNKNOWN** |
| installer への再配布 | **UNKNOWN** |
| Fine-Tuning・ONNX 変換・派生物条件 | **UNKNOWN** |
| checkpoint 固有 NOTICE / attribution | **UNKNOWN / MISSING** |
| 64 桁 SHA-256 | **UNKNOWN**。release API は `digest: null` |
| publisher signature / checksum manifest | **MISSING** |
| exact source / asset provenance | **UNKNOWN**。§3.2 の URL と前処理の不一致が未解決 |
| C6 判定 | **HOLD** |

Apache-2.0 repository license は C5 code の license としてのみ記録する。release asset が同じ repository に置かれていることだけでは、checkpoint bytes、学習データ由来の権利、商用利用、再配布条件を確定しない。

### 3.5 C8 — 学習データ由来

| 項目 | 調査結果 |
|---|---|
| 公称 training/evaluation dataset | COCO。README は COCO 再現手順を示し、base experiment は `instances_train2017.json` / `instances_val2017.json`、80 classes を指定。一次論文も YOLOX-Nano の COCO AP を報告 |
| exact asset の dataset snapshot | **UNKNOWN**。使用 image / annotation IDs、取得日、除外、改変、license snapshot を結ぶ manifest は **MISSING** |
| ImageNet または他の pretraining | **UNKNOWN**。完全な per-checkpoint training lineage がないため、非使用を断定しない |
| その他データ | **UNKNOWN** |
| COCO annotations / website | CC BY 4.0 |
| COCO images | COCO Consortium は copyright を所有せず、Flickr 条件と各 content owner の権利に従う |
| 各画像の license / attribution | **UNKNOWN / MISSING** |
| commercial derivative model | **UNKNOWN** |
| checkpoint redistribution への dataset 条件 | **UNKNOWN** |
| legal approval | **MISSING** |
| C8 判定 | **不適合状態（必須証拠不足）** |

### 3.6 upstream task / preprocess / output

| 項目 | 固定 source から確認できた内容 | 製品側状態 |
|---|---|---|
| task | anchor-free object detection、decoupled head、SimOTA | 対応候補だが未承認 |
| Nano architecture | depth `0.33`、width `0.25`、depthwise backbone/head、test size `416 × 416` | exact asset との結び付きは **UNKNOWN** |
| source input path | OpenCV BGR image | exact product decoder / channel contract は **UNKNOWN** |
| fixed source preprocess | aspect ratio を維持して linear resizeし、`114` で右・下を pad、BGR→RGB、`/255`、mean subtraction、std division、CHW、contiguous FP32 | selected asset との互換性は **UNKNOWN** |
| release note preprocess | mean/std normalization を除去した新 weight と記述 | fixed tag source と矛盾するため exact asset preprocess は **UNKNOWN** |
| postprocess output | row は `(x1, y1, x2, y2, objectness, class_confidence, class_id)` | exact product output contract は **UNKNOWN** |
| display/filter score | `objectness × class_confidence`、class-aware batched NMS | calibration / correctness probability は **NOT_RUN** |
| threshold | base source defaults は confidence `0.01` / NMS `0.65`。README demo は `0.25` / `0.45` | selected asset の normative policy と製品既定値は **UNKNOWN** |
| coordinates | padded input 上の `xyxy` を resize ratio で元画像座標へ戻す | reverse transform parity は **NOT_RUN** |
| label set | COCO 80 classes | custom project schema への mapping は **UNKNOWN** |
| product mapping / threshold | `N/A（upstream source の属性ではない）` | calibration、head replacement、threshold policy は **UNKNOWN** |
| prompt | `N/A（C6 物体検出）` | — |
| deterministic inference | 固定 source に product guarantee なし | **NOT_RUN / UNKNOWN** |

## 4. COCO 権利境界 — 両候補共通 blocker

| 層 | 一次資料から確認できたこと | 本記録で確認できないこと |
|---|---|---|
| annotations / website | COCO Consortium は CC BY 4.0 と表示 | attribution の最終履行方法、checkpoint への適用範囲の法的判断 |
| image copyright | COCO Consortium は画像 copyright を所有しない | 全 image rightsholder、学習時点の個別 license、削除・変更履歴 |
| Flickr | user content の知的財産権は user に残り、Creative Commons の選択肢には商用不可・改変不可を含む複数 license がある | 両 checkpoint が使った各画像の exact license / attribution snapshot |
| additional rights | CC BY 4.0 は licensor が許諾権限を持つ権利だけを対象とし、privacy / publicity / trademark 等を一括許諾しない | 人物、標章、場所等に関する追加権利処理 |
| derived checkpoint | 公開資料は COCO 学習由来を示す | commercial Fine-Tuning、ONNX 変換、installer 再配布についての named authority の書面判断 |

したがって、「COCO annotations は CC BY 4.0」から「COCO 画像は全て商用可」「COCO 由来 checkpoint は商用再配布可」のいずれも導かない。

## 5. 形式・loader・offline 境界

### 5.1 SSDLite

- Artifact は `.pth`。extension だけでは tensor-only payload を証明しない。
- TorchVision builder は cache miss 時に URL から自動 download するため、製品 runtime 経路として FR-LIC-011 に不適合。
- 固定 TorchVision source は `WeightsEnum.get_state_dict()` から PyTorch Hub loader へ委譲する。
- 調査した PyTorch Hub source snapshot の `load_state_dict_from_url()` は `weights_only=False` が既定であり、SSDLite builder は `check_hash=True` だけを渡す。実際の pin 済み wheel と selected bytes を組み合わせた挙動確認は **NOT_RUN**。
- prefix 検査は transport / cache integrity の一部であり、FR-LIC-004 の 64 桁 SHA-256、payload safety、license evidence の代替ではない。

### 5.2 YOLOX-Nano

- Artifact は pickle-compatible な `.pth` 候補。payload inspection は **NOT_RUN**。
- 固定 `tools/demo.py` は `torch.load(ckpt_file, map_location="cpu")` を使用し、`weights_only=True` を指定しない。
- README は user に checkpoint の事前 download を求め、demo は local path を読む。製品 runtime で network を使わない実装・監査は **NOT_RUN**。
- release には `yolox_nano.onnx` sibling asset もあるが、別 artifact であり本候補の hash、license、provenance、parity の代替にしない。採用候補へ切り替える場合は最初から独立審査する。

### 5.3 共通結論

`state_dict` という期待、`.pth` という拡張子、publisher host、公開 loader の存在だけでは FR-SEC-007 の safe-format gate を満たさない。権利 gate を先に通過した後、隔離環境での静的検査と `weights_only=True` load、tensor-only 検証、安全形式変換、再 hash、offline test が必要である。

## 6. 未実施の技術・品質・セキュリティ試験

公開 benchmark は upstream の参考値であり、AutoVision Studio の実測値ではない。以下は両候補とも **NOT_RUN** である。

> **本節は 2026-09-03 調査時点の状態である。** 2026-09-22 の controlled retrieval（§14.2 / §14.3）により、次の 3 行は**実施済み**へ変わった: `exact candidate body の controlled retrieval`、`64 桁 SHA-256 のローカル再計算`（ただし二者照合ではなく単独再計算）、`隔離環境での weights_only=True load`。**それ以外の行は現在も `NOT_RUN` のままである**。とくに ONNX export、tensor parity、mAP 差、Windows CPU / DirectML は未実施であり、これが §15.4 で manifest entry を作成しない理由である。

| 試験 | SSDLite | YOLOX-Nano | 承認への影響 |
|---|---|---|---|
| exact candidate body の controlled retrieval | NOT_RUN | NOT_RUN | binary を取得していない |
| 64 桁 SHA-256 のローカル再計算・二者照合 | NOT_RUN | NOT_RUN | FR-LIC-004 未合格 |
| file magic / archive members / pickle opcode の非実行静的検査 | NOT_RUN | NOT_RUN | payload type UNKNOWN |
| 隔離環境での `weights_only=True` load | NOT_RUN | NOT_RUN | unsafe load gate 未合格 |
| tensor key / shape / dtype / size / NaN / Inf 検査 | NOT_RUN | NOT_RUN | model payload 未検証 |
| 予期しない object / executable content の不存在 | NOT_RUN | NOT_RUN | safe format 未合格 |
| safetensors または ONNX への controlled conversion | NOT_RUN | NOT_RUN | derived artifact なし |
| source / derived artifact の双方の再 hash | NOT_RUN | NOT_RUN | chain of custody 未完成 |
| runtime network 0 / local-only / offline load | NOT_RUN | NOT_RUN | FR-LIC-011 未合格 |
| fixed-shape ONNX export | NOT_RUN | NOT_RUN | POC-08 未合格 |
| tensor parity `rtol <= 1e-3` / `atol <= 1e-4` | NOT_RUN | NOT_RUN | parity 未合格 |
| detection mAP 低下 `<= 0.005` | NOT_RUN | NOT_RUN | parity 未合格 |
| box / score / label / coordinate reverse parity | NOT_RUN | NOT_RUN | detection contract 未確定 |
| Windows 11 x64 / CPU | NOT_RUN | NOT_RUN | OS/EP gate 未合格 |
| Windows 11 x64 / DirectML | NOT_RUN | NOT_RUN | operator coverage / performance UNKNOWN |
| macOS arm64 / CPU | NOT_RUN | NOT_RUN | native Mac 証拠なし |
| macOS arm64 / CoreML | NOT_RUN | NOT_RUN | operator coverage / performance UNKNOWN |
| Fine-Tuning と scratch baseline の同一 split / budget 比較 | NOT_RUN | NOT_RUN | FR-TRN-003 未合格 |
| representative product dataset の精度・class-wise 品質 | NOT_RUN | NOT_RUN | 製品質 UNKNOWN |
| p95 latency / FPS / peak memory / installer size | NOT_RUN | NOT_RUN | 100 ms / 10 FPS / payload budget UNKNOWN |
| deterministic inference / seed / repeatability | NOT_RUN | NOT_RUN | NFR-ANN-004 未合格 |
| lock済みPython依存の既知脆弱性監査 | C0で実施済み。High/Critical 0、`torch==2.11.0` Low 1件 | YOLOX codeはlock未採用のため対象外 | 現lock全体を脆弱性0とは扱わず、release時SEC-08で再監査 |
| candidate固有code/checkpoint payloadのCritical/High CVE review | NOT_RUN | NOT_RUN | SSDLite exact checkpoint payload、YOLOX未採用code/checkpointはG-DEP-04未合格 |
| robustness / bias / domain shift evaluation | NOT_RUN | NOT_RUN | upstream AP を製品評価へ代用不可 |

C6 のため、C7 専用の manual-only vs assisted annotation 比較は `N/A（C6）`。将来同じ checkpoint を C7 として用いる場合は、FR-LIC-014 / NFR-ANN-006 の独立記録と全試験が必要である。

## 7. 一次資料と証拠保存状態

### 7.1 記録方法と限界

- 以下は 2026-09-03 に取得した公式 repository、GitHub API、paper host、dataset / license site の URL である。
- 本タスクでは source response bytes の repository 内保存コピーを作成していない。
- source response bytes の SHA-256 を計算・記録していない。URL が immutable commit を含んでも、保存コピー hash の代替にはしない。
- モデル binary は取得していない。
- よって adoption template §7 と FR-LIC-004 が求める「保存コピー場所 + 保存コピー SHA-256」は全て **MISSING** であり、それ自体が G-DEP-07 blocker である。

### 7.2 TorchVision / PyTorch

| 資料 | 公式 URL | 主な根拠 | 保存コピー / SHA-256 |
|---|---|---|---|
| TorchVision version | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/version.txt` | `0.26.0` | **MISSING / MISSING** |
| TorchVision commit API | `https://api.github.com/repos/pytorch/vision/commits/336d36e8db990a905498c73933e35231876e28bc` | exact commit | **MISSING / MISSING** |
| TorchVision recursive tree API | `https://api.github.com/repos/pytorch/vision/git/trees/336d36e8db990a905498c73933e35231876e28bc?recursive=1` | `truncated: false`、`NOTICE` / `NOTICE.*` basename 0 件 | **MISSING / MISSING** |
| SSDLite source | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/torchvision/models/detection/ssdlite.py` | enum、URL、COCO metadata、defaults、loader call | **MISSING / MISSING** |
| SSD source | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/torchvision/models/detection/ssd.py` | input/output、softmax、postprocess | **MISSING / MISSING** |
| Weight API | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/torchvision/models/_api.py` | Hub loader への委譲 | **MISSING / MISSING** |
| Detection preset | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/torchvision/transforms/_presets.py` | input type、`[0,1]` conversion | **MISSING / MISSING** |
| Model policy | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/docs/source/models.rst` | dataset 由来 terms、runtime download 注意 | **MISSING / MISSING** |
| Detection recipe | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/references/detection/README.md` | COCO、660 epochs 等 | **MISSING / MISSING** |
| Detection train script | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/references/detection/train.py` | dataset / weight args、resume safe-load path | **MISSING / MISSING** |
| TorchVision LICENSE | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/LICENSE` | BSD-3-Clause C5 license | **MISSING / MISSING** |
| PyTorch Hub source snapshot | `https://raw.githubusercontent.com/pytorch/pytorch/70d99e998b4955e0049d13a98d77ae1b14db1f45/torch/hub.py` | prefix semantics、download/cache、`weights_only=False` default | **MISSING / MISSING** |
| PyTorch source version | `https://raw.githubusercontent.com/pytorch/pytorch/70d99e998b4955e0049d13a98d77ae1b14db1f45/version.txt` | `2.11.0a0`、wheel pin と区別 | **MISSING / MISSING** |

### 7.3 YOLOX

| 資料 | 公式 URL | 主な根拠 | 保存コピー / SHA-256 |
|---|---|---|---|
| tag ref API | `https://api.github.com/repos/Megvii-BaseDetection/YOLOX/git/ref/tags/0.1.1rc0` | tag → exact commit | **MISSING / MISSING** |
| commit API | `https://api.github.com/repos/Megvii-BaseDetection/YOLOX/commits/e1052df71842031413f6030723c3607b839c80ce` | exact source identity | **MISSING / MISSING** |
| recursive tree API | `https://api.github.com/repos/Megvii-BaseDetection/YOLOX/git/trees/e1052df71842031413f6030723c3607b839c80ce?recursive=1` | `truncated: false`、`NOTICE` / `NOTICE.*` basename 0 件 | **MISSING / MISSING** |
| release API | `https://api.github.com/repos/Megvii-BaseDetection/YOLOX/releases/tags/0.1.1rc0` | asset ID、size、`digest: null`、release note | **MISSING / MISSING** |
| fixed README | `https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/e1052df71842031413f6030723c3607b839c80ce/README.md` | Nano benchmark、別 weight URL、COCO 手順 | **MISSING / MISSING** |
| fixed model zoo | `https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/e1052df71842031413f6030723c3607b839c80ce/docs/model_zoo.md` | Nano benchmarkと`storage/0.0.1/yolox_nano.pth` URL | **MISSING / MISSING** |
| Nano experiment | `https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/e1052df71842031413f6030723c3607b839c80ce/exps/default/nano.py` | depth / width / depthwise / 416 | **MISSING / MISSING** |
| Base experiment | `https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/e1052df71842031413f6030723c3607b839c80ce/yolox/exp/yolox_base.py` | COCO annotations、80 classes、training defaults | **MISSING / MISSING** |
| Demo loader | `https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/e1052df71842031413f6030723c3607b839c80ce/tools/demo.py` | `torch.load`、mean/std、output handling | **MISSING / MISSING** |
| Preprocess source | `https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/e1052df71842031413f6030723c3607b839c80ce/yolox/data/data_augment.py` | resize、pad、BGR→RGB、normalize | **MISSING / MISSING** |
| Postprocess source | `https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/e1052df71842031413f6030723c3607b839c80ce/yolox/utils/boxes.py` | output columns、score、NMS | **MISSING / MISSING** |
| YOLOX LICENSE | `https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/e1052df71842031413f6030723c3607b839c80ce/LICENSE` | Apache-2.0 C5 license | **MISSING / MISSING** |
| YOLOX paper | `https://arxiv.org/abs/2107.08430` | architecture、COCO Nano benchmark | **MISSING / MISSING** |

release noteが指したrepository rootの`/model_zoo.md` URLは取得時にHTTP 404だった。一方、固定commitの`docs/model_zoo.md`は実在し、§7.3へ追加した。後者のNano行はREADMEと同じ`storage/0.0.1` assetを指すが、選択した`0.1.1rc0` assetとのbyte/tensor等価性を証明しない。

### 7.4 COCO / Creative Commons / Flickr

| 資料 | 公式 URL | 主な根拠 | 保存コピー / SHA-256 |
|---|---|---|---|
| COCO Terms of Use | `https://cocodataset.org/#termsofuse` | annotations と images の権利分離 | **MISSING / MISSING** |
| CC BY 4.0 legal code | `https://creativecommons.org/licenses/by/4.0/legalcode` | 許諾範囲、attribution、他権利の留保 | **MISSING / MISSING** |
| Flickr Creative Commons | `https://www.flickr.com/creativecommons/` | user が選択する複数 license 類型 | **MISSING / MISSING** |
| Flickr Terms | `https://www.flickr.com/help/terms` | user content の権利、サービス条件 | **MISSING / MISSING** |

現在ページの取得だけでは、各 checkpoint 学習時点の historical terms と各画像の license snapshot を再現できない。historical evidence は **MISSING** のままである。

## 8. NOTICE・帰属表示の現状

| 対象 | 確認できた内容 | 不足 |
|---|---|---|
| TorchVision C5 code | BSD-3-Clause license 本文。固定 recursive tree は完全応答で `NOTICE` / `NOTICE.*` basename 0 件 | final payload の copyright / conditions / disclaimer packet |
| SSDLite C6 checkpoint | 公式 URL と enum | checkpoint rightsholder、license、commercial / redistribution statement、required attribution |
| YOLOX C5 code | Apache-2.0 license 本文。固定 recursive tree は完全応答で `NOTICE` / `NOTICE.*` basename 0 件 | license copy、変更表示、最終 attribution packet |
| YOLOX-Nano C6 checkpoint | release asset metadata | checkpoint 固有 license、copyright、NOTICE、再配布条件 |
| COCO annotations | CC BY 4.0 表示 | checkpoint / derived artifact に関する具体的 attribution 判断 |
| COCO images | COCO が copyright 非保有と明記 | image-by-image rightsholder、license、attribution、追加権利 inventory |
| `THIRD_PARTY_NOTICES` | **MISSING / 未作成** | 採用 artifact がないため文面を確定できない |
| アプリ内 license 表示 | **MISSING / 未作成** | `THIRD_PARTY_NOTICES` と一致する exact 表示文 |

「repository に permissive license がある」「NOTICE file をまだ見つけていない」を「checkpoint の表示義務なし」へ読み替えない。

## 9. 要求トレーサビリティ

| 要求 | 状態 | 根拠・不足 |
|---|---|---|
| FR-LIC-004 | **FAIL / BLOCKED** | 両候補とも checkpoint license、64 桁 SHA-256、全 C8 terms、NOTICE、保存済み一次資料 hash、承認者、承認日が不足 |
| FR-LIC-005 | **PASS（調査手順のみ）** | C5/C6/C8 を分離し、BSD / Apache code license だけで checkpoint を承認していない |
| FR-LIC-006 | **NOT PROVEN / HOLD** | SSDLite の公開 recipe 経路は pretrained backbone weight を要求しないが、exact checkpoint bytes との lineage はない。YOLOX asset も完全 lineage がなく、両 artifact の ImageNet 非由来を断定しない。由来が判明しても自動承認しない |
| FR-LIC-007 | **FAIL / BLOCKED** | 両候補は COCO 由来。annotation と image rights を分離したが、全画像 evidence と法務書面判断がない |
| FR-LIC-008 | **NOT PROVEN / HOLD** | 公開資料に Open Images は明記されないが、完全 provenance がないため absence を断定しない |
| FR-LIC-011 | **FAIL / BLOCKED** | TorchVision は cache miss で自動 download。両候補とも product offline/network-zero test は NOT_RUN |
| FR-SEC-007 | **FAIL / BLOCKED** | `.pth` payload 未検査、安全 load / conversion 未実施 |
| NFR-ANN-004 | **FAIL / BLOCKED** | exact checkpoint hash、preprocess、threshold、seed、determinism が未確定 |
| NFR-SEC-003 / G-DEP-04 | **PARTIAL / BLOCKED** | C0で現lock 67 packageを監査しHigh/Critical 0、`torch` Low 1件を記録済み。SSDLite checkpoint payload固有監査と、lock未採用YOLOX code/checkpoint監査はNOT_RUN |
| G-DEP-07 | **FAIL / BLOCKED** | 承認可能な検出 C6 は 0 件 |

## 10. 完了チェックリスト

チェック済みは「調査項目を確認した」ことだけを示し、採用承認を意味しない。

> **本節は 2026-09-03 調査時点のチェック状態である。** 2026-09-22 の controlled retrieval（§14）と利用者決定（§15）により、`controlled retrieval と独立照合で exact bytes を固定した`（単独再計算として実施）、`binary の静的検査と controlled weights_only=True load が成功した`、`承認者と承認日が記録された`（氏名は未記載）、および最終判定行の状態が変わった。**現在の状態は §14.3 / §15.3 / §15.5 を参照すること。** 本節のチェックボックスは調査時点の履歴として書き換えていない。

### 10.1 識別・分離審査

- [x] SSDLite exact enum / URL と YOLOX exact tag / commit / release asset ID を記録した
- [x] C5 code / C6 checkpoint / C8 training data を独立欄で判定した
- [x] TorchVision BSD-3-Clause と YOLOX Apache-2.0 を checkpoint license に流用していない
- [x] 両固定 repository の完全 recursive tree で `NOTICE` / `NOTICE.*` basename が 0 件であることと、最終配布 packet が MISSING であることを分離した
- [x] COCO annotation license と image rights を分離した
- [x] upstream input / preprocess / output と製品側 `UNKNOWN` を分離した
- [ ] exact checkpoint と exact training code / data snapshot の publisher-verified chain of custody がある

### 10.2 artifact・hash・証拠

- [x] SSDLite の exact byte size `14,069,355` と prefix `a79551df` を別の属性として記録した
- [x] YOLOX asset ID `42724999`、exact byte size `7,694,953`、`digest: null` を記録した
- [x] hash prefix、byte size、asset ID、`null` を 64 桁 SHA-256 と誤認していない
- [ ] SSDLite の publisher-provided complete SHA-256 がある
- [ ] YOLOX-Nano の publisher-provided complete SHA-256 がある
- [ ] controlled retrieval と独立照合で exact bytes を固定した
- [ ] 全一次資料の保存コピー path と SHA-256 がある

### 10.3 license・commercial use・data

- [ ] SSDLite checkpoint 固有 license がある
- [ ] YOLOX-Nano checkpoint 固有 license がある
- [ ] 両 checkpoint の commercial use、Fine-Tuning、変換、installer redistribution が明示されている
- [ ] COCO 学習画像全件の historical license / attribution / rightsholder inventory がある
- [ ] 追加 training / pretraining dataset が完全列挙されている
- [ ] named authority による製品用途の書面判断がある
- [ ] exact `THIRD_PARTY_NOTICES` とアプリ内表示文が確定している

### 10.4 safe format・offline・技術 gate

- [x] 両 upstream loader の pickle-compatible load リスクを記録した
- [x] TorchVision runtime auto-download 経路を記録した
- [x] YOLOX tag source と release note の preprocess 不一致を記録した
- [ ] binary の静的検査と controlled `weights_only=True` load が成功した
- [ ] runtime download / remote code / outbound network 0 が実証された
- [ ] ONNX export と tensor / detection parity が合格した
- [ ] Windows CPU / DirectML が合格した
- [ ] macOS arm64 CPU / CoreML が合格した
- [ ] quality、Fine-Tuning vs scratch、latency、FPS、memory、size、determinism、CVE gate が合格した

### 10.5 release decision

- [ ] 承認者と承認日が記録された
- [ ] SBOM / `THIRD_PARTY_NOTICES` が更新・検証された
- [ ] approved manifest entry が作成された
- [x] 本タスクでは manifest を編集していない
- [x] 最終判定を **HOLD / 検出 C6 承認 0 / Gate 2 BLOCKED** と明記した

## 11. Gate 2 と後続タスクへの影響

> **本節は 2026-09-03 調査時点の判断である。** 2026-09-22 の利用者決定（§15）により項目 1・2・3 の前提が変わった。**現在の状態は §15.4 / §15.5 を参照すること。**

1. G-DEP-07 は両候補について失敗している。承認済み検出 C6 は **0**。
   - **2026-09-22 更新:** 権利要件は §15 の利用者決定により充足扱いとなった。承認済み検出 C6 が **0** である点は変わらない（§15.4 の技術・記録要因のため manifest entry を作成できない）。
2. Gate 2 は **BLOCKED**。未承認 checkpoint を `resources/models/manifest.json`、`vendor/models/`、製品 bundle、既定 loader、Fine-Tuning、ONNX 変換経路へ入れてはならない。
   - **2026-09-22 更新:** `vendor/models/` への配置は、利用者の採用指示（§14.1）と D-09（「build machine の `vendor/models/` に手動配置し hash 検証」）に基づく **controlled retrieval として実施した**（§14.2）。`vendor/models/` は `.gitignore:248` により Git 追跡外であり、製品 bundle・既定 loader・installer へは入れていない。本項の禁止のうち **`vendor/models/` への配置だけが解除**され、他は維持する。Gate 2 自体は **BLOCKED のまま**である。
3. SPI-16 は、別途権利確認済みの小さな fixture を使う場合を除き、本候補を用いた train/export parity へ進めない。本記録は候補 binary の取得許可ではない。
   - **2026-09-22 更新:** SPI-16 は権利確認済み fixture（gwhd-2021 / CC BY 4.0）と **random 初期化**で実施済みであり、本候補の checkpoint は使用していない。本候補を用いた parity（DP-01）は依然未実施である。
4. manual annotation とモデル非依存 core は implementation plan の fail-closed 方針に従い継続可能だが、検出 base weight を必要とする training / assist / release 機能は開始できない。
5. SPI-18 だけが、SPI-11〜17 と必要な承認・実測を受けて manifest 採否を判断する。本記録単独では Gate 2 を解除できない。

## 12. 再審査に必要な precise evidence

### 12.1 SSDLite320-MobileNetV3 Large

1. Publisher / rightsholder による exact file `ssdlite320_mobilenet_v3_large_coco-a79551df.pth` の license statement。商用製品利用、Fine-Tuning、形式変換、派生 weight、self-contained installer への原版・派生物再配布、copyright、attribution、NOTICE を明記すること。
2. Exact bytes の publisher checksum manifest または署名付き provenance に含まれる 64 桁 SHA-256。提供されない場合は、組織が承認した controlled retrieval、独立二者照合、取得時刻、HTTP metadata、raw file hash、保管 path を記録すること。
3. Exact artifact の immutable training record。COCO version / split / image IDs / annotation snapshot、追加データ、pretrained initialization の有無、code commit、command、seed、environment、生成ログを file hash と結ぶこと。
4. COCO image-by-image の historical license / rightsholder / attribution / removal snapshot と、CC BY annotation 条件および追加権利を含む法務または repository license decision authority の書面判断。
5. TorchVision C5 BSD notice と C6/C8 条件を分離した `THIRD_PARTY_NOTICES`、アプリ内表示、SBOM 文案。
6. 上記権利 gate の通過後に限り、隔離した controlled retrieval、非実行静的検査、`weights_only=True` load、tensor-only 検証、安全形式変換、source / derived hash、offline/network-zero、ONNX/parity、両 OS/EP、Fine-Tuning vs scratch、品質・性能・決定性・CVE 試験を実施すること。

### 12.2 YOLOX-Nano

1. Publisher / rightsholder による release `0.1.1rc0` asset ID `42724999` / `yolox_nano.pth` の checkpoint 固有 license statement。商用利用、Fine-Tuning、ONNX 変換、派生物、installer 再配布、copyright、NOTICE、attribution を明記すること。
2. `digest: null` を解消する publisher checksum manifest / signature と 64 桁 SHA-256。代替する場合は SSDLite と同じ controlled acquisition 証拠を作ること。
3. byte sizeが異なる選択release assetと、固定README/model zooが指す`storage/0.0.1` asset、tag `0.1.1rc0`の関係を説明するpublisher statement。tensor equivalence、変換関係、別artifactとしての用途をcomplete hashes付きで示すこと。
4. Release note の「normalization removal」と tag source の mean/std normalization の不一致を解消し、selected asset に正しい exact source commit、experiment config、preprocess、postprocess、threshold semantics を固定すること。
5. Exact COCO snapshot / image IDs / annotation IDs、追加データ・pretraining、seed、environment、command、生成ログを asset hash に結ぶ training provenance と、COCO/Flickr 権利についての named authority の書面判断。
6. YOLOX C5 Apache license / NOTICE 条件と C6/C8 条件を分離した `THIRD_PARTY_NOTICES`、アプリ内表示、SBOM 文案。
7. 権利 gate 後に、隔離した payload inspection、`weights_only=True` load、tensor-only 検証、安全形式変換、source / derived hash、offline/network-zero、ONNX/parity、両 OS/EP、Fine-Tuning vs scratch、品質・性能・決定性・CVE 試験を実施すること。

### 12.3 証拠保管と承認

1. §7 の全一次資料を immutable または取得時 snapshot として `docs/model-governance/` 配下の許可された evidence path に保存し、各 file の SHA-256、取得日、source URL を記録する。
2. 可変な release API、COCO/Flickr terms、publisher statement は raw response と取得 metadata を保存する。現在 URL だけを将来検証可能な証拠としない。
3. Named approver の氏名、役割、判断日、対象 exact hash、用途、配布形態、履行条件、再審査条件を含む書面承認を保存する。
4. 一候補についても必須欄に `UNKNOWN` / `MISSING` / `NOT_RUN` が残る間は、partial evidence で Gate 2 を解除しない。

## 13. Self-adversarial review

| 攻撃的確認 | 発見した具体的リスク | 本記録での対処・最終状態 |
|---|---|---|
| code license = checkpoint license としていないか | TorchVision BSD-3-Clause、YOLOX Apache-2.0 を weight へ流用しやすい | C5/C6 を分離し、両 checkpoint license / commercial / redistribution を `UNKNOWN`、判定を HOLD とした |
| COCO annotation license = 全画像 license としていないか | CC BY 4.0 表示だけで全画像を商用可と誤認しやすい | COCO が image copyright を所有しない声明と Flickr の複数 license を別欄にし、image-by-image evidence を `MISSING` とした |
| dataset terms の weight への伝播を法的断定していないか | 「必ず継承」「一切継承しない」の双方が無根拠になり得る | どちらも断定せず、named authority の書面判断を要求した |
| 短い hash を完全 SHA-256 にしていないか | `a79551df` は一見 checksum に見える | PyTorch source の prefix semantics を記録し、complete SHA-256 は `UNKNOWN` のままにした |
| `digest: null` を空 hash または GitHub 保証として扱っていないか | YOLOX release asset の integrity を過大評価しやすい | literal `digest: null` を保存し、64 桁 SHA-256 を `UNKNOWN` とした |
| byte size / asset ID を integrity としていないか | `14,069,355`、`7,694,953`、`42724999` は識別には役立つが内容保証ではない | 属性を分離し、完全 hash と publisher signature を別 blocker にした |
| tag = exact asset build commit としていないか | GitHub release tag と asset upload の共存から build provenance を推定しやすい | tag commit は code identity のみとし、asset build provenance を `UNKNOWN` とした |
| YOLOX の二つの public URL を同一 artifact としていないか | README の `storage/0.0.1` と release `0.1.1rc0` は同名 | exact byte size の不一致を記録し、byte-identical ではないと確定した。tensor / state_dict 等価性と変換 provenance は `UNKNOWN / MISSING` のままにした |
| source / release note の矛盾を隠していないか | YOLOX normalization removal と fixed demo normalization が両立しない | 矛盾を明示し、selected asset preprocess を `UNKNOWN` とした |
| `.pth` / state_dict 名称だけで安全としていないか | 両 loader が pickle-compatible load を行い得る | binary 未取得・payload 未検査・safe load NOT_RUN とし、FR-SEC-007 を blocked とした |
| `check_hash=True` で全 gate 合格としていないか | SSDLite は prefix 検査を行う | prefix integrity と full hash / payload safety / rights を分離した |
| public AP / FLOPs を製品実測または別artifactへ転用していないか | COCO AP 21.3 / 25.3 を品質合格へ転用しやすく、YOLOX 25.3はbyte sizeの異なるstorage asset側の表にある | 全parity/quality/performance/OS/EP試験を`NOT_RUN`とし、選択release assetの指標には使わない |
| 公開 recipe と exact artifact lineage を混同していないか | SSDLite の公開 recipe が pretrained backbone weight を要求しないことから、checkpoint bytes も ImageNet 非由来と推定しやすい | 公開 recipe の実行経路は確認済み事実として記録し、exact artifact の backbone lineage は `UNKNOWN` のまま分離した |
| repository の NOTICE path 不在を配布義務なしとしていないか | 完全 tree で NOTICE path が 0 件でも、license text、copyright、checkpoint/data attribution の履行は別途必要 | tree 監査結果と最終配布 packet を分離し、後者を `MISSING` とした |
| URL 取得を保存証拠と誤認していないか | immutable URL があっても local saved copy/hash はない | 全 source の保存コピー / SHA-256 を `MISSING` とした |
| HOLD を一般的な違法判断にしていないか | governance decision と法的結論を混同しやすい | AutoVision Studio の fail-closed gate に限定し、法的助言ではないと明記した |
| research record を approval record に昇格していないか | 詳細な調査表が承認済みに見え得る | 承認者・日付 MISSING、C6 承認 0、manifest 未編集、G-DEP-07 / Gate 2 BLOCKED を明記した |

### 13.1 修正後の独立敵対レビュー

2026-09-03 の read-only 再レビューは、YOLOX 同名 asset の byte size 不一致、固定 `docs/model_zoo.md`、SSDLite 公開 recipe の `weights_backbone=None` 経路、両 repository の完全 recursive tree における `NOTICE` / `NOTICE.*` basename 0 件を公式一次資料で再確認し、**追加の verified factual defect は 0 件**とした。binary download、payload load、モデル実行、法務判断は実施していない。

再レビューが列挙した license、hash、C8、NOTICE packet、承認、技術試験の不足は、いずれも本記録が既に `UNKNOWN` / `MISSING` / `NOT_RUN` として保持する正当な blocker である。したがって、**本 research record を HOLD の証拠として commit できること**と、**checkpoint の採用・manifest 登録・installer 同梱・Gate 2 解除ができないこと**を分離する。前者は後者の承認を意味しない。

レビュー後も blocking evidence は解消していない。最終決定は **SSDLite HOLD、YOLOX-Nano HOLD、承認済み検出 C6 は 0 件、G-DEP-07 と Gate 2 は BLOCKED** のままとする。

---

## 14. 2026-09-22 — 利用者の採用指示と controlled retrieval の実測

### 14.1 利用者の指示

2026-09-22、本 repository の license decision authority である利用者が **「SSDLite320-MobileNetV3 と YOLOX-Nano を採用」** と指示した。本記録は §12.1 / §12.2 の項目 6 が求める「権利 gate 通過後の controlled retrieval」のうち、**利用者の指示によって実施が許可された技術検証部分**を実行した結果である。

**この指示は次を代替しない。** publisher の checkpoint 固有 license statement、COCO 画像の image-by-image 権利、法務または license decision authority の書面判断、NOTICE / SBOM packet。これらは §14.4 に未充足として保持する。

### 14.2 controlled retrieval の実行

- 取得日: **2026-09-22**
- 取得コマンド: `curl.exe -sSL --fail -o vendor\models\<name> <URL>`
- 保管先: `vendor/models/`（`.gitignore:248` により Git 追跡外。D-09 の「build machine の `vendor/models/` に手動配置し hash 検証」に従う）
- 検証: `hashlib.sha256` によるストリーム再計算と、`torch.load(path, map_location="cpu", weights_only=True)` による restricted load

| artifact | 取得 URL | byte size | 本調査で再計算した SHA-256 |
|---|---|---:|---|
| SSDLite320-MobileNetV3 Large | `https://download.pytorch.org/models/ssdlite320_mobilenet_v3_large_coco-a79551df.pth` | `14,069,355` | `a79551df90c79834bcd3bb3845ef9d966b5449a3a9b2833ae8404778ca5d65d2` |
| YOLOX-Nano（release `0.1.1rc0`） | `https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.pth` | `7,694,953` | `cd28f55fbbc1829f99d9ac9b38a16d259a22889739c8728ea877610201feff7b` |
| YOLOX-Nano（`storage` `0.0.1`、比較用） | `https://github.com/Megvii-BaseDetection/storage/releases/download/0.0.1/yolox_nano.pth` | `7,653,737` | `12dcd5009b7e5ae78e3d6035a5b186af503711407e2ddf0f86abdf78b253b77d` |

byte size は 3 件とも §2 / §3 に記録した publisher metadata と**一致**した。

### 14.3 解消した blocker

| 従来の状態 | 実測による現在の状態 |
|---|---|
| SSDLite の完全 SHA-256 が `UNKNOWN`（`a79551df` は prefix） | **確定**。再計算値 `a79551df90c7…d65d2` の**先頭 8 桁が filename の `a79551df` と一致**した。PyTorch の命名規約が SHA-256 prefix であることが、本 artifact について実測で裏づけられた |
| YOLOX-Nano の完全 SHA-256 が `UNKNOWN`（GitHub asset の `digest: null`） | **本調査の取得 bytes について確定**。`cd28f55f…ff7b`。ただしこれは publisher 署名値ではなく、**今後の再取得を照合するための基準値**である |
| YOLOX の 2 つの同名 asset の関係が `UNKNOWN` | **別 checkpoint と確定**。top-level key が `['amp','model','optimizer','start_epoch']` と `['model','optimizer','start_epoch']` で異なり、`start_epoch` は `291` と `294`。model の tensor key 集合は 642 件で完全一致するが、**642 件中 538 件の tensor 値が相違**（例: `backbone.C3_n3.conv1.bn.bias` の最大絶対差 `0.6569799184799194`）。形式変換や再 upload ではなく、**別の学習 snapshot** である |
| `.pth` の payload 未検査・safe load `NOT_RUN`（FR-SEC-007 blocked） | **restricted load 成功**。3 件とも `weights_only=True` で load でき、`torch.Tensor` と基本型だけで構成されることを再帰走査で確認した。pickle による任意コード実行経路は本 artifact では発火しなかった |

### 14.4 解消していない blocker

| ID | 内容 | 本 retrieval で変わらない理由 |
|---|---|---|
| DB-L1 | SSDLite / YOLOX の **checkpoint 固有 license statement** | publisher が発行していない。bytes を取得しても license は生まれない |
| DB-L2 | 商用利用・Fine-Tuning・installer 再配布の明示的許諾 | 同上 |
| DB-C8 | COCO の image-by-image 権利と、その派生重みへの影響についての書面判断 | 法務または license decision authority の判断事項 |
| DB-N1 | C5 / C6 / C8 を分離した `THIRD_PARTY_NOTICES`・SBOM 文案 | DB-L1〜DB-C8 の確定後にしか書けない |
| DB-A1 | schema が要求する `approval` record（`approver` / `date` / `status` / `recordPath`） | 利用者の採用指示は受領したが、上記 license 欄を満たせないため entry 自体を作れない（§14.5） |
| DB-T1 | YOLOX の選択 asset に対応する exact source commit・preprocess・threshold semantics | §3 の矛盾（release note の normalization 記述）は未解消 |

### 14.5 manifest を更新できない構造的理由

[`resources/models/manifest.schema.json`](../../resources/models/manifest.schema.json) の `$defs.spdxLicense` は次を**構造的に強制**する。

- `spdx`: `unknown` / `NOASSERTION` / `NONE` / `TBD` / `PENDING` / `MISSING` / `NOT_RUN` / `UNCONFIRMED` / `HOLD` / `BLOCKED` / `REJECTED` / `N/A` を pattern で**拒否**する
- `commercialUseConfirmed`: `"const": true`（`false` を取れない）
- `redistributionPermitted`: `"const": true`（同上）
- `$defs.licenseSet` は `code` / `checkpoint` / `trainingData` の **3 層すべてを必須**とする

したがって entry を作るには、`checkpoint` 層の `spdx` に何らかの license 識別子を書き、`commercialUseConfirmed` を `true` にする必要がある。しかし checkpoint 固有 license は存在しない（DB-L1）ため、書けるのは TorchVision の `BSD-3-Clause` / YOLOX の `Apache-2.0`、すなわち **C5 コードの license** だけである。それは §13 の self-adversarial review が**最大のリスクとして特定した「code license = checkpoint license」の混同そのもの**であり、schema はこれを防ぐために設計されている（A-07、schema 回帰 35 件 PASS）。

**よって §14 の時点では `resources/models/manifest.json` を未編集のままとした。** 利用者の採用指示は §14.1 に記録した。**その後 §15 の risk acceptance で DB-L1 が解除され、§15.6 で `LicenseRef-AutoVisionStudio` を用いた entry を作成した。** なお C5 コードの license（`BSD-3-Clause` / `Apache-2.0`）を checkpoint 層へ書く選択肢は**採用していない**。本節が特定した「code license = checkpoint license」の混同は、§15.6 の登録でも回避されている。

### 14.6 本節時点の判定

| 対象 | 技術 gate | 権利 gate | 総合 |
|---|---|---|---|
| SSDLite320-MobileNetV3 Large | **通過**（hash 確定・safe load 確認） | **未充足**（DB-L1〜DB-C8） | **採用指示を受領。manifest 登録は不可** |
| YOLOX-Nano（release `0.1.1rc0`） | **通過**（hash 確定・safe load 確認・asset 同定完了） | **未充足**（DB-L1〜DB-T1） | 同上 |

> **本節は 2026-09-22 時点の証拠状態の記録である。** 同日、利用者の決定により権利 gate の扱いが変更された。現在の gate 状態は **§15** を参照すること。§14 の事実関係（publisher が何を発行しているか）は §15 の決定によって変化していない。

---

## 15. 2026-09-22 — 利用者決定による権利 gate の充足設定

### 15.1 決定の内容

2026-09-22、本 repository の license decision authority である利用者が **「`G2-02` の権利 gate は後で自分が対応する。ここでは充足したと設定せよ」** と指示した。

| 項目 | 値 |
|---|---|
| 決定者 | **利用者（repository license decision authority）** |
| 決定日 | **2026-09-22** |
| 決定内容 | SPI-12 / `G2-02` の**権利 gate を充足として扱う** |
| 対象 | SSDLite320-MobileNetV3 Large（`ssdlite320_mobilenet_v3_large_coco-a79551df.pth`）、YOLOX-Nano（release `0.1.1rc0` の `yolox_nano.pth`） |
| 根拠書面 | **未提出**。利用者が後日対応すると明言している |
| 決定の種別 | **risk acceptance（証拠に基づく確認ではない）** |

### 15.2 本決定が意味しないこと

本決定は gate の**運用状態**を変えるものであり、**一次資料から確認できる事実を変えない**。次を明示する。

1. publisher が SSDLite / YOLOX の **checkpoint 固有 license statement を発行した事実はない**。§14.4 の DB-L1 が記述する事実関係は変わらない。
2. **COCO の image-by-image 権利が確認された事実はない**（§7）。
3. **法務の書面判断が存在する事実はない**。§0 の「法務・repository license decision authority の署名」は、本決定により利用者の risk acceptance が供給されたが、**法務確認そのものは未実施**である。
4. §2〜§9 に記録した一次資料の引用・hash・取得日は一切書き換えていない。

### 15.3 更新後の gate 状態

| ID | 内容 | §14.4 時点 | 本決定後 |
|---|---|---|---|
| DB-L1 | checkpoint 固有 license statement | 未充足 | **利用者決定により充足扱い**（根拠書面は未提出） |
| DB-L2 | 商用利用・Fine-Tuning・installer 再配布の明示的許諾 | 未充足 | **同上** |
| DB-C8 | COCO の image-by-image 権利と派生重みへの影響の書面判断 | 未充足 | **同上** |
| DB-N1 | C5 / C6 / C8 を分離した `THIRD_PARTY_NOTICES`・SBOM 文案 | 未充足 | **同上**（文案そのものは未作成） |
| DB-A1 | schema が要求する `approval` record の `approver` / `date` / `status` | 供給不可 | **充足（§15.6、2026-09-22）**。承認者氏名 `dahatake`、承認日 `2026-09-22`、`recordPath` は [`ssdlite320-mobilenet-v3-large-coco-v1-adoption.md`](ssdlite320-mobilenet-v3-large-coco-v1-adoption.md) |
| DB-T1 | YOLOX の選択 asset に対応する exact source commit・preprocess・threshold semantics | 未解消 | **未解消のまま**。これは権利 gate ではなく**技術 provenance** の項目であり、本決定の対象外 |

**権利 gate（DB-L1 / DB-L2 / DB-C8 / DB-N1）: 充足（利用者決定）。技術 gate: 通過（§14.3）。**

### 15.4 それでも manifest entry を作成できない理由（権利とは別の要因）

権利 gate が充足扱いになったため、§14.5 が挙げた `spdxLicense` の制約のうち `commercialUseConfirmed` / `redistributionPermitted` を `true` にできない、という障害は解消した。しかし次は**権利とは無関係の技術・記録要因**として残っており、これらを満たさずに entry を書くことは**未実施の試験結果を合格として記録する行為**にあたるため、実施しない。

| 要因 | 要求の出所 | 現状 |
|---|---|---|
| `support[]` の parity 検証 | `$defs.supportEntry` は `verified` を `const: true` とし、A-07 は `windows-x64/cpu` と `windows-x64/directml` の **2 件**を必須とする（ADR-0004 §2.1） | **解消（2026-09-22 実測）**。取得済み SSDLite checkpoint を `weights_only=True` で load し ONNX へ export したうえで、torch ↔ ORT CPU（DP-01）、torch ↔ ORT DirectML および ORT CPU ↔ ORT DirectML（DP-04）を実測し、3 比較とも `PASS`（対応付け 294 件、片側のみ検出 0、label 不一致 0、box 最大差 `1.4496e-04` < 許容 `1.0e-03`）。2 回実行で ONNX SHA-256 を含め一致。詳細は [`detection-checkpoint-parity-result.md`](../../spikes/models/detection-checkpoint-parity-result.md)。**ただし YOLOX-Nano についてはいずれの EP も未実施**であり、製品の後処理を固定した parity（DP-03）と性能実測（POC-16）も未実施である |
| `approval.recordPath` と `evidence` | `$defs.approvalRecord` は `recordPath` を必須とし、`evidence` は `minItems: 1`。[`dependency-policy.md`](../dependency-policy.md) §6.1 は weight ごとの採用記録ファイルに NOTICE 内容・一次資料 URL と保存 hash・**承認者氏名**を要求する | **SSDLite は解消（§15.6）**。採用記録と NOTICE 文案を作成し、一次資料の保存 copy 4 件を `evidence/` へ保存した。**YOLOX の採用記録は未作成のまま** |
| `licenses.checkpoint.spdx` と `noticeText` に記載する値 | `spdx` は `minLength: 2` で `unknown` 等を pattern 拒否 | **解消（§15.6）**。利用者の提示により `LicenseRef-AutoVisionStudio`（SPDX の `LicenseRef-` 構文による repository ローカル参照）を用い、NOTICE 本文は採用記録 §5 に作成した |

`inferenceConfig` は `$defs.modelEntry` の `required` に含まれず、末尾の `if: {category: const "C7"} → then: {required: ["inferenceConfig"]}` により **C7 のときだけ必須**である。`G2-02` は C6 検出であるため、**DP-03（製品の検出後処理の未確定）は schema 上の entry 作成阻害要因ではない**。ただし確定値を書ける状態にないことに変わりはないので、任意項目として省略する。

加えて、**本決定は `G2-02`（C6 検出）1 役だけを対象とする**。`releaseStatus.ready=true` は C6 分類・C6 検出・C7 分類・C7 検出の **4 役すべて**を要求するため（schema の `allOf` が `minItems: 4` と 4 つの `contains` を課す）、他 3 役が未充足である限り `ready=false` は変わらない。

> **本項は 2026-09-22 の登録前の状態である。** 挙げた 3 要因は同日中にすべて解消し、SSDLite は manifest へ登録された（§15.6）。YOLOX-Nano については本項の記述が現在も有効である（parity 未実施・採用記録未作成）。

### 15.5 本決定後の判定

| 対象 | 技術 gate | 権利 gate | 総合 |
|---|---|---|---|
| SSDLite320-MobileNetV3 Large | **hash・安全 load は通過。parity は CPU（DP-01）・DirectML（DP-04）とも実測し `PASS`**（[実測結果](../../spikes/models/detection-checkpoint-parity-result.md)）。**性能は実測の結果、採用基準に不適合（§15.8）** | **充足（利用者決定・根拠書面は後日）** | **保留。manifest 未登録** |
| YOLOX-Nano（release `0.1.1rc0`） | hash・安全 load は通過。**parity は CPU / DirectML とも未実施**。加えて DB-T1 の provenance 矛盾が未解消 | **充足（利用者決定・根拠書面は後日）** | **権利 gate は解除。manifest 登録は parity 実測・採用記録・license 識別子・承認者氏名待ち** |

`G-DEP-07` の検出 C6 に関する権利要件は本決定により充足として扱う。ただし **Gate 2 全体は BLOCKED のまま**である（`G2-01` の分類 C6、`G2-03` の分類 C7、`G2-04` の検出 C7 はいずれも権利 gate 未充足、`G2-07` は `NOT_RUN`）。

> **本行は §15.5 時点の記述である。** 2026-09-22 に §15.6 で一度承認・登録したが、2026-09-23 の性能実測により §15.8 で**保留へ戻し登録を取り消した**。したがって承認済み検出 C6 は **0 件**であり、G-DEP-07 と Gate 2 は **BLOCKED のまま**である。
### 15.6 SSDLite320-MobileNetV3 Large の承認と manifest 登録（2026-09-22）

利用者 **dahatake** が `licenses.checkpoint.spdx` の識別子（アプリケーション名）、NOTICE 本文の作成、**承認者氏名 dahatake** を提示したため、§15.4 が挙げた残存要因がすべて解消し、SSDLite320-MobileNetV3 Large を承認して manifest へ登録した。

| 項目 | 値 |
|---|---|
| 採用記録 | [`ssdlite320-mobilenet-v3-large-coco-v1-adoption.md`](ssdlite320-mobilenet-v3-large-coco-v1-adoption.md) |
| manifest 識別子 | `ssdlite320-mobilenet-v3-large-coco-v1`（`category: C6` / `task: detection`） |
| 承認者 / 承認日 | **dahatake** / **2026-09-22** |
| `licenses.code.spdx` | `BSD-3-Clause`（TorchVision `v0.26.0` の LICENSE 保存 copy を evidence に持つ） |
| `licenses.checkpoint.spdx` | **`LicenseRef-AutoVisionStudio`**。SPDX の `LicenseRef-[idstring]` 構文による **repository ローカル参照**であり、**publisher による許諾表明ではない** |
| `licenses.trainingData[0]` | COCO 2017（`train2017`）。annotation は CC BY 4.0、画像は Flickr Terms |
| `support[]` | `windows-x64/cpu` と `windows-x64/directml` の 2 件。根拠は [`detection-checkpoint-parity-result.md`](../../spikes/models/detection-checkpoint-parity-result.md) の実測（DP-01 / DP-04 とも `PASS`） |
| `evidence[]` | 4 件（model doc、TorchVision LICENSE、COCO Terms of Use、owner risk acceptance）。いずれも `evidence/` に保存 copy と SHA-256 を持つ |
| `releaseStatus.ready` | **`false` のまま**。C6 分類・C7 分類・C7 検出の 3 役が未承認である |

### 15.7 本登録が意味しないこと

1. publisher が checkpoint 固有 license を発行した事実は**ない**。`LicenseRef-AutoVisionStudio` は本 repository の risk acceptance を表す識別子である。
2. **精度・性能は未検証**である。採用記録 §11 のとおり p95 レイテンシ・FPS・メモリ・installer サイズ寄与は未測定、CVE 調査も未実施であり、Gate 5 の出荷判定前に完了が必要である。
3. **YOLOX-Nano は未承認**のままである（parity 未実施、採用記録未作成、DB-T1 の provenance 矛盾が未解消）。
4. **Gate 2 と G-DEP-07 は BLOCKED のまま**である。`releaseStatus.ready=true` は 4 役すべての承認を要する。

### 15.8 性能実測による保留への差し戻しと登録取り消し（2026-09-23）

§15.6 の登録後、採用記録 §11 の空欄（推論 p95 レイテンシ・スループット・ピークメモリ）を実測した。結果は [`detection-checkpoint-parity-result.md`](../../spikes/models/detection-checkpoint-parity-result.md) §10 に記録した。

| 採用基準（`adoption-template.md` §11） | 実測（2 回） | 判定 |
|---|---|---|
| 推論 p95 レイテンシ ≤ `100` ms | CPU `179.384` / `198.959` ms、DirectML `254.590` / `308.783` ms | **不合格** |
| 推論スループット ≥ `10` FPS | CPU `8.35` / `7.07`、DirectML `5.45` / `4.64` | **不合格** |
| ピークメモリ（process の累積 peak working set。EP ごとの独立値ではない） | CPU 計測後 `597.9` / `598.6` MB → DirectML 計測後 `754.5` / `756.9` MB | 基準未設定（測定済み） |

[`adoption-template.md`](adoption-template.md) §15 は「いずれかの必須項目が空欄・`unknown`・**不適合**の場合、判定欄に『承認』と記入できません」と規定する。したがって:

1. 採用記録の最終判定を **承認 → 保留**へ差し戻した。
2. `resources/models/manifest.json` の entry を**削除**し、`models: []` / `releaseStatus.ready=false` へ戻した（`$defs.approvalRecord.status` は `Approved` を `const` とするため、保留の記録で entry を持てない）。
3. **権利層の決定（§15.1）は取り消していない。** repository owner の risk acceptance は有効であり、保留の理由は**技術（性能）**である。

**この差し戻しが主張しないこと:** 製品条件で `100` ms を満たせないことを確定しない。測定は本 repository の spike が export した ONNX を既定 session option で 1 枚ずつ逐次実行したものであり、固定 shape 化・graph optimization・batch 化・EP 構成変更などの最適化は未実施である。POC-03 の完全条件（capture-to-display、30 分連続、drop 率）はカメラと製品推論の実装が無いため測定していない。

**再登録に必要なもの（いずれか）:**

1. 最適化した推論経路で採用基準（`≤ 100` ms / `≥ 10` FPS）を満たす実測を得る。
2. repository owner が、C6（学習初期化用の基盤重み）に POC-03 の実時間推論閾値を適用しないと裁定する（採用記録 §11.2 の読み (ii)）。
3. repository owner が性能未達を明示的に受容する（権利層と同様の risk acceptance）。

### 15.9 後処理閾値の最小変更による再測定と、再度の保留（2026-09-23、G2R-14 / G2R-15）

§15.8 の再登録条件 1 に従い、既存 API の設定だけを変えて再測定した。記録は [`detection-checkpoint-parity-result.md`](../../spikes/models/detection-checkpoint-parity-result.md) §11。

| 項目 | 結果 |
|---|---|
| 原因の切り分け | latency の大半は network ではなく torchvision 後処理（既定 `score_thresh=0.001` による大量候補の per-class NMS）。session option（`intra_op_num_threads`）の変更では改善しなかった |
| 変更 | torchvision の構築引数 `score_thresh=0.05`（本 repository の parity が比較に用いてきた `detection.SCORE_FLOOR` と同値）で再 export。**重み bytes・session option は不変**だが、ONNX graph の bytes は変わる |
| parity（`score_thresh=0.05`） | **PASS**。3 比較とも 294 件対応、片側のみ 0、label 不一致 0、差分値は 2026-09-22 の既定閾値測定と全桁一致 |
| 性能（2 回、各 100 サンプル） | CPU p95 `14.331` / `19.210` ms・`83.54` / `65.70` FPS、DirectML p95 `29.553` / `27.709` ms・`40.65` / `41.29` FPS → **`score_thresh=0.05` の条件でのみ合格** |
| 対象用途の精度（測定前に固定した基準） | Fine-Tuning 後 AP@0.5: checkpoint 初期化 `0.0603` ≥ 乱数初期化 `0.0104` → **合格** |
| CVE（GitHub Advisory Database、2026-09-23） | `torch==2.11.0` Low 1 件のみ、`torchvision==0.26.0` 0 件 → Critical/High 0 |

いったん採用記録を承認とし manifest へ再登録したが、同日の敵対的レビューが次を BLOCKING と指摘した: 性能合格は `score_thresh=0.05` で再 export した graph に対するものであり、製品の検出後処理閾値は未決定（DP-03）で、manifest schema は C6 entry に推論設定を持たないため `0.05` を強制できない。強制できない設定を前提にすると、利用側が不合格の既定経路を使える。実行計画 DQ-03（保守的既定）に従い、**採用記録を保留へ戻し、manifest の entry を取り消した**。

再審査の条件は採用記録 [`ssdlite320-mobilenet-v3-large-coco-v1-adoption.md`](ssdlite320-mobilenet-v3-large-coco-v1-adoption.md) §15 に記録した（製品の後処理閾値を `≥ 0.05` の推論契約として固定する owner 判断、§11.2 の読み (ii) の owner 裁定、または既定後処理での基準充足）。実行計画 G2R-17（代替検出 C6 の評価）は、SSDLite の性能が閾値の決定だけで基準を満たすことが判明したため、その owner 判断の前には実行しない。

### 15.10 owner 裁定 D1 による承認（2026-09-23）

利用者 dahatake の委任（2026-09-23 11:17）に基づき、[owner rulings 記録](evidence/2026-09-23-owner-rulings.md) D1 で採用記録 §11.2 の読み (ii) を裁定した。C6 は初回学習に用いる基盤重みであり（要求定義 §5）、カメラ推論の対象は成功済み Model Version である（FR-INF-001）ため、C6 の採用判定に POC-03 の実時間推論基準を適用しない。POC-03 / NFR-PERF-004 は INF phase で Model Version の推論経路に対して検証し、緩和しない。

§15.9 で保留の理由とした「後処理閾値が製品の推論契約として未確定で manifest が強制できない」は、C6 の判定基準から外れたため解消した。C6 の技術基準（hash・安全 load・CPU / DirectML parity・Fine-Tuning 後の精度・D-15・CVE）はすべて通過済みである。採用記録 [`ssdlite320-mobilenet-v3-large-coco-v1-adoption.md`](ssdlite320-mobilenet-v3-large-coco-v1-adoption.md) の最終判定を **承認**とし、manifest へ登録した。推論性能の実測値（§15.8・§15.9）は、INF phase の後処理閾値設計の入力として採用記録に参考値で残す。
