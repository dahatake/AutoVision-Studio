# SPI-11 — 分類 Curated Base Weight 監査記録

> **厳格な fail-closed research record / 法的助言ではない**
> 本記録は公開された技術・ライセンス資料を分離整理したものであり、法的助言、利用許諾、採用承認ではない。コードの permissive license を checkpoint または学習データへ拡張していない。明示した `unknown`、未試験、承認者不在のいずれか一つでも残る限り、対象 weight を同梱・既定選択・manifest 登録してはならない。

## 0. 記録メタデータと結論

| 項目 | 値 |
|---|---|
| タスク | SPI-11 — Classification base weight 監査 |
| カテゴリー | C6（Curated Base Weight） / C5（構造コード） / C8（学習元データ）を独立審査 |
| 対象用途 | 初回の single-label multi-class 画像分類をローカル Fine-Tuning するための基盤重み |
| 調査日・全 URL 取得日 | **2026-09-03** |
| 記録作成者 | GitHub Copilot（技術調査のみ。承認権限なし） |
| 固定済み関連 runtime | `torch==2.11.0`、`torchvision==0.26.0`（TorchVision tag `v0.26.0` / commit `336d36e8db990a905498c73933e35231876e28bc`） |
| 法務・repository license decision authority の本記録への署名 | **なし / 承認者未指定** |
| 承認日 | **なし** |
| 再審査期限 | **設定なし**。§10 の解除証拠を受領した場合、または artifact・license・dataset terms・製品用途が変わった場合に再審査する |
| 法務確認 | **必須 / 未開始**。本記録に法務判断または repository license decision authority の risk acceptance はない |
| 最終判定 | **HOLD — C6 承認 0 件** |
| G-DEP-07 / Gate 2 | **BLOCKED** |
| manifest | **未編集**。本記録を根拠に追加してはならない |
| checkpoint binary download | **未実施**。承認を作るためだけの大容量 binary 取得は行っていない |

### 0.1 候補別判定

| 候補 | 厳密な対象 | 判定 | 主な停止理由 |
|---|---|---|---|
| DINOv2-small | `facebook/dinov2-small@ed25f3a31f01632728cabb09d1542f84ab7b0056` / `model.safetensors` | **保留（HOLD）** | LVD-142M の全画像由来・全 dataset terms・クロール元・権利処理が未確定。ImageNet-22k を直接含む。HF 変換 artifact と Meta 原版の chain of custody、最終 NOTICE、法務承認、技術試験も未完 |
| DINOv2 ViT-S/14 原版参照 | Meta hub ID `dinov2_vits14` / `dinov2_vits14_pretrain.pth` | **保留・選定外** | HF safetensors との同一 tensor 内容を未検証。完全 SHA-256 の公式 metadata なし。`.pth` を候補 artifact に採用していない |
| MobileNetV3 Large V1 | `MobileNet_V3_Large_Weights.IMAGENET1K_V1` | **現証拠・現配布形態では却下** | checkpoint 固有 license、商用利用、再配布、完全 SHA-256 が unknown。ImageNet-1K 由来で法務書面承認なし。既定 loader も安全形式・offline 条件未達 |
| MobileNetV3 Large V2 | `MobileNet_V3_Large_Weights.IMAGENET1K_V2`（0.26.0 の `DEFAULT`） | **現証拠・現配布形態では却下** | 同上 |
| MobileNetV3 Small V1 | `MobileNet_V3_Small_Weights.IMAGENET1K_V1`（0.26.0 の `DEFAULT`） | **現証拠・現配布形態では却下** | 同上 |

「却下」は AutoVision Studio の現行証拠ゲートに対する判断であり、第三者の利用が違法だという判断ではない。新しい一次資料と権限者の書面判断が揃った場合だけ再審査できる。

## 1. 適用した fail-closed 規則

| 規則 | 本記録での適用 |
|---|---|
| `docs/dependency-policy.md` §3 | `unknown`、研究限定、非商用限定、用途制限は承認へ読み替えない |
| 同 §4 / FR-LIC-005 | C5 コード、C6 checkpoint、C8 学習データを別々に判定する |
| 同 §5 | 浮動 `DEFAULT` ではなく、固定した `torchvision==0.26.0` の exact enum を記録する |
| 同 §6.1 / FR-LIC-004 | 名称、版、URL、完全 SHA-256、checkpoint license、データ由来・terms、再配布、NOTICE、一次資料、承認者、承認日を必須とする |
| 同 §10 | 証拠未完の C6 を追加・lock・manifest 登録しない |
| 同 §12 | G-DEP-07 の必須項目に一つでも `unknown` があるため Gate 2 を停止する |
| FR-LIC-006 | ImageNet 由来を自動的に商用可と判定しない |
| FR-LIC-007/008 | COCO / Open Images の非使用を、非開示データへ推測で拡張しない |

## 2. Candidate A — DINOv2-small

### 2.1 厳密な識別情報と artifact

