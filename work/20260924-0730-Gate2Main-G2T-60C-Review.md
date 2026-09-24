# G2T-60C 敵対的レビュー

- reviewer: 独立 reviewer（rubber-duck agent `7516541b`、2026-09-24）
- 対象: `git diff` の採用記録の追記、`vendor/models/_spike/advisories-C.txt` / `advisories-D.txt`
- 検証: §8.7 の照会を独立に再実行（60C は 10 package、60D は `sentencepiece` を除く 9 package。advisory は `torch@2.11.0` の `GHSA-rrmf-rvhw-rf47`（reviewed、未撤回、low、pip/torch、`<= 2.12.1`）の 1 件だけで `bad=0`）。C と D の file が同一（89 byte、SHA-256 `54641414…ca03`）なのは、`sentencepiece` に advisory がなく、出力が advisory 行だけのため正当。`^evidence: <sha> exit=0$` は SigLIP 記録 L109・OWL-ViT 記録 L129 に各 1 件。§8.6 の tokenizer 監査を C / D とも独立に再実行し exit 0、記録の byte size・hash・publisher 値（`author=google`）が API json と一致。C5 package（numpy 2.5.2、onnx 1.22.0、onnxruntime-directml 1.24.4、torch 2.11.0、transformers 5.17.0、pillow 12.3.0）は spike の import 行（`siglip_assist_parity.py:41-58`、`owlvit_assist_parity.py:36-62`）と一致。既存の evidence 文書は未変更。製品の依存の選定なし。
- 指摘: blocking なし、non-blocking なし。
blocking: 0

