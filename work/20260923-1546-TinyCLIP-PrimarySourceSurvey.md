# TinyCLIP 一次資料調査（C7C-01）

> **厳格な fail-closed research record / 法的助言ではない**
>
> 対象は `wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M` revision `a2a8c6eaa2549ad66eb7c31b85022bf58273a26c`。一次資料の原文に書かれていない用途・由来は推測で補わない。

## 0. 結論

| 項目 | 結論 |
|---|---|
| Intended use / out-of-scope | **確認できない**。HF model card、microsoft/Cream `TinyCLIP` folder、論文抽出 text に `Intended Use` / `Out-of-Scope Use` 相当の明示節または本製品用途との適合を判断できる文言は見つからなかった。`pipeline_tag: zero-shot-image-classification` と推論例はあるが、adoption-template §8 の intended / out-of-scope 記録を代替しない。 |
| teacher provenance | **直接の teacher のみ確認**。論文は YFCC-15M training について "we use affinity mimicking and manual weight inheritance to distill OpenCLIP ViT-B/16 [21], whose zero-shot performance on ImageNet is 70.2%" と記載する。[21] は "Open-clip"。また、weight inheritance の variants は "OpenCLIP ViT-B/32 or ViT-B/16 [21] ... pre-trained on LAION-2B" と記載する。**`unknown`**: その OpenCLIP checkpoint の exact tag / artifact / hash と、その checkpoint 自体の初期化・重みの系譜。 |
| FR-LIC-015 | **未解決**。保存した一次資料は直接の teacher を OpenAI CLIP とは記載しないが、特定できていない OpenCLIP checkpoint が OpenAI CLIP の重みから初期化・継続学習されていないことも示さない。したがって「OpenAI CLIP の重みが寄与していない」とは判断しない（本書は FR-LIC-015 の不該当を主張しない）。 |
| 判定 | **除外 / HOLD 維持**。Intended use と out-of-scope が判断不能であり、`docs/model-governance/adoption-template.md` §8 の「判断不能 → 同梱不可」に該当する。teacher の最終的な重みの系譜も未確認である。 |

## 1. 保存した一次資料

| # | 資料 | URL | 取得日 | revision / commit | 保存 copy | 保存 copy byte | 保存 copy SHA-256 |
|---:|---|---|---|---|---|---:|---|
| 1 | HF model card | `https://huggingface.co/wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M/raw/a2a8c6eaa2549ad66eb7c31b85022bf58273a26c/README.md` | 2026-09-23 | `a2a8c6eaa2549ad66eb7c31b85022bf58273a26c` | `docs/model-governance/evidence/tinyclip-hf-card-a2a8c6ea-20260923.txt` | 5,961 | `f0358aa986c559a7d80a147b65c1c40892f14ba02920fa2a01903a2347b36f7f` |
| 2 | HF API metadata | `https://huggingface.co/api/models/wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M/revision/a2a8c6eaa2549ad66eb7c31b85022bf58273a26c?blobs=true` | 2026-09-23 | `a2a8c6eaa2549ad66eb7c31b85022bf58273a26c` | `docs/model-governance/evidence/tinyclip-hf-api-a2a8c6ea-20260923.json` | 2,223 | `ff193e44ab85420bfc42d738bb3bdfb708a8cc86e1568f4b6cc7ab5feaf13ab5` |
| 3 | microsoft/Cream TinyCLIP README | `https://raw.githubusercontent.com/microsoft/Cream/4a13c4091e78f9abd2160e7e01c02e48c1cf8fb9/TinyCLIP/README.md` | 2026-09-23 | `4a13c4091e78f9abd2160e7e01c02e48c1cf8fb9` | `docs/model-governance/evidence/tinyclip-cream-readme-4a13c409-20260923.txt` | 5,839 | `8b1980088f3d5ff914926721cb9a4240446052cdf7d74468d33984b98ee03d86` |
| 4 | microsoft/Cream TinyCLIP LICENSE | `https://raw.githubusercontent.com/microsoft/Cream/4a13c4091e78f9abd2160e7e01c02e48c1cf8fb9/TinyCLIP/LICENSE` | 2026-09-23 | `4a13c4091e78f9abd2160e7e01c02e48c1cf8fb9` | `docs/model-governance/evidence/tinyclip-cream-license-4a13c409-20260923.txt` | 1,769 | `583acc0d9c74def18ec24e56964421bf1fac1fa2d60451e75e6681d5ae58a3f6` |
| 5 | microsoft/Cream TinyCLIP PRETRAINING | `https://raw.githubusercontent.com/microsoft/Cream/4a13c4091e78f9abd2160e7e01c02e48c1cf8fb9/TinyCLIP/docs/PRETRAINING.md` | 2026-09-23 | `4a13c4091e78f9abd2160e7e01c02e48c1cf8fb9` | `docs/model-governance/evidence/tinyclip-cream-pretraining-4a13c409-20260923.txt` | 1,524 | `53865c205832ef8f8ce6a39ea27a567bd556a2bcde6dc6a65f1c1b01611285b8` |
| 6 | arXiv paper extracted text | `https://arxiv.org/pdf/2309.12314v1` | 2026-09-23 | arXiv `2309.12314v1` | `docs/model-governance/evidence/tinyclip-paper-2309.12314v1-20260923.txt` | 4,721 | `602e103d4a4f0bdae3c019ff5747c837b84e2951eaa74a9d64b5291d7544c78a` |

