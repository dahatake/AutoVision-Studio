# Windows 実行可能タスク記録

| 項目 | 値 |
|---|---|
| 実行日 | 2026-09-04 |
| 対象 | macOS実機を必要としない残タスク |
| 原則 | 未実施のOS、model、fixture、署名、clean host、rebootをPASSへ読み替えない |

## SPI-08 — ONNX Runtime provider smoke（Windows lane）

- exact uv 0.12.9、frozen / offline環境で self-test 16件、実CPU / DirectML probe、Ruff check / format、Pyrightを再実行した。
- 実probeはCPU kernelを`CPUExecutionProvider`、DirectML kernelを`DmlExecutionProvider`へprofile attributionし、両者のexact output `[4.0, 3.0, 2.0, -4.0]`、一時artifact 0を確認した。
- 自主レビューで、2026-09-03結果文書の旧`uv.lock` hashとcurrent lockが異なることを検出した。current lockで実probeを再実行し、`provider-result.md`へcurrent evidenceを追記した。
- 敵対的レビューの「Ruff/Pyright configがspikeを除外するため対象未検査」は再現せず不採用。対象fileを明示したRuff `--show-files`とPyright出力で実解析を確認した。
- Windows lane: **REVALIDATED / PASS**。
- SPI-08全体: **PARTIAL**。macOS CPU / CoreMLはユーザー指示により対象外として未実施だが、要求正本上は`NOT_RUN`のまま。
