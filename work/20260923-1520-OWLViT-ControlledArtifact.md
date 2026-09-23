# C7D-01 — OWL-ViT base patch32 controlled artifact

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（検証記録）。**採用決定ではない** |
| 作成日時 | 2026-09-23 15:20 JST |
| 計画 | [`20260923-1437-C7-RemainingTasksExecutionPlan.md`](20260923-1437-C7-RemainingTasksExecutionPlan.md) §6 C7D-01 |
| 対象 | Hugging Face `google/owlvit-base-patch32`、revision `cbc355fb364588351c5d51c7f74465e8e7ec6f72` |
| artifact の保管 | Git 追跡外の `vendor/models/_spike/owlvit-b32/` |
| publisher 値の出典 | [`owlvit-base-patch32-hf-api-20260923.json`](../docs/model-governance/evidence/owlvit-base-patch32-hf-api-20260923.json)（`https://huggingface.co/api/models/google/owlvit-base-patch32?blobs=true`、2026-09-23 取得。`sha` = 上記 revision） |

## 1. payload 一覧

publisher 値は保存済み API metadata の `siblings[]`（LFS file は `lfs.sha256`、非 LFS file は Git blob SHA-1 の `blobId`）。独立計算値は本 repository で 2026-09-23 に計算した（SHA-256 は `Get-FileHash`、blob SHA-1 は `git hash-object`）。

| file | byte（publisher / 独立） | publisher hash | 独立計算 SHA-256 | 独立計算 blob SHA-1 | 照合 |
|---|---|---|---|---|---|
| `model.safetensors` | 612,983,940 / 612,983,940 | LFS SHA-256 `4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b` | `4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b` | —（LFS pointer の blobId は比較対象外） | 一致 |
| `config.json` | 4,418 / 4,418 | blobId `6dc59fde669284079dfde3d22f7c63f067479455` | `b5934e0d2933194b8a85f93674e577feaa1a1ba2dc1d143b2d5e5305ff7a9d7c` | `6dc59fde669284079dfde3d22f7c63f067479455` | 一致 |
| `preprocessor_config.json` | 392 / 392 | blobId `296097b0c4aadb7efadabd6bb7db67175c46d39f` | `2010d320cd2c68a8bb1de69aaa8f89daf173ef17cc22a30e4baf44b2f0e9bb6e` | `296097b0c4aadb7efadabd6bb7db67175c46d39f` | 一致 |
| `tokenizer_config.json` | 775 / 775 | blobId `2460b9a4e2f76172145e9eef9e26cc3419c53727` | `da35aceebeda2adf44094a5867940b09379323b9390fa9197b57044e106bfb6e` | `2460b9a4e2f76172145e9eef9e26cc3419c53727` | 一致 |
| `special_tokens_map.json` | 460 / 460 | blobId `ae0c5be6f35217e51c4c000fd325d8de0294e99c` | `f118ab3a983206e4f32583448de6bd6aae4ee21869135cef1f5848a753cdaab6` | `ae0c5be6f35217e51c4c000fd325d8de0294e99c` | 一致 |
| `vocab.json` | 1,059,962 / 1,059,962 | blobId `469be27c5c010538f845f518c4f5e8574c78f7c8` | `e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349` | `469be27c5c010538f845f518c4f5e8574c78f7c8` | 一致 |
| `merges.txt` | 524,619 / 524,619 | blobId `76e821f1b6f0a9709293c3b6b51ed90980b3166b` | `9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a` | `76e821f1b6f0a9709293c3b6b51ed90980b3166b` | 一致 |

- 独立計算 SHA-256 は [`2026-09-23-owner-risk-acceptance-c7-detection.md`](../docs/model-governance/evidence/2026-09-23-owner-risk-acceptance-c7-detection.md) §1 の記録値とも一致する。
- `README.md`（model card）の独立 SHA-256 `a16c7074…36bf` は保存 copy [`owlvit-base-patch32-model-card-cbc355fb-20260923.md`](../docs/model-governance/evidence/owlvit-base-patch32-model-card-cbc355fb-20260923.md) と一致し、blob SHA-1 `3c68c759…64cd` は publisher の `blobId` と一致する。
- 取得しないもの: `pytorch_model.bin`（pickle 形式。安全形式でないため）、`.gitattributes`。