Paper PDF metadata: URL `https://arxiv.org/pdf/2309.12314v1`、byte size `931,044`、SHA-256 `0283556bdddcde728288d02a8f5e6d867ad7a7181ca680b15d03f0129eda2bfe`。PDF 本体は evidence に同梱せず、関連 excerpt のみ text file として保存した。

保存 copy #1・#3・#5 は取得した Markdown の bytes のままで、拡張子だけを `.txt` にした（文書検査が原文中の相対 link を辿らないようにするため。既存の [`om-ai-lab-OmDet-README-956e2f36-20260923.txt`](../docs/model-governance/evidence/om-ai-lab-OmDet-README-956e2f36-20260923.txt) と同じ扱い）。SHA-256 は変わらない。#6 は敵対的レビューの指摘により、文字化けしていた取得日の見出し（`???`）を `Retrieval date` に直した（本文の excerpt は変更していない）。このため #6 の byte size と SHA-256 は修正後の値（旧 4,710 byte / `16df148b…75fc`）である。

## 2. Intended use / out-of-scope の確認結果

### 2.1 HF model card

確認できた用途シグナルは task tag と利用例であり、intended / out-of-scope statement ではない。

```text
license: mit
pipeline_tag: zero-shot-image-classification
tags:
- tinyclip
```

```text
## Use with Transformers
...
model = CLIPModel.from_pretrained("wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M")
processor = CLIPProcessor.from_pretrained("wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M")
...
inputs = processor(text=["a photo of a cat", "a photo of a dog"], images=image, return_tensors="pt", padding=True)
```

Target checkpoint の model zoo row:

```text
[TinyCLIP ViT-8M/16 Text-3M](./src/open_clip/model_configs/TinyCLIP-ViT-8M-16-Text-3M.json) | manual | YFCC-15M | 41.1 | 2.0 | 4,150 | [Model](https://github.com/wkcn/TinyCLIP-model-zoo/releases/download/checkpoints/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M.pt)
```

### 2.2 microsoft/Cream repository

README は implementation と model zoo を示すが、checkpoint の intended use / out-of-scope use は明示しない。

```text
:pushpin: This is an official PyTorch implementation of **[ICCV 2023]** - [TinyCLIP: CLIP Distillation via Affinity Mimicking and Weight Inheritance](https://openaccess.thecvf.com/content/ICCV2023/html/Wu_TinyCLIP_CLIP_Distillation_via_Affinity_Mimicking_and_Weight_Inheritance_ICCV_2023_paper.html)
```