| 項目 | 値 |
|---|---|
| 要求上の名称 | DINOv2-small |
| Meta のモデル同定 | DINOv2 ViT-S/14 distilled、hub ID `dinov2_vits14`、LVD-142M pretrained、register token なし |
| 評価対象 HF repository | `facebook/dinov2-small` |
| 固定 revision | `ed25f3a31f01632728cabb09d1542f84ab7b0056` |
| 選択した exact file | `model.safetensors` |
| 固定取得 URL | `https://huggingface.co/facebook/dinov2-small/resolve/ed25f3a31f01632728cabb09d1542f84ab7b0056/model.safetensors` |
| 正確な byte size | `88,249,960` bytes（HF API `siblings[].lfs.size`） |
| checkpoint SHA-256 | `ae1e99fcefd534ed978cdeb8326f08030c96e28b7a81ffcbc98a857c84d14be1`（HF API `siblings[].lfs.sha256`。binary を本調査で再計算していない） |
| HF Git blob ID | `e13b8fec08e8dd9ac531165e7c8c0ec7d467952a`。**SHA-256 として使用しない** |
| 代替 file | `pytorch_model.bin`、`88,297,097` bytes、HF LFS SHA-256 `1051e25b2ed69ddad24f3c41e7b6eed6e7f7d012103ea227e47eb82e87dc2050`。pickle 系 `.bin` のため本候補では選定外 |
| Meta 原版 URL | `https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/dinov2_vits14_pretrain.pth` |
| Meta 原版 HEAD size | `88,283,115` bytes |
| Meta 原版完全 SHA-256 | **unknown**。HEAD に `Digest` なし。ETag を SHA-256 とみなしていない |
| HF safetensors と Meta `.pth` の同一性 | **unknown**。サイズ差と形式差があり、tensor 単位の等価性・変換 provenance を示す publisher 証拠を確認できていない |

HF repository は `facebook` namespace にあるが、HF README 自身が「DINOv2 公開チームはこの HF model card を書いておらず、Hugging Face team が作成した」と明記する。したがって HF README と Meta の `MODEL_CARD.md` を同一著者の資料として扱わない。

### 2.2 三層分離審査

#### C5 — 構造コード

| 項目 | 調査結果 |
|---|---|
| Meta repository | `facebookresearch/dinov2` commit `7764ea0f912e53c92e82eb78a2a1631e92725fc8` |
| code license | Apache-2.0。Meta の source header と root `LICENSE` で確認 |
| 商用利用・再配布 | Apache-2.0 本文には非商用限定はなく、条件付きで使用・複製・頒布を許諾する。ただしこれは **C5 コード本文だけ**の技術的読取りであり法的助言ではない |
| NOTICE | 固定 commit の完全 tree に `NOTICE` / `NOTICE.*` は 0 件。Apache-2.0 の license copy、copyright/attribution、変更表示等の条件は別途残る |
| 実装経路 | Meta Hub code を使うか、HF Transformers の組込み `Dinov2Model` を使うか未決定。`transformers` は現行 lock に存在せず、依存審査も未実施 |
| C5 判定 | **コードのみ条件確認済み。C6/C8 の承認を意味しない** |

#### C6 — exact checkpoint

| 項目 | 調査結果 |
|---|---|
| license 表示 | Meta `MODEL_CARD.md`: Apache License 2.0。Meta README:通常 DINOv2 code と model weights を Apache-2.0 で公開。HF repository metadata: `license: apache-2.0` |
| exact HF file に独立した LICENSE file | **なし**。HF tree は `.gitattributes`、README、config、preprocessor、2 weight filesのみ |
| commercial use | Apache-2.0 本文に非商用限定はない。ただし exact HF 変換 artifact の publisher chain と C8 を含む製品利用の結論は **未確定** |
| redistribution | Apache-2.0 §4 条件を前提とする license 表示はあるが、HF 変換 artifact に対する正確な attribution/NOTICE packet と法務判断がないため製品再配布は **未承認** |
| modification / derivatives | Apache-2.0 の変更表示・notice 保持条件が候補。製品内 Fine-Tuning / ONNX 変換時の具体的表示は未決定 |
| checkpoint 層の用途制限 | Meta の通常 DINOv2 S/B/L/g card には研究限定・非商用限定を確認しなかった。repository 内の XRay-DINO / Cell-DINO 等の別 license を本候補へ混同していない |
| C6 判定 | **HOLD**。license signal はあるが chain of custody、NOTICE、法務署名、技術 gate が未完 |

#### C8 — 学習元データ

| 項目 | 調査結果 |
|---|---|
| 公称 training data | LVD-142M、最終 `142,109,386` images |
| ViT-S の生成方法 | LVD-142M で学習した ViT-g teacher から distilled。したがって small model も同データ由来として扱う |
| 直接含有が公開された dataset | ImageNet-22k、Google Landmarks v2 clean train、Mapillary SLS train |
| retrieval seed として公開された dataset | ImageNet-22k、ImageNet-1k train、CIFAR-10、CIFAR-100、Caltech101、CUB-200-2011、DTD、FGVC-Aircraft、Flowers-102、Food-101、Oxford-IIIT Pet、Stanford Cars、SUN397、Pascal VOC 2007/2012、ADE20K、Cityscapes、KITTI、NYU Depth V2、SUN RGB-D、Google Landmarks v2、AmsterTime、Met、Revisited Oxford/Paris。CIFAR-10/100はpaper Appendix C Table 18でretrieval useが示されるが、split、retrieval method、件数、final compositionは`unknown`で、直接含有とは扱わない |
| uncurated source | 論文は「公開された crawled web data repository」由来の 1.2B unique images とだけ記載し、repository 名、URL、snapshot、各画像 license/terms を特定していない |
| LVD-142M dataset card / terms URL | **unknown / 公開された採用可能な terms を確認できず** |
| 全 source dataset terms | **未収集・unknown**。論文の dataset 名一覧は利用条件一覧ではない |
| ImageNet | **由来あり**。ImageNet-22k を直接含み、ImageNet-1k/22k を retrieval に使用 |
| ImageNet terms | ImageNet 公式 access terms は Database を non-commercial research and educational purposes に限定する |
| COCO / Open Images | 公開 Table 15 には明記なし。ただし unnamed crawl の内容・全 provenance が非開示のため「含まれない」と断定しない。**unknown** |
| dataset commercial use / redistribution | **unknown**。ImageNet terms が derivative checkpoint へどう適用されるかを本記録は判断せず、権限者の書面審査へ送る |
| C8 判定 | **不適合状態（証拠不足）**。全 terms と legal determination がないため C6 同梱不可 |

### 2.3 Intended use と本製品用途

