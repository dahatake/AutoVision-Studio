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
| 法務・repository license decision authority の署名 | **MISSING** |
| 承認者・承認日 | **MISSING / MISSING** |
| 再審査期限 | **MISSING**。§12 の解除証拠が揃った場合、または artifact、license、dataset terms、製品用途が変わった場合に再審査する |
| checkpoint binary download | **NOT_RUN**。本調査ではモデル本体を取得していない |
| 最終判定 | **HOLD — 検出 C6 承認 0 件** |
| G-DEP-07 / Gate 2 | **BLOCKED** |
| SPI-12 完了条件 | **未達**。調査記録は作成したが、license / data / intended use / redistribution は全て known ではない |
| manifest | **未編集**。本記録を根拠に `resources/models/manifest.json` へ追加してはならない |

### 0.1 状態語

| 状態 | 意味 |
|---|---|
| `UNKNOWN` | 一次資料から事実を確定できない |
| `MISSING` | 必須の証拠文書、保存コピー、署名、hash、NOTICE 等が存在しない、または本調査で確保できていない |
| `NOT_RUN` | 技術試験または実測を実行していない |
| `HOLD` | 未承認。解除証拠が揃うまで同梱・製品利用・manifest 登録不可 |

`UNKNOWN` を推測で埋めず、`MISSING` を URL の存在だけで充足とせず、`NOT_RUN` を upstream 公開値で代替しない。

### 0.2 候補別判定

| 候補 | 厳密な対象 | 判定 | 主な停止理由 |
|---|---|---|---|
| TorchVision SSDLite320-MobileNetV3 Large | `SSDLite320_MobileNet_V3_Large_Weights.COCO_V1` / `ssdlite320_mobilenet_v3_large_coco-a79551df.pth` | **HOLD** | checkpoint 固有 license、商用利用、再配布条件、完全 SHA-256、COCO 各画像の権利 chain、保存済み一次資料、承認署名、safe load、ONNX/parity/実機試験が不足 |
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
| NOTICE inventory | **MISSING**。固定 tree 全体の NOTICE path 監査と最終配布 packet は本調査で実施していない |
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
| ImageNet backbone initialization | **UNKNOWN**。固定 recipe command に `--weights-backbone` はないが、この不在だけで exact artifact が ImageNet 非由来だとは証明しない |
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
| repository NOTICE inventory | **MISSING**。固定 tree 全体の NOTICE path 監査と製品配布 packet は本調査で実施していない |
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
| TorchVision C5 code | BSD-3-Clause license 本文 | final payload の copyright / conditions / disclaimer packet、NOTICE tree audit |
| SSDLite C6 checkpoint | 公式 URL と enum | checkpoint rightsholder、license、commercial / redistribution statement、required attribution |
| YOLOX C5 code | Apache-2.0 license 本文 | fixed tree NOTICE audit、license copy、変更表示、最終 attribution packet |
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
| FR-LIC-006 | **NOT PROVEN / HOLD** | SSDLite の exact recipe と YOLOX asset の完全 lineage がなく、ImageNet 非由来を断定しない。由来が判明しても自動承認しない |
| FR-LIC-007 | **FAIL / BLOCKED** | 両候補は COCO 由来。annotation と image rights を分離したが、全画像 evidence と法務書面判断がない |
| FR-LIC-008 | **NOT PROVEN / HOLD** | 公開資料に Open Images は明記されないが、完全 provenance がないため absence を断定しない |
| FR-LIC-011 | **FAIL / BLOCKED** | TorchVision は cache miss で自動 download。両候補とも product offline/network-zero test は NOT_RUN |
| FR-SEC-007 | **FAIL / BLOCKED** | `.pth` payload 未検査、安全 load / conversion 未実施 |
| NFR-ANN-004 | **FAIL / BLOCKED** | exact checkpoint hash、preprocess、threshold、seed、determinism が未確定 |
| NFR-SEC-003 / G-DEP-04 | **PARTIAL / BLOCKED** | C0で現lock 67 packageを監査しHigh/Critical 0、`torch` Low 1件を記録済み。SSDLite checkpoint payload固有監査と、lock未採用YOLOX code/checkpoint監査はNOT_RUN |
| G-DEP-07 | **FAIL / BLOCKED** | 承認可能な検出 C6 は 0 件 |

## 10. 完了チェックリスト

チェック済みは「調査項目を確認した」ことだけを示し、採用承認を意味しない。

### 10.1 識別・分離審査

- [x] SSDLite exact enum / URL と YOLOX exact tag / commit / release asset ID を記録した
- [x] C5 code / C6 checkpoint / C8 training data を独立欄で判定した
- [x] TorchVision BSD-3-Clause と YOLOX Apache-2.0 を checkpoint license に流用していない
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

1. G-DEP-07 は両候補について失敗している。承認済み検出 C6 は **0**。
2. Gate 2 は **BLOCKED**。未承認 checkpoint を `resources/models/manifest.json`、`vendor/models/`、製品 bundle、既定 loader、Fine-Tuning、ONNX 変換経路へ入れてはならない。
3. SPI-16 は、別途権利確認済みの小さな fixture を使う場合を除き、本候補を用いた train/export parity へ進めない。本記録は候補 binary の取得許可ではない。
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
| YOLOX の二つの public URL を同一 artifact としていないか | README の `storage/0.0.1` と release `0.1.1rc0` は同名 | equivalence evidence を `MISSING` とし、selected asset を release ID / asset ID で限定した |
| source / release note の矛盾を隠していないか | YOLOX normalization removal と fixed demo normalization が両立しない | 矛盾を明示し、selected asset preprocess を `UNKNOWN` とした |
| `.pth` / state_dict 名称だけで安全としていないか | 両 loader が pickle-compatible load を行い得る | binary 未取得・payload 未検査・safe load NOT_RUN とし、FR-SEC-007 を blocked とした |
| `check_hash=True` で全 gate 合格としていないか | SSDLite は prefix 検査を行う | prefix integrity と full hash / payload safety / rights を分離した |
| public AP / FLOPs を製品実測または別artifactへ転用していないか | COCO AP 21.3 / 25.3 を品質合格へ転用しやすく、YOLOX 25.3はbyte sizeの異なるstorage asset側の表にある | 全parity/quality/performance/OS/EP試験を`NOT_RUN`とし、選択release assetの指標には使わない |
| 公開 recipe にないデータを「不使用」としていないか | ImageNet / Open Images / その他データの absence を推定しやすい | exact training lineage がないため非使用を断定せず `UNKNOWN` とした |
| URL 取得を保存証拠と誤認していないか | immutable URL があっても local saved copy/hash はない | 全 source の保存コピー / SHA-256 を `MISSING` とした |
| HOLD を一般的な違法判断にしていないか | governance decision と法的結論を混同しやすい | AutoVision Studio の fail-closed gate に限定し、法的助言ではないと明記した |
| research record を approval record に昇格していないか | 詳細な調査表が承認済みに見え得る | 承認者・日付 MISSING、C6 承認 0、manifest 未編集、G-DEP-07 / Gate 2 BLOCKED を明記した |

レビュー後も blocking evidence は解消していない。最終決定は **SSDLite HOLD、YOLOX-Nano HOLD、承認済み検出 C6 は 0 件、G-DEP-07 と Gate 2 は BLOCKED** のままとする。