```text
**TinyCLIP** is a novel **cross-modal distillation** method for large-scale language-image pre-trained models.
```

```text
## Getting started
:beginner: Here is the setup tutorial, evaluation and pretraining scripts.
...
### Model inference
- [Inference](./inference.py)
- [Use with 🤗Hugging Face Transformers](https://huggingface.co/collections/wkcn/tinyclip-model-zoo-6581aa105311fe07be88cb0d)
```

License file は MIT text と acknowledgements を示すが、checkpoint の intended / out-of-scope use を示さない。

```text
MIT License
Copyright (c) Microsoft Corporation.
...
- [CLIP](https://github.com/openai/CLIP)
- [CoFi](https://github.com/princeton-nlp/CoFiPruning)
- [OpenCLIP](https://github.com/mlfoundations/open_clip)
```

PRETRAINING は training method の説明であり、product deployment / education / non-commercial research の許否は示さない。

```text
In this document, we introduce ***auto weight inheritance*** and ***manual weight inheritance method*** to train a TinyCLIP model with the proposed ***cross-modalities distillation***.
```

```text
:star: **[Notice]** Please replace the training data loader with the one loading LAION-400M or YFCC-15M.
```

### 2.3 paper

Paper extracted text でも intended / out-of-scope section は見つからない。抽出 text は方法・性能 claim を示す。

```text
In this paper, we propose a novel cross-modal distillation method, called TinyCLIP , for large-scale language-image pre-trained models. The method introduces two core tech- niques: affinity mimicking and weight inheritance.
```

以上により、`docs/model-governance/adoption-template.md` §8 の「該当資料がない、または製品用途との適合を判断できない場合は `判断不能 → 同梱不可`」に該当する。

## 3. Teacher provenance

### 3.1 Paper の teacher 記載

Weight inheritance 一般:

```text
Weight inheritance transmits the pre-trained weights from the teacher mod- els to their student counterparts to improve distillation effi- ciency.
```

Experimental setup:

```text
For weight inheritance, we inherited the weights from two model variants: OpenCLIP ViT-B/32 or ViT-B/16 [21] and CLIP ResNet-50 [46], which are pre-trained on LAION-2B [49] and WIT-400M [46], respectively 1.
```

Target の YFCC-15M training:

```text
When performing training on YFCC-15M [53], we use affinity mimicking and manual weight inheritance to distill OpenCLIP ViT-B/16 [21], whose zero-shot performance on ImageNet is 70.2%.
```

Reference [21]:

```text
[21] Gabriel Ilharco, Mitchell Wortsman, Ross Wightman, Cade Gordon, Nicholas Carlini, Rohan Taori, Achal Dave, Vaishaal Shankar, Hongseok Namkoong, John Miller, Han- naneh Hajishirzi, Ali Farhadi, and Ludwig Schmidt. Open- clip, July 2021.
```

### 3.2 Repository docs との関係

`docs/PRETRAINING.md` の generic manual training section は OpenCLIP ViT-B/32 の compression 例であり、target checkpoint 固有の teacher を ViT-B/16 とする paper 記載を置き換えない。

```text
In this part, we compress OpenCLIP ViT-B/32 to 50% of origin size using two stages, where the model is compressed from 100% to 75% and from 75% to 50% in the two stages, respectively.
```

### 3.3 Teacher provenance の扱い

一次資料から確認できる範囲では、target TinyCLIP ViT-8M/16 Text-3M YFCC-15M は OpenCLIP ViT-B/16（ImageNet zero-shot 70.2%）を直接の teacher として distill され、weight inheritance によって teacher の pre-trained weights を student に伝達する。OpenAI CLIP ViT-B/16 が直接の teacher であるとは記載されていない。一方で、exact OpenCLIP checkpoint tag、artifact URL、artifact SHA-256、その checkpoint 自体の初期化・重みの系譜、teacher checkpoint の license / data terms は、この C7C-01 の許可された一次資料範囲だけでは固定できない。このため OpenAI CLIP の重みの寄与は否定できず、FR-LIC-015 は未解決として扱う。保存した paper excerpt の脚注 1 は抽出範囲の都合で "downloaded from OpenCLIP and Op" で途切れている。