| 項目 | 調査結果 |
|---|---|
| Meta card の用途 | multi-purpose visual backbone。画像分類では class token 上の k-NN、logistic regression、linear layer。画像 retrieval や dense task も記載 |
| Fine-Tuning | 技術的に可能で、Meta card は小幅改善を報告する一方、必要時の最後の手段として推奨 |
| HF card の用途 | raw model の feature extraction。fine-tuned task head は含まない |
| 本製品との技術的対応 | custom classifier を付けた分類 Fine-Tuning は技術用途の範囲に見えるが、権利適合、品質、性能を意味しない |
| 明示 out-of-scope | Meta card に独立した out-of-scope 一覧は見当たらない。bias/limitations として wealthy Western households 偏重等を記載 |
| 製品利用判定 | **HOLD**。用途説明だけを commercial redistribution の許可へ読み替えない |

### 2.4 形式・remote code・offline 境界

| 項目 | 調査結果 |
|---|---|
| 選択形式 | `safetensors`。metadata 上は安全形式候補。binary 内容検査は未実施 |
| HF config | `architectures: ["Dinov2Model"]`、`model_type: "dinov2"`、`auto_map` なし。custom remote code 宣言は確認しなかった |
| HF loader | README の `AutoModel.from_pretrained(...)` は未キャッシュ時に network を使う。製品では禁止し、固定 local file、offline/local-only、事前 hash 検証が必要 |
| Meta loader | current pinned Meta code は PyTorch 2.1+ で `weights_only=True` を指定する。ただし `torch.hub.load('facebookresearch/dinov2', ...)` は repository code と weight を取得・実行するため製品 runtime では禁止 |
| 現行製品 lock | HF Transformers/DINOv2 構造実装が未採用。remote code 不要であることと transitive dependency/payload をまだ実証していない |
| 判定 | **HOLD**。safe file extension だけで offline、安全 load、ONNX 互換を合格にしない |

## 3. Candidate B — TorchVision MobileNetV3 weights

### 3.1 exact identifiers と公式 artifact metadata

固定対象は `torchvision==0.26.0` のみ。`DEFAULT` は将来版で変化し得るため、以下の enum 名を正本とする。

| exact enum | 0.26.0 alias | file / URL | 正確な HEAD size | 公式 SHA-256 情報 | 判定 |
|---|---|---|---:|---|---|
| `MobileNet_V3_Large_Weights.IMAGENET1K_V1` | — | `mobilenet_v3_large-8738ca79.pth` / `https://download.pytorch.org/models/mobilenet_v3_large-8738ca79.pth` | `22,139,423` bytes | prefix `8738ca79` のみ。完全値 **unknown** | 却下 |
| `MobileNet_V3_Large_Weights.IMAGENET1K_V2` | `MobileNet_V3_Large_Weights.DEFAULT` | `mobilenet_v3_large-5c1a4163.pth` / `https://download.pytorch.org/models/mobilenet_v3_large-5c1a4163.pth` | `22,132,113` bytes | prefix `5c1a4163` のみ。完全値 **unknown** | 却下 |
| `MobileNet_V3_Small_Weights.IMAGENET1K_V1` | `MobileNet_V3_Small_Weights.DEFAULT` | `mobilenet_v3_small-047dcff4.pth` / `https://download.pytorch.org/models/mobilenet_v3_small-047dcff4.pth` | `10,306,551` bytes | prefix `047dcff4` のみ。完全値 **unknown** | 却下 |

PyTorch 2.11 の公式 `torch.hub.load_state_dict_from_url` は `check_hash=True` のとき、ファイル名の `-<sha256>.` 部分を **SHA-256 の先頭 8 桁以上**として検査する。TorchVision MobileNetV3 は `check_hash=True` を渡す。よって上の 8 桁は prefix としては検証可能だが、FR-LIC-004 が要求する 64 桁の checkpoint SHA-256 ではない。CDN の ETag は multipart 形式で、`Digest` header はなく、いずれも SHA-256 として記録していない。

### 3.2 三層分離審査

#### C5 — TorchVision 構造コード

| 項目 | 調査結果 |
|---|---|
| repository / version | `pytorch/vision` commit `336d36e8db990a905498c73933e35231876e28bc` / `v0.26.0` |
| code license | BSD-3-Clause |
| commercial use / redistribution | BSD-3-Clause の条件下で code の source/binary redistribution を許諾。copyright、条件、免責文の保持と endorsement 禁止が必要。**checkpoint には適用していない** |
| NOTICE | 完全 tree に `NOTICE` / `NOTICE.*` は 0 件。BSD license 本文の伝播義務は残る |
| C5 判定 | **コードのみ条件確認済み。checkpoint/data の判定とは独立** |

#### C6 — MobileNetV3 checkpoint files

| 項目 | 調査結果 |
|---|---|
| checkpoint 固有 license | **unknown**。weight file、weight enum、recipe に checkpoint へ適用される独立 license text を確認できず |
| TorchVision 公式注意 | pre-trained model は学習 dataset 由来の独自 license / terms を持ち得るため、用途に対する permission は利用者が判断すべきと明記 |
| commercial use | **unknown**。BSD-3-Clause code license を根拠に「可」としていない |
| redistribution | **unknown**。installer 同梱を明示許諾する checkpoint 条件を確認できず |
| modification / derivatives | **unknown**。Fine-Tuning、形式変換、再配布の checkpoint 固有条件なし |
| complete checkpoint SHA-256 | 3 files とも **unknown** |
| NOTICE / attribution | weight 固有内容は **unknown**。TorchVision code を同梱する場合の BSD notice とは別 |
| C6 判定 | **現証拠・現配布形態では却下** |

#### C8 — ImageNet-1K

