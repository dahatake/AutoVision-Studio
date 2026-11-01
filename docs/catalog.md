# カタログ

既存の機能・API・テーブル・共通部品の対応表です。1 行 1 項目の短い表にし、詳細はリンク先のファイルに任せます。
機能の表は rd-author（要求 ID・題名・決定状態）と implementer（実装ファイル・テスト・共通部品）が更新します。
未実装の要求は、実装ファイルとテストの欄を「未実装」とします。

## 機能

| 要求 ID | 題名 | 決定状態 | 実装ファイル | テスト | 使っている共通部品 |
|---|---|---|---|---|---|
| FR-WEB-001 | localhost（loopback）限定のローカル Web 起動 | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-WEB-002 | Electron 版との画面・Main 処理・データ領域の共有と排他 | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-WEB-003 | 認証トークンと Host/Origin 検証 | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-WEB-004 | Web 実行での Cloud 不使用・外向き通信 0 件・配信ヘッダー | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-WEB-005 | Web でのファイル選択（Copy のみ）とダウンロード書き出し | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-WEB-006 | Web でのカメラ（ブラウザー許可 UI） | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-WEB-007 | Electron 版との機能差の明示 | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-CVP-001 | クラス別の最小画像枚数ガード | 承認済み（包括承認 2026-11-01・approval_policy） | src/main/data/class-coverage-policy.ts, src/main/data/revision-service.ts, src/main/ipc/revision-handlers.ts, src/shared/contracts/revision-ipc.ts, src/renderer/features/annotations/ConfirmDatasetDialog.tsx | src/main/data/class-coverage-policy.test.ts, src/main/annotations/workspace-validation.test.ts, src/renderer/features/annotations/ConfirmDatasetDialog.coverage.test.tsx | なし |
| FR-CVP-002 | 複数ラベル分類（Multilabel） | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-CVP-003 | 静止画クイックテスト | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-CVP-004 | 評価のしきい値調整 | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-CVP-005 | 推論結果からの再学習ループ | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-CVP-006 | モデルのエクスポート | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-CVP-007 | 軽量プロファイル（Compact 相当） | 承認済み（包括承認 2026-11-01・approval_policy） | 未実装 | 未実装 | なし |
| FR-CVP-008 | 取り込み画像の入力制限の明示 | 承認済み（包括承認 2026-11-01・approval_policy） | src/main/data/class-coverage-policy.ts | src/main/data/class-coverage-policy.test.ts | なし |
| NFR-REL-002 | DB migration 前の自動バックアップ | 承認済み | src/main/db/backup.ts | 未実装 | - |
| NFR-REL-003 | 生成物の atomic commit | 承認済み | src/main/data/copy-source.ts, src/main/storage/atomic-write.ts | 未実装 | - |
| NFR-STO-001 | Copy 前の必要容量計算 | 承認済み | src/main/data/import-capacity.ts, src/main/projects/project-move.ts | 未実装 | - |
| NFR-ANN-002 | annotation UI の応答 | 承認済み | build/spi10/benchmark-result.json, build/spi10/main.mjs, spikes/annotation/result.md | 未実装 | - |
| NFR-ANN-003 | 補助候補生成中の UI 非阻害 | 承認済み | CHANGELOG.md | 未実装 | - |
| NFR-ANN-004 | 補助推論の再現性 | 承認済み | resources/models/manifest.schema.json | 未実装 | - |
| NFR-ANN-006 | 採用候補モデルの比較試験（免除済み・未検証） | 承認済み | CHANGELOG.md, resources/models/manifest.json, resources/models/manifest.schema.json, spikes/models/assist-goldset-plan-classification.md, spikes/models/assist-goldset-plan-detection.md, spikes/models/assist-result.md, spikes/models/owlvit-assist-result.md, spikes/models/siglip-assist-result.md | 未実装 | - |

## API・イベント

| 名前 | 定義ファイル | 関連する要求 ID |
|---|---|---|

## テーブル

| テーブル名 | 定義ファイル | 正本のシステム | 関連する要求 ID |
|---|---|---|---|

## 共通部品

| 部品名 | ファイル | 用途 | 使っている要求 ID |
|---|---|---|---|