## 4. 探索範囲と「見つからない」項目

### 4.1 HF

- `README.md` at revision `a2a8c6eaa2549ad66eb7c31b85022bf58273a26c` の headings: YAML metadata、`Use with Transformers`、`Highlights`、`Model Zoo`、`Official PyTorch Implementation`、`Citation`、`Acknowledge`、`License`。
- HF API metadata at the same revision: `pipeline_tag`、`tags`、`cardData`、`siblings`、LFS metadata。
- 見つからなかったもの: `Intended Use`、`Out-of-Scope Use`、`Limitations`、`Misuse`、deployed / production use の許否、非商用研究・教育目的での同梱・再配布を許す statement。

### 4.2 microsoft/Cream

- `git ls-remote https://github.com/microsoft/Cream refs/heads/main` で `4a13c4091e78f9abd2160e7e01c02e48c1cf8fb9` を固定した。
- `gh api repos/microsoft/Cream/...` は SAML enforcement で 403 だったため、raw.githubusercontent.com と一時 sparse checkout で `TinyCLIP/` 配下 64 files を確認した。
- 検索語: `intended|out[- ]of[- ]scope|use case|usage|research|commercial|education|educational|deployed|production`。該当は主に `setup.py` の package classifier（`Intended Audience :: Education`、`Intended Audience :: Science/Research`）と `setup.py` の development status comment であり、checkpoint model card の intended / out-of-scope statement ではないため採用根拠にしない。
- teacher / inheritance 検索語: `teacher|OpenCLIP|OpenAI|ViT-B/16|ViT-B-16|YFCC-15M|weight inheritance|inherit`。README、PRETRAINING、scripts、`src/open_clip/pretrained.py` に関連記載があったが、target checkpoint 固有の teacher は paper の YFCC-15M paragraph が最も直接的だった。

### 4.3 Paper

- `https://arxiv.org/pdf/2309.12314v1` を byte stream として取得し、SHA-256 と byte size を記録した。本文は pypdf で抽出し、relevant excerpts のみ保存した。
- 検索語: `intended`、`out-of-scope`、`out of scope`、`commercial`、`educational`、`ViT-8M/16`、`YFCC-15M`、`OpenCLIP`、`OpenAI`、`CLIP ViT-B/16`、`teacher`、`weight inheritance`。
- 見つからなかったもの: explicit `Intended Use` / `Out-of-Scope Use` section、target checkpoint の exact OpenCLIP teacher artifact tag/hash。

## 5. 本書が主張しないこと

1. TinyCLIP の採用承認ではない。manifest、SBOM、既定 checkpoint へ追加してはならない。
2. HF card の `license: mit` または Cream repository の MIT license が checkpoint 層・training data 層の完全な許諾を表すとは主張しない。
3. `pipeline_tag: zero-shot-image-classification` を intended use statement とみなさない。
4. OpenCLIP ViT-B/16 の exact artifact、license、LAION-2B の権利条件が確認済みであるとは主張しない。
5. YFCC-15M の各画像 license、再配布条件、教育目的利用、製品同梱可否を確認したとは主張しない。
6. TinyCLIP の品質、ONNX parity、CPU / DirectML 性能、NFR-ANN-006 の補助品質を検証したとは主張しない。
7. 法的助言ではない。一次資料の文言に基づく技術調査記録である。

## 6. 敵対的レビュー結果