| 項目 | 調査結果 |
|---|---|
| training dataset | 3 weight enum とも metadata は `ImageNet-1K` |
| recipe | V1 Large/Small は公式 MobileNetV3 reference recipe。Large V2 は公式 issue #3995 の new recipe + regularization tuning |
| ImageNet terms | 公式 access terms: Database は non-commercial research and educational purposes のみ |
| dataset redistribution | 研究仲間への access も事前に同条件への同意が必要。dataset 自体を製品へ同梱する計画はないが、この事実で derived checkpoint の条件を自動決定しない |
| checkpoint への影響 | **法的判断未実施 / unknown**。ImageNet terms が weight へ当然に継承されるとも、継承されないとも本記録では断定しない |
| legal approval | **なし**。名称・役割・日付を伴う書面承認なし |
| COCO / Open Images | 公式 enum/recipe は ImageNet-1K のみを記載。COCO/Open Images を使用した証拠は確認しなかったが、これは公開 recipe の記録であり独立 provenance audit の代替ではない |
| C8 判定 | **現製品用途では不適合状態**。FR-LIC-006 により自動承認不可 |

### 3.3 Intended use と形式・remote code

| 項目 | 調査結果 |
|---|---|
| 公開用途 | ImageNet-1K の image classification。weights metadata は 1,000 categories と分類精度を持つ |
| product Fine-Tuning | structure と weight は transfer learning に技術利用できる可能性があるが、weight 固有 model card / commercial redistribution statement はない |
| dedicated out-of-scope | **unknown / 専用 model card を確認できず** |
| file format | `.pth` の serialized `state_dict` |
| loader safety | TorchVision `WeightsEnum.get_state_dict` は PyTorch Hub loader へ委譲し、MobileNetV3 呼出しは `weights_only=True` を指定しない。固定 PyTorch 2.11 loader の既定は `weights_only=False` |
| network | cache がなければ公式 URL から自動 download。FR-LIC-011 の runtime download 禁止に不適合 |
| remote repository code | TorchVision package を local lock から使う限り不要。ただし checkpoint を安全な local artifact として読む経路は未実装 |
| 必要な是正 | 権利承認後に限り、完全 hash で固定した build-time artifact を `weights_only=True` で隔離検査し、safetensors/ONNX 等へ変換して再 hash。runtime network を明示拒否 |
| 判定 | **却下**。`.pth` が state_dict であることだけを安全形式合格にしない |

### 3.4 C6 タスク仕様・推論定義

この欄は upstream artifact の現状と、将来の製品 Fine-Tuning 定義を分ける。公開 preprocessor を記録しただけでは製品 pipeline の採用・再現性を確定しない。

| 項目 | DINOv2-small HF artifact | MobileNetV3 TorchVision artifacts |
|---|---|---|
| C6 での役割 | 分類 head を持たない feature backbone 候補 | ImageNet-1K 分類済み backbone/head を transfer learning する候補 |
| upstream input | 3-channel RGB。HF config は `num_channels=3`、architecture の `image_size=518`、patch size 14 | PIL image、single `(C,H,W)` または batched `(B,C,H,W)` tensor。モデル先頭は 3 channels |
| upstream preprocess | RGB 変換、shortest edge 256、center crop 224×224、bicubic (`resample=3`)、`1/255` rescale、mean `(0.485,0.456,0.406)`、std `(0.229,0.224,0.225)` | Large V1 / Small V1: bilinear resize 256、center crop 224。Large V2: bilinear resize 232、center crop 224。全て antialias、`[0,1]` 変換、同じ ImageNet mean/std |
| upstream output | `Dinov2Model`、hidden size 384 の token/pooled representation。選択 artifact に task-specific classifier はない | 1,000 ImageNet category logits。exact category list は固定 TorchVision metadata 由来 |
| 製品 Fine-Tuning input / preprocess | **unknown**。HF processor の 224 crop と architecture config の 518 nominal image sizeを含め、固定 shape・augmentation・train/eval 差を SPI-15 で決定する | **unknown**。V1/V2 のどの preprocess を採用し、training augmentation と export input shape をどう固定するか未決定 |
| 製品 output / label mapping | **unknown**。project class 数の logits、label index、softmax/top-k 定義が未決定 | **unknown**。1,000-class head の置換方法、project class 数、label index、softmax/top-k 定義が未決定 |
| confidence threshold | `N/A（C6 基盤重み）`。将来の分類 UI に threshold を設ける場合は別途固定する | 同左 |
| prompt | `N/A（C6 分類）` | `N/A（C6 分類）` |
| seed / deterministic inference | **未試験・未定義** | **未試験・未定義** |
| NFR-ANN-004 状態 | **未適合**。exact product input、preprocess、head、label map、seed、checkpoint/derived ONNX hash が未確定 | **未適合**。同左 |

## 4. 未実施の技術・品質・セキュリティ試験

公開 model card / recipe の精度値は upstream の参考値であり、AutoVision Studio の実測値ではない。以下はすべて **NOT RUN** で、他 OS・他候補・公開値による代替をしていない。