## 2. remote code 不要の確認

| 確認 | 結果 |
|---|---|
| `config.json` の key | `_name_or_path`, `architectures`, `initializer_factor`, `logit_scale_init_value`, `model_type`, `projection_dim`, `return_dict`, `text_config`, `text_config_dict`, `torch_dtype`, `transformers_version`, `vision_config`, `vision_config_dict`。**`auto_map` なし** |
| `architectures` / `model_type` | `OwlViTForObjectDetection` / `owlvit` |
| transformers 本体 class | spike venv の transformers `5.17.0` で `OwlViTForObjectDetection` の定義元は `transformers/models/owlvit/modeling_owlvit.py`、`OwlViTProcessor` は `transformers.models.owlvit.processing_owlvit`（本体同梱。`trust_remote_code` 不要） |
| `preprocessor_config.json` | `processor_class: OwlViTProcessor`、`size: [768, 768]`、`do_center_crop: false`、`resample: 3` |

## 3. OpenAI CLIP との混同がないことの確認

- model card（保存 copy）は "The CLIP backbone is trained from scratch and fine-tuned together with the box and class prediction heads with an object detection objective." と記載する。ここでの "CLIP" は architecture / 学習手法の名称であり、OpenAI 配布の重みを初期値にしたとは記載していない。
- 本 artifact の重みは上記 `model.safetensors`（publisher `google`）であり、OpenAI 配布の checkpoint（`openai/clip-vit-base-patch32` 等）を取得・使用していない。

## 4. 検証コマンド

publisher 値（保存済み API metadata）と独立計算値を照合し、revision 不一致、byte size 不一致、hash 不一致、`auto_map` の存在のいずれかで非ゼロ終了する。repository root で実行する。

```powershell
$d='vendor\models\_spike\owlvit-b32'; $api=Get-Content docs\model-governance\evidence\owlvit-base-patch32-hf-api-20260923.json -Raw|ConvertFrom-Json; $bad=0; if ($api.sha -ne 'cbc355fb364588351c5d51c7f74465e8e7ec6f72') { $bad++ }; foreach ($n in 'model.safetensors','config.json','preprocessor_config.json','tokenizer_config.json','special_tokens_map.json','vocab.json','merges.txt') { $s=$api.siblings|Where-Object rfilename -eq $n; $p=Join-Path $d $n; $len=(Get-Item $p).Length; if ($s.lfs) { $got=(Get-FileHash $p -Algorithm SHA256).Hash.ToLower(); $want=$s.lfs.sha256 } else { $got=git hash-object $p; $want=$s.blobId }; $ok=($len -eq $s.size) -and ($got -eq $want); if (-not $ok) { $bad++ }; '{0} {1} {2}' -f $(if($ok){'OK  '}else{'FAIL'}),$n,$got }; if ((Get-Content (Join-Path $d 'config.json') -Raw) -match '"auto_map"') { 'FAIL auto_map present'; $bad++ }; "mismatches=$bad"; exit $bad
```

実行結果（2026-09-23）:

| 実行 | 結果 |
|---|---|
| 正本 `vendor/models/_spike/owlvit-b32` | 7 file すべて `OK`、`mismatches=0`、**exit 0** |
| 否定 test（copy した `config.json` に 1 byte 追記した一時 directory。実行後に削除） | `FAIL config.json 2a846fde…e6e5`、`mismatches=1`、**exit 1** |

## 5. 本書が主張しないこと

1. 採用決定ではない。parity・性能・補助品質は C7D-02 以降で実測する。
2. publisher の値は publisher の metadata の転記であり、HF 版 checkpoint が論文の学習手順の重みと同一であることは確認していない（risk acceptance §2.2 の未確認項目 (3) のまま）。
3. 学習データの terms は確認していない（同 (2) のまま）。