| 観点 | 確認 |
|---|---|
| 捏造防止 | 結論は保存 copy の原文 quote に限定した。`pipeline_tag`、推論例、MIT license を intended use / checkpoint grant として拡張していない。 |
| 二次資料の排除 | 参照した判断根拠は HF pinned model card / API、microsoft/Cream pinned commit の raw file、arXiv PDF 抽出 text のみ。web search や blog 等は根拠にしていない。 |
| OpenAI CLIP 見落とし | LICENSE と README の acknowledgement に OpenAI CLIP は出るが、target の直接の teacher を示す paper quote は OpenCLIP ViT-B/16 [21]。特定できていない OpenCLIP checkpoint の重みの系譜は未確認のため、FR-LIC-015 は**未解決**とし、不該当とは記録しない。 |
| fail-closed | Intended / out-of-scope が判断不能であり、teacher の重みの系譜も未確認のため **除外 / HOLD 維持** とした。 |

## 7. 検証コマンド

```powershell
$expected = @{
  'docs\model-governance\evidence\tinyclip-cream-license-4a13c409-20260923.txt' = '583acc0d9c74def18ec24e56964421bf1fac1fa2d60451e75e6681d5ae58a3f6'
  'docs\model-governance\evidence\tinyclip-cream-pretraining-4a13c409-20260923.txt' = '53865c205832ef8f8ce6a39ea27a567bd556a2bcde6dc6a65f1c1b01611285b8'
  'docs\model-governance\evidence\tinyclip-cream-readme-4a13c409-20260923.txt' = '8b1980088f3d5ff914926721cb9a4240446052cdf7d74468d33984b98ee03d86'
  'docs\model-governance\evidence\tinyclip-hf-api-a2a8c6ea-20260923.json' = 'ff193e44ab85420bfc42d738bb3bdfb708a8cc86e1568f4b6cc7ab5feaf13ab5'
  'docs\model-governance\evidence\tinyclip-hf-card-a2a8c6ea-20260923.txt' = 'f0358aa986c559a7d80a147b65c1c40892f14ba02920fa2a01903a2347b36f7f'
  'docs\model-governance\evidence\tinyclip-paper-2309.12314v1-20260923.txt' = '602e103d4a4f0bdae3c019ff5747c837b84e2951eaa74a9d64b5291d7544c78a'
}
$failed = $false
foreach ($path in ($expected.Keys | Sort-Object)) {
  $actual = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant()
  if ($actual -ne $expected[$path]) {
    Write-Error "SHA-256 mismatch: $path expected $($expected[$path]) actual $actual"
    $failed = $true
  } else {
    Write-Output "OK $path $actual"
  }
}
if ($failed) { exit 1 }
Write-Output 'TinyCLIP evidence hash verification passed.'
```

実行結果（exit code `0`）:

```text
OK docs\model-governance\evidence\tinyclip-cream-license-4a13c409-20260923.txt 583acc0d9c74def18ec24e56964421bf1fac1fa2d60451e75e6681d5ae58a3f6
OK docs\model-governance\evidence\tinyclip-cream-pretraining-4a13c409-20260923.txt 53865c205832ef8f8ce6a39ea27a567bd556a2bcde6dc6a65f1c1b01611285b8
OK docs\model-governance\evidence\tinyclip-cream-readme-4a13c409-20260923.txt 8b1980088f3d5ff914926721cb9a4240446052cdf7d74468d33984b98ee03d86
OK docs\model-governance\evidence\tinyclip-hf-api-a2a8c6ea-20260923.json ff193e44ab85420bfc42d738bb3bdfb708a8cc86e1568f4b6cc7ab5feaf13ab5
OK docs\model-governance\evidence\tinyclip-hf-card-a2a8c6ea-20260923.txt f0358aa986c559a7d80a147b65c1c40892f14ba02920fa2a01903a2347b36f7f
OK docs\model-governance\evidence\tinyclip-paper-2309.12314v1-20260923.txt 602e103d4a4f0bdae3c019ff5747c837b84e2951eaa74a9d64b5291d7544c78a
TinyCLIP evidence hash verification passed.
```