| 試験 | 状態 | 承認への影響 |
|---|---|---|
| exact candidate binary の local 取得・64 桁 SHA-256 再計算 | NOT RUN | DINO は公式 metadata hash のみ。MobileNet は完全 hash 不明 |
| tensor 名・shape・dtype・NaN/Inf・予期しない object の検査 | NOT RUN | format metadata だけでは payload 検査にならない |
| unsafe pickle / `weights_only=True` 隔離 load | NOT RUN | MobileNet `.pth` は未合格 |
| runtime network 0 / offline load | NOT RUN | FR-LIC-011 未合格 |
| Fine-Tuning と scratch baseline 比較 | NOT RUN | FR-TRN-003 未合格 |
| 固定 input の ONNX export | NOT RUN | POC-08 未合格 |
| tensor `rtol <= 1e-3` / `atol <= 1e-4` | NOT RUN | parity 未合格 |
| 分類 top-1 一致率 `>= 99.5%` / 指標低下 `<= 0.005` | NOT RUN | parity 未合格 |
| Windows 11 x64 / CPU | NOT RUN | OS/EP gate 未合格 |
| Windows 11 x64 / DirectML | NOT RUN | operator coverage・性能 unknown |
| macOS arm64 / CPU | NOT RUN | native Mac 証拠なし |
| macOS arm64 / CoreML | NOT RUN | operator coverage・性能 unknown |
| p95 latency、FPS、peak memory、installer size | NOT RUN | 100 ms / 10 FPS / payload budget unknown |
| deterministic inference 条件 | NOT RUN | seed・preprocess・device 差を未検証 |
| candidate code/checkpoint の Critical/High CVE review | NOT RUN | G-DEP-04 未合格 |
| adversarial robustness / domain bias の製品評価 | NOT RUN | model card の bias 記載を製品評価へ代用しない |
| representative product dataset の品質・精度 | NOT RUN | 採用品質 unknown |

C6 のため C7 専用 manual-only vs assisted annotation 比較は SPI-11 の対象外。ただし将来同じ checkpoint を C7 として使用するなら FR-LIC-014 / NFR-ANN-006 を別記録で全件実施する。

## 5. HTTP artifact metadata（binary body 未取得）

| URL | HTTP | Content-Length | ETag | Last-Modified | `Digest` |
|---|---:|---:|---|---|---|
| `https://download.pytorch.org/models/mobilenet_v3_large-8738ca79.pth` | 200 | 22,139,423 | `"25bde0c0e8d3a081f45d0f55df771eb5-3"` | 2021-01-12T11:22:16Z | なし |
| `https://download.pytorch.org/models/mobilenet_v3_large-5c1a4163.pth` | 200 | 22,132,113 | `"dbd7cdfa3b2e2a4374e3c9299710fbf6-2"` | 2021-11-15T13:04:06Z | なし |
| `https://download.pytorch.org/models/mobilenet_v3_small-047dcff4.pth` | 200 | 10,306,551 | `"52e68121986d23072b5e47d09fe1f757-2"` | 2021-02-08T11:56:01Z | なし |
| `https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/dinov2_vits14_pretrain.pth` | 200 | 88,283,115 | `"0bd1417efc23bdb1d69200156f5a22bc-11"` | 2023-04-13T22:01:20Z | なし |

ETag は SHA-256 ではなく、完全性 gate へ使用しない。

## 6. 一次資料・取得 bytes SHA-256

### 6.1 記録方法

- すべて 2026-09-03 に公式 repository、公式 model repository、公式 paper host、公式 dataset site から取得した。
- SHA-256 は .NET `HttpClient.GetByteArrayAsync` が返した **HTTP response body bytes** に対して計算した。publisher signature ではない。
- モデル binary は取得していない。HF の checkpoint SHA-256 は official artifact API metadata から取得した値であり、本節の source-document hash と区別する。
- immutable commit/revision URL を優先した。ImageNet terms、HF API、GitHub issue のような可変 source は response hash を得たが、repository 内に保存 copy は作っていない。この保存 copy 不在自体を G-DEP-07 の不足として扱う。

### 6.2 DINOv2 / HF / training data

| 資料 | 公式 URL | 取得 bytes | 取得 bytes SHA-256 | 主な根拠 |
|---|---|---:|---|---|
| Meta README | `https://raw.githubusercontent.com/facebookresearch/dinov2/7764ea0f912e53c92e82eb78a2a1631e92725fc8/README.md` | 32,799 | `d1bc2e9686522bbd66ed6123dc81eb36b3a98e8ea9a2ca97778f54a1c641c9e1` | hub ID、通常 code/weights license、原版配布 |
| Meta model card | `https://raw.githubusercontent.com/facebookresearch/dinov2/7764ea0f912e53c92e82eb78a2a1631e92725fc8/MODEL_CARD.md` | 9,152 | `70ca59606bee0a5fbb1baec80e7e29a93cd7cfbe26ca1910c52a852c4aab09d0` | intended use、bias、LVD-142M、Apache-2.0 |
| Meta LICENSE | `https://raw.githubusercontent.com/facebookresearch/dinov2/7764ea0f912e53c92e82eb78a2a1631e92725fc8/LICENSE` | 11,359 | `600cc67cc4cb2f5ea317dcfc687ad1c74dc4bec8782bbe9db0afd83513b935b7` | Apache-2.0 全文 |
| Meta hub backbones | `https://raw.githubusercontent.com/facebookresearch/dinov2/7764ea0f912e53c92e82eb78a2a1631e92725fc8/dinov2/hub/backbones.py` | 5,586 | `871fca671b12a9ff02e810654baf509e97ccf461bf8196ce5ddeefff2fd87d3e` | `dinov2_vits14` と URL 組立て |
| Meta hub utils | `https://raw.githubusercontent.com/facebookresearch/dinov2/7764ea0f912e53c92e82eb78a2a1631e92725fc8/dinov2/hub/utils.py` | 1,598 | `579613e3d7b82c2a387eddc215ad9f076b8740f9618229628395fe5755dbd131` | base URL、PyTorch 2.1+ `weights_only=True` |
| Meta repository tree | `https://api.github.com/repos/facebookresearch/dinov2/git/trees/7764ea0f912e53c92e82eb78a2a1631e92725fc8?recursive=1` | 66,329 | `425dab531ef8589a8dc410b873a5afaca1327a2cdea3d97b535a3db89120dd4a` | response `truncated=false`、NOTICE path 0 |
| HF model API | `https://huggingface.co/api/models/facebook/dinov2-small?blobs=true` | 4,072 | `f96f9167a9a9e9b5804e04b1830676624b99a54ac54b655e8c715f033533f5ba` | revision、file size、LFS SHA-256、license metadata |
| HF tree API | `https://huggingface.co/api/models/facebook/dinov2-small/tree/main?recursive=true&expand=true` | 6,536 | `6a77e2ef6e16c9158152f28d3034de0bf39fc775285f75bf715309559488d072` | exact files、LFS oid/size、LICENSE/NOTICE file 不在。可変APIのため再取得時に差分審査が必要 |
| HF README | `https://huggingface.co/facebook/dinov2-small/raw/ed25f3a31f01632728cabb09d1542f84ab7b0056/README.md` | 3,033 | `4c20dca454a8e5c670e8de5c7e6040f512aeca5438516f7623eedc4e3b00599c` | HF card の著者 disclaimer、feature extraction |
| HF config | `https://huggingface.co/facebook/dinov2-small/raw/ed25f3a31f01632728cabb09d1542f84ab7b0056/config.json` | 547 | `1809f83e3bdb1609a501a610ad4a742f4fd8ae44d72ca4aa0df52d1f2ac8628d` | built-in `Dinov2Model`、`auto_map` 不在 |
| HF preprocessor | `https://huggingface.co/facebook/dinov2-small/raw/ed25f3a31f01632728cabb09d1542f84ab7b0056/preprocessor_config.json` | 436 | `14e780d86fa1861f8751f868d7f45425b5feb55c38ca26f152ca5097ab30f828` | RGB、resize/crop、normalization metadata |
| DINOv2 paper v2 | `https://arxiv.org/html/2304.07193v2` | 460,611 | `db2e8fa25d3e29e24acf9464668e5e841c6af98b1b514e840e16f98d1657d9f7` | LVD-142M 構成、unnamed crawl、distillation、用途 |
| ImageNet terms | `https://www.image-net.org/download.php` | 6,846 | `275647ff587098083f5c53ccf5aa07a4732ca08b81822964c88e5ab40ad07ad4` | non-commercial research / educational access terms |

