# AutoVision-Studio

画像分類と物体検出の教師データ作成、ローカル学習、評価、カメラ推論を行う Windows/macOS 向けデスクトップアプリケーションです。

## 開発状況

現在は **Phase C（高リスク PoC）実行中**であり、利用可能な完成アプリケーションやインストーラーはまだありません。Windows で一部 PoC を実測済みですが、native Apple Silicon Mac、clean Windows、承認済みモデル・権利確認済み fixture を必要とする Gate は未完了です。未実施項目を合格扱いにしません。

`work/` 配下は作成時点の Git baseline を固定した履歴スナップショットです。現在の計画は `docs/implementation-plan.md`、実測結果は各 `spikes/**/result*.md` と Git 履歴を参照してください。

## ドキュメント

- [要求定義書](docs/requirement-definition.md) — 実装の唯一の要求基準
- [実装プラン](docs/implementation-plan.md) — タスク、依存関係、検証ゲート
- [ユーザーガイド](docs/users-guide.md) — 未実装手順を含めないスケルトン
- [開発・検証方針](CONTRIBUTING.md) — exact toolchain と検証手順

要求定義の基準版は v0.3 Draft です。SHA-256 は、Windows作業ツリーCRLF bytesが `2f1c57da192710ffb2fd764c7e342cf2e9106fa7387be7393133873cc815052f`、canonical Git blob LF bytesが `7a6e08e7e046a3ced59644a73bde44c4d7b279f55ba809bd78af60fdaa5b175c` です。
