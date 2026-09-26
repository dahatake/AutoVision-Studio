# 所有者の回答（2026-09-26 12:29）の実行計画

- 作成日時: 2026-09-26 12:35
- 根拠: [`2026-09-26-owner-rulings-1229.md`](../docs/model-governance/evidence/2026-09-26-owner-rulings-1229.md)

| ID | 内容 | 完了条件 |
|---|---|---|
| T9-V | 版 `0.1.12` の決定記録（[`20260924-1341-TBD09-VersionDecision.md`](20260924-1341-TBD09-VersionDecision.md)）を作り、T9-V だけの ATG の run で TBD-09 の計画 §5 の T9-V の完了条件（graph の `verify_command`）を確かめる。TBD-09 の run `2a67e845-…` の T9-V は `contract` の失敗で再試行できないため、新しい run とする | T9-V の verify が exit 0、Review が blocking 0、`run finish` が `accepted: true` |
| C-2 | 負荷の高い PC での集約 `npm test` のまれな失敗は対応しない（所有者のキャンセル） | 記録だけ |
| PKG-01 | `docs/implementation-plan.md` L684 の PKG-01 を実装する: `scripts/models/verify.py`（manifest の `sourcePath` の `vendor/models/` の approved な hash / size だけを通し、同じ bytes を `payloadPath` へ対応付ける。download しない）と test。検査の範囲は manifest schema の `$comment` が PKG-01 に割り当てた項目。test の file 名は、repository の Python の checker の慣例（`scripts/samples/test_verify_samples.py`、`scripts/licenses/test_verify_cuda_payload.py`）と、pytest が点を含む module 名を import できないことから `scripts/models/test_verify.py` とする（実装計画の `verify.test.py` からの逸脱） | `ml/` から `.venv\Scripts\python.exe -B -m pytest -q ..\scripts\models\test_verify.py` が成功、Ruff check / format check が成功、実 manifest で `verify.py` が exit 0 |

各タスクの後に敵対的レビューを行い、blocking 0 にしてから次へ進む。