### 6.3 TorchVision / MobileNetV3

| 資料 | 公式 URL | 取得 bytes | 取得 bytes SHA-256 | 主な根拠 |
|---|---|---:|---|---|
| MobileNetV3 source | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/torchvision/models/mobilenetv3.py` | 16,300 | `5444909362734ab54f07ba64cd2d54e90854965d4d1ce6b2b337e055d0fcbb3e` | enum、URL、DEFAULT、ImageNet metrics、recipe、`check_hash=True` |
| TorchVision weight API | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/torchvision/models/_api.py` | 9,964 | `fdcb80072255feca18b21f43d1cb9433630118ec925e1a89cc66d0b2a39efe50` | Hub loader への委譲 |
| TorchVision classification preset | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/torchvision/transforms/_presets.py` | 8,504 | `5e5a7b80b2e73d00a3a7c798ef0f6e44ab90295eb02ecef5659308bc28219670` | input type、resize/crop、mean/std、bilinear、antialias |
| TorchVision loader bridge | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/torchvision/_internally_replaced_utils.py` | 1,459 | `e6333b00f1b4b125d240766f81aeb7deb418dba5604ac807d1e3af079a18c66b` | PyTorch Hub loader の直接 import |
| TorchVision model policy | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/docs/source/models.rst` | 17,507 | `d2ebddab57d902b26603ae25c238598b89a6c969afd8644a9fdfa0cc6d9d7b2c` | weight/data terms の独立注意、runtime download、DEFAULT 可変 |
| Classification recipe | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/references/classification/README.md` | 16,653 | `f7d92cb018bc38f609967d768c02899f678828b6dec2a68f10f2645b987f0c10` | MobileNetV3 Large/Small V1 recipe |
| TorchVision LICENSE | `https://raw.githubusercontent.com/pytorch/vision/336d36e8db990a905498c73933e35231876e28bc/LICENSE` | 1,517 | `6502f676851cfe25f8af75531dfb32375b7325b73c37e7b43741fa422893e71d` | BSD-3-Clause code license |
| TorchVision repository tree | `https://api.github.com/repos/pytorch/vision/git/trees/336d36e8db990a905498c73933e35231876e28bc?recursive=1` | 213,832 | `bcee7aa815b65c9011194782e6f90bd2007c4b17687e6ec68041b44dbaac8a4c` | response `truncated=false`、NOTICE path 0 |
| Large V2 recipe issue | `https://api.github.com/repos/pytorch/vision/issues/3995` | 11,853 | `9c2db6c68a0b27276f9c40f44bce0bfa401688b9133ee0adae8aec0ce22e8ae6` | ImageNet new recipe + regularization tuning |
| PyTorch 2.11 Hub source | `https://raw.githubusercontent.com/pytorch/pytorch/70d99e998b4955e0049d13a98d77ae1b14db1f45/torch/hub.py` | 33,647 | `aec7a621fd70f11295d18307d246293e63e7a578c807ad1e94251eef96485efa` | SHA-256 prefix semantics、`weights_only=False` default |

`torchvision/_internally_replaced_utils.py` は固定 commit で `torch.hub.load_state_dict_from_url` をそのまま import する。TorchVision 0.26 release page は tag `v0.26.0`、commit `336d36e…`、torch 2.11 compatibility を明記するが、動的 HTML の保存 copy/hash は本記録に採用していない。

## 7. NOTICE / attribution の現状

