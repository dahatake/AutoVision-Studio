# 既存資産の取り込み: 非機能要求（NFR）

正本 `docs/requirement-definition.md` §11 の NFR 7 件を、本文を変えずに EABK の管理データへ取り込んだものです（出典: SRC-001）。

### 6.2 非機能要求

#### NFR-REL-002 DB migration 前の自動バックアップ
- 要求: DB migration 前に自動バックアップし、失敗時に旧版へ戻せる。
- 決定状態: 承認済み（包括承認 2026-11-01・approval_policy）　出自: 既存資産の取り込み　優先度: SHOULD（既存の正本で定義済み。テストの ID 付与は未了のため MUST にしない）
- 上位: G-001　出典: SRC-001 §11
- 対象エンティティ: なし　関係する状態: なし　参照パラメータ: なし
- 関連する既存資産: なし
- 受入基準 AC-001: DB migration の前に自動バックアップが作られ、migration が失敗したとき旧版へ戻せる。
  - 検証レベル: integration

#### NFR-REL-003 生成物の atomic commit
- 要求: 生成物は一時パスに書き、checksum 検証後に atomic commit する。
- 決定状態: 承認済み（包括承認 2026-11-01・approval_policy）　出自: 既存資産の取り込み　優先度: SHOULD（既存の正本で定義済み。テストの ID 付与は未了のため MUST にしない）
- 上位: G-001　出典: SRC-001 §11
- 対象エンティティ: なし　関係する状態: なし　参照パラメータ: なし
- 関連する既存資産: なし
- 受入基準 AC-002: 生成物は一時パスに書かれ、checksum の検証後にだけ atomic commit される。
  - 検証レベル: unit

#### NFR-STO-001 Copy 前の必要容量計算
- 要求: Copy 前に、元データ総量、予測生成物、作業一時領域、20% の安全余裕を含めて必要容量を計算する。不足時は開始しない。
- 決定状態: 承認済み（包括承認 2026-11-01・approval_policy）　出自: 既存資産の取り込み　優先度: SHOULD（既存の正本で定義済み。テストの ID 付与は未了のため MUST にしない）
- 上位: G-001　出典: SRC-001 §11
- 対象エンティティ: なし　関係する状態: なし　参照パラメータ: なし
- 関連する既存資産: なし
- 受入基準 AC-003: Copy 前に、元データ総量、予測生成物、作業一時領域、20% の安全余裕を含む必要容量が計算され、空き容量が不足するときは Copy が開始されない。
  - 検証レベル: integration

#### NFR-ANN-002 annotation UI の応答
- 要求: 4K 画像かつ 100 rectangles の基準データで、zoom、pan、select、move、resize の UI 応答を p95 100 ms 以内とする。
- 決定状態: 承認済み（包括承認 2026-11-01・approval_policy）　出自: 既存資産の取り込み　優先度: SHOULD（既存の正本で定義済み）
- 上位: G-001　出典: SRC-001 §11
- 対象エンティティ: なし　関係する状態: なし　参照パラメータ: なし
- 関連する既存資産: なし
- 受入基準 AC-004: 4K 画像かつ 100 rectangles の基準データで、zoom、pan、select、move、resize の UI 応答が p95 100 ms 以内である。
  - 検証レベル: manual

#### NFR-ANN-003 補助候補生成中の UI 非阻害
- 要求: 補助候補生成中も annotation UI の入力、保存、画面遷移を妨げない。worker 異常終了時も手動 annotation を継続できる。
- 決定状態: 承認済み（包括承認 2026-11-01・approval_policy）　出自: 既存資産の取り込み　優先度: SHOULD（既存の正本で定義済み。テストの ID 付与は未了のため MUST にしない）
- 上位: G-001　出典: SRC-001 §11
- 対象エンティティ: なし　関係する状態: なし　参照パラメータ: なし
- 関連する既存資産: なし
- 受入基準 AC-005: 補助候補の生成中も annotation UI の入力、保存、画面遷移が妨げられず、worker が異常終了しても手動 annotation を継続できる。
  - 検証レベル: integration

#### NFR-ANN-004 補助推論の再現性
- 要求: 同じ image hash、checkpoint hash、prompt、preprocess、threshold、seed の組み合わせでは deterministic inference を使用し、同一候補を再現できる。非決定的演算が残る場合は manifest とレポートに明記する。
- 決定状態: 承認済み（包括承認 2026-11-01・approval_policy）　出自: 既存資産の取り込み　優先度: SHOULD（既存の正本で定義済み）
- 上位: G-001　出典: SRC-001 §11
- 対象エンティティ: なし　関係する状態: なし　参照パラメータ: なし
- 関連する既存資産: なし
- 受入基準 AC-006: 同じ image hash、checkpoint hash、prompt、preprocess、threshold、seed の組み合わせで同一候補が再現され、非決定的演算が残る場合は manifest とレポートに明記されている。
  - 検証レベル: integration

#### NFR-ANN-006 採用候補モデルの比較試験（免除済み・未検証）
- 要求: 採用候補モデルは、代表的な分類/検出データで manual-only と assisted の比較試験を行い、最終 Ground Truth の品質を悪化させず、annotation 所要時間を短縮することを出荷条件とする。測定条件と結果を model adoption record に保存する。Version 1 では、所有者の判断（2026-09-26、`docs/model-governance/evidence/2026-09-26-owner-rulings.md`）により比較試験を実施対象から削除し、未実施のまま完了扱いとした（免除）。品質の非悪化と所要時間の短縮は検証されていない。
- 決定状態: 承認済み（包括承認 2026-11-01・approval_policy）　出自: 既存資産の取り込み　優先度: MAY（Version 1 では所有者の判断で免除）
- 上位: G-001　出典: SRC-001 §11
- 対象エンティティ: なし　関係する状態: なし　参照パラメータ: なし
- 関連する既存資産: なし
- 受入基準 AC-007: Version 1 では比較試験は免除され未実施であり、品質の非悪化と所要時間の短縮は検証されていないことが記録されている（所有者の判断 2026-09-26）。
  - 検証レベル: manual