| 対象 | 現時点で確認できた内容 | 不足 |
|---|---|---|
| DINOv2 Meta code / normal model weights | Apache-2.0 表示。固定 tree に NOTICE file なし | exact HF safetensors へ適用する copyright/attribution 文、変更表示、license copy の最終 packet と権限者確認 |
| Apache-2.0 特許条項 | 取得した Apache-2.0 本文 §3 に contributor からの express patent license grant がある | exact HF 変換 artifact に対する権利主体・適用範囲と製品配布時の最終確認 |
| HF `facebook/dinov2-small` | metadata は Apache-2.0。repository 内に LICENSE/NOTICE file なし | publisher が exact converted artifact へ適用する license/notice を明記した immutable statement |
| TorchVision code | BSD-3-Clause license 本文。固定 tree に NOTICE file なし | 最終 payload の `THIRD_PARTY_NOTICES` へ BSD copyright・条件・免責全文を反映する作業 |
| MobileNetV3 weights | **unknown** | weight 固有 license、copyright holder、required attribution、再配布条件 |
| ImageNet / LVD-142M | dataset を同梱しない | derived checkpoint 利用に必要な attribution/permission の有無を権限者が書面判断する資料 |
| アプリ内ライセンス画面 | **未作成 / 表示文字列 unknown** | exact artifact 採用後に `THIRD_PARTY_NOTICES` と一致する表示文を確定する |

`THIRD_PARTY_NOTICES` への具体的な最終文字列は確定していない。「NOTICE file がない」を「表示義務がない」へ読み替えない。

## 8. FR-LIC-004〜008 トレーサビリティ

| 要求 | 状態 | 根拠・不足 |
|---|---|---|
| FR-LIC-004 | **FAIL / BLOCKED** | DINO HF safetensors の id/URL/size/hash は known。MobileNet の完全 hash、weight license、全 data terms、NOTICE、承認者・承認日、保存 copy が不足 |
| FR-LIC-005 | **PASS（調査手順のみ）** | C5/C6/C8 を分離し、Apache/BSD code license だけで checkpoint を承認していない |
| FR-LIC-006 | **FAIL / BLOCKED** | 全候補が ImageNet 由来。公式 non-commercial access terms を確認したが、製品利用の法務書面承認なし |
| FR-LIC-007 | **NOT PROVEN / HOLD** | 公開 recipe/Table 15 に COCO は明記されない。DINO の unnamed crawl と全 provenance が unknown のため absence を断定しない |
| FR-LIC-008 | **NOT PROVEN / HOLD** | 公開 recipe/Table 15 に Open Images は明記されない。DINO の unnamed crawl と全 provenance が unknown のため absence・帰属不要を断定しない |

## 9. 完了チェックリスト

チェック済みは「調査項目を確認した」ことだけを表し、モデル承認ではない。

### 9.1 識別・三層審査

- [x] 要求にある DINOv2-small と MobileNetV3 Small/Large の actual weight enum を列挙した
- [x] 浮動 `DEFAULT` を TorchVision 0.26.0 の exact enum へ解決した
- [x] C5 code / C6 checkpoint / C8 training data を別欄で判定した
- [x] code license を checkpoint license または data permission と同一視していない
- [x] HF card の著者を Meta card の著者と同一視していない
- [x] upstream input / preprocess / output を候補別に記録し、未確定の製品 head・label map・seed を `unknown` / 未試験とした

### 9.2 hash・source・NOTICE

- [x] DINO HF safetensors の authoritative artifact metadata SHA-256 と byte size を記録した
- [ ] DINO HF safetensors と Meta 原版 `.pth` の publisher-verified equivalence がある
- [ ] Meta 原版 `.pth` の authoritative complete SHA-256 がある
- [ ] MobileNet 3 files の authoritative complete SHA-256 がある
- [x] 8 桁 hash prefix、Git blob ID、ETag を 64 桁 checkpoint SHA-256 と誤認していない
- [x] 主要一次資料 URL・取得日・取得 response bytes SHA-256 を記録した
- [ ] 可変一次資料の保存 copy と保管 path がある
- [ ] exact checkpoint ごとの最終 NOTICE / attribution packet が確定した

### 9.3 training data・commercial use

- [x] DINOv2-small を LVD-142M / distilled と特定した
- [x] 公開された LVD-142M 構成 dataset と unnamed crawl を記録した
- [ ] LVD-142M の全 source、全 image rights、全 dataset terms が known である
- [x] MobileNetV3 3 files を ImageNet-1K 由来と特定した
- [x] ImageNet 公式 non-commercial research / educational access terms を確認した
- [ ] ImageNet/LVD-142M 由来 checkpoint の本製品での商用利用・再配布について、権限者の書面判断がある
- [ ] checkpoint 固有の commercial use と installer redistribution が全候補で明示されている
- [x] dataset terms が weight へ自動的に継承する／しないという法的結論を出していない

### 9.4 safe format・offline・技術 gate

- [x] DINO の safetensors metadata、HF config の custom remote code 宣言不在を確認した
- [x] MobileNet `.pth` の既定 loader が `weights_only=False` であることを固定版 source で確認した
- [ ] exact binary の隔離 payload inspection と safe local load が成功した
- [ ] runtime download / remote code 0 を packet capture と offline test で確認した
- [ ] ONNX export と tensor/classification parity が合格した
- [ ] Windows CPU / DirectML が合格した
- [ ] macOS arm64 CPU / CoreML が合格した
- [ ] Fine-Tuning vs scratch、精度、p95、FPS、memory、installer size が採用基準を満たした
- [ ] deterministic inference と Critical/High CVE gate が合格した

### 9.5 release decision

- [ ] named legal approver または repository license decision authority が署名した
- [ ] 承認日が記録された
- [ ] SBOM / `THIRD_PARTY_NOTICES` が更新・検証された
- [ ] approved manifest entry が作成された
- [x] 本調査では manifest を編集していない
- [x] 再審査条件と法務確認の未開始状態を明記した
- [x] 最終判定を **HOLD / C6 承認 0 / Gate 2 BLOCKED** と明記した

## 10. 再審査に必要な precise evidence

### 10.1 DINOv2-small

1. Meta または exact HF artifact の権利者による、`facebook/dinov2-small@ed25f3a…/model.safetensors` と Meta `dinov2_vits14_pretrain.pth` の provenance / tensor-equivalence、ならびに Apache-2.0 が exact bytes へ適用されることを示す immutable statement。
2. LVD-142M の完全な source inventory。少なくとも direct inclusion、retrieval seed、retrieved crawl snapshot/source、各画像・dataset の terms、商用学習、derived weight の利用・再配布、attribution を一対一に対応付けた資料。
3. ImageNet-22k を直接含むこと、unnamed web crawl、Google Landmarks v2、Mapillary SLS、各 retrieval seed を踏まえた、named approver による本製品用途・Fine-Tuning・ONNX 変換・installer redistribution の書面判断。これは source terms が weight へ自動継承するとの断定ではなく、未解決点への判断を求めるもの。
4. Exact Apache license/copyright/NOTICE/変更表示を含む配布 packet と `THIRD_PARTY_NOTICES` 文案。
5. Offline architecture path の決定。HF Transformers を使うなら exact package/transitive lock と local-only test、Meta code を使うなら pinned/vendor code と `torch.hub` network/remote execution の除去。
6. 上記の権利証拠が先に通過した後、exact safetensors の controlled retrieval、metadata hash 照合、tensor inspection、ONNX/parity、両 OS/EP、Fine-Tuning/scratch、性能・品質・脆弱性試験。

### 10.2 TorchVision MobileNetV3

1. PyTorch/TorchVision publisher による、3 exact `.pth` files それぞれの checkpoint license、commercial use、modification、installer redistribution、copyright/attribution/NOTICE を明示した immutable statement。TorchVision code の BSD license だけでは代替不可。
2. 3 exact files の publisher checksum manifest による 64 桁 SHA-256。公式 full checksum が提供されない場合は、組織の証拠手順が許可した controlled build-time retrieval と独立二者照合を別途承認すること。本調査では download して値を作らない。
3. ImageNet-1K access terms と exact product scenario を添付した named approver の書面判断。用途は local commercial Fine-Tuning、派生 ONNX、self-contained installer への base checkpoint 同梱、顧客端末での利用を明記する。
4. Weight 固有の再配布条件と code BSD 条件を分離した `THIRD_PARTY_NOTICES` 文案。
5. 権利 gate 通過後、`.pth` を `weights_only=True` で隔離 loadし、tensor-only を確認して safetensors/ONNX へ変換、source と derived artifact の双方を完全 SHA-256 で固定する。runtime download は拒否する。
6. SPI-15/SPI-08 で exact candidate ごとの Fine-Tuning/scratch、ONNX parity、Windows CPU/DirectML、native macOS CPU/CoreML、p95/FPS/memory/size、determinism、CVE を実測する。

### 10.3 Gate 2

上記証拠の一部だけでは解除しない。少なくとも一つの分類 C6 candidate について、G-DEP-07 の全項目、named approval、SPI-15 の parity/quality/performance、対象 OS/EP の実測がすべて完了した後に SPI-18 で manifest 採否を判断する。本記録単独では Gate 2 を解除できない。

## 11. Self-adversarial review

| 攻撃的確認 | 発見した具体的リスク | 本記録での修正・最終状態 |
|---|---|---|
| code license = weight license としていないか | TorchVision BSD-3-Clause を MobileNet checkpoint へ流用しやすい | C5/C6 を分離し、weight license/commercial/redistribution を `unknown`、候補を却下とした |
| weight license = data permission としていないか | DINOv2 の Apache-2.0 表示だけで LVD-142M を閉じる危険 | LVD-142M、ImageNet、unnamed crawl、全 terms 不足を C8 blocker とし、DINO を HOLD にした |
| HF card を Meta 作成と誤認していないか | `facebook` namespace だけで著者を推定する危険 | HF README の disclaimer を記録し、Meta `MODEL_CARD.md` と別資料にした |
| 短い hash / ETag / Git oid を完全 SHA-256 にしていないか | MobileNet filename の 8 桁、multipart ETag、HF blob ID を誤採用する危険 | DINO LFS SHA-256 だけを full hash とし、他は prefix/ETag/blob ID と明示して `unknown` を維持した |
| ImageNet terms が weight へ当然に伝播すると断定していないか | 法的結論を技術記録が代行する危険 | 伝播する／しないの双方を断定せず、named approver の書面判断を要求した |
| intended use = commercial permission としていないか | 分類/Fine-Tuning の技術用途を再配布許諾へ読み替える危険 | intended use と C6/C8 rights を別節にし、用途適合を承認に使っていない |
| safetensors / state_dict という名称だけで安全判定していないか | binary 未検査、TorchVision loader の `weights_only=False`、runtime download を見落とす危険 | DINO も payload inspection 未実施、MobileNet は安全形式未合格、両者 offline test 未実施とした |
| 法的助言・違法性判断を主張していないか | 「却下」を第三者一般への違法判断と読める危険 | AutoVision Studio の現行 fail-closed gate に限定し、冒頭と候補判定で法的助言ではないと明記した |
| 公開 benchmark を自社実測にしていないか | upstream accuracy を POC 合格へ転用する危険 | OS/EP/parity/performance/quality/security を全て NOT RUN とした |
| 研究記録を承認記録へ昇格していないか | hash が一件得られたことで DINO を approved と誤読する危険 | 承認者・承認日なし、C6 承認 0、manifest 未編集、Gate 2 BLOCKED を複数箇所で明示した |
| 採用テンプレートの必須欄を暗黙のままにしていないか | 再審査・法務状態、製品 input/preprocess/output が散在または未記録になる危険 | メタデータと §3.4 を追加し、upstream 既知値と製品 pipeline の `unknown` を分離した。preset/loader source hash も追加取得した |

レビュー後も blocking unknown は解消していない。したがって最終決定は **HOLD、MobileNetV3 3 weights は現配布形態で却下、DINOv2-small は保留、承認済み分類 C6 は 0、Gate 2 は BLOCKED** のままとする。
