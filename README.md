# AutoVision Studio

AutoVision Studio は、画像分類と物体検出の教師データ作成、ローカル学習、評価、カメラ推論を端末内で行う Windows 向けデスクトップアプリケーションです。Version 1（MVP）は Windows 11 24H2 以降の x64 のみを対象とします。一般利用者と、要求に沿って製品をカスタマイズするソフトウェアエンジニアを対象にしています。

## 現在の利用可否

現在は **Gate 1 の条件付き開発許可（CONDITIONAL_GO）の下で、core・Project・データ取り込み・手動アノテーションの開発を進めている段階**です。[Gate 判定](docs/adr/0004-spike-decisions.md)の Gate 2 は **BLOCKED / NOT_COMPLETE** のままで、完成アプリケーションや一般利用者向けインストーラーはまだ提供していません。画面や個別機能の実装は、製品受入・本人確認・正式出荷の合格を意味しません。macOS は将来対応であり、現在は利用できず、Version 1 の実装・試験・配布・Gate の対象ではありません。

開発用アプリでは、次の画面・導線に到達できます。Project 内の画面は Project の選択が前提であり、接続先 API が利用できない場合は操作できません。

| 画面 | 現在の到達先と実装範囲 |
|---|---|
| UI-01 初回診断 | Project 一覧の診断概要と、設定「端末・容量」の診断画面に接続済み |
| UI-02 Project 一覧 | 一覧表示・Project 選択・作成画面への導線に接続済み |
| UI-03 Project 作成・設定 | 一覧からの作成画面と、設定「Project」の編集・保存画面に接続済み |
| UI-04 データ取り込み | Project の「取り込む」タブで取り込み画面に接続済み |
| UI-09 Label Schema | 設定「ラベル定義」でラベル定義の編集・保存画面に接続済み |
| UI-05 Training Run | 「学習」タブには到達できるが、実行・履歴・進捗などの実機能は未実装 |
| UI-06 結果・レポート | 「結果」タブには到達できるが、レポート表示・モデル版の比較などの実機能は未実装 |
| UI-07 推論 | 「カメラで試す」タブと設定「推論」には到達できるが、推論設定・カメラ開始／停止・推論は未実装。カメラにはアクセスしない |
| UI-08 ストレージ・ライセンス | 設定「端末・容量」には診断表示、設定「ライセンス・情報」には製品版番号と同梱アイコンの LICENSE／NOTICE 表示がある。ストレージ管理・削除 preview、その他の第三者通知・SBOM・モデル由来の表示は未実装 |
| UI-10 教師データ作成 | 「教師データ」タブには到達できるが、画像表示・分類ラベル／矩形編集・保存・人手確認・Dataset 確定は未実装 |
| UI-11 補助ジョブ | 導線は「教師データ」タブに集約されているが、補助ジョブの操作画面・実行は未実装 |

実機能が未到達の画面は未実装の案内であり、タブや設定カテゴリに到達できることを機能完成と扱いません。上表は [AppShell](src/renderer/layout/AppShell.tsx)、[ProjectWorkspace](src/renderer/layout/ProjectWorkspace.tsx)、[SettingsPage](src/renderer/features/settings/SettingsPage.tsx) の接続に基づきます。文書中の `設計確定・未実装` は目標であり、利用可能な機能を意味しません。

公開サンプルの準備では、Beans分類60枚と原本hash・ライセンス通知を保存済みです。GWHD検出も固定20枚の原画像bytes・全1079 boxを保持したCOCO annotation・manifest・CC BY 4.0のライセンス／帰属通知を準備済みです。通常decoder / importerのhelperによる全80画像の検証（DATA-07）は実施済みですが、サンプルProjectのアプリ内作成・編集・学習や一般利用者向けインストールはまだ利用できません。素材・実装・実アプリ受入を分けた最新結果は[準備・検証状況](docs/sample-data/verification.md)を参照してください。

## 主要機能と概念

Version 1（MVP）は、複数 Project、データ取り込み、分類ラベル／検出矩形の作成、Model Suggestion の人による確認、ローカル学習、評価レポート、Model Version 管理、カメラ推論を対象とします。これらの大部分はまだ未実装です。

- **Project** — データ、Training Run、Model Version、推論設定をまとめる最上位単位。
- **Dataset Revision** — 確認済み教師データを固定した不変の版。
- **Training Run** — ローカルで実行する一回の学習処理。
- **Model Version** — 成功した Training Run から作る不変のモデル一式。

詳細な定義は[用語集](docs/users-guide.md#用語集)を参照してください。

## 対応プラットフォーム

- **Version 1 対象:** Windows 11 24H2 以降、x64 のみ
- **将来対応:** macOS。現在は利用不可であり、対応 architecture、OS 下限、MPS/CoreML、カメラ権限、署名、notarization、配布方法を将来の要求・PoC・Gate で再決定

Windows on ARM、Windows 10、macOS は Version 1 対象外です。Version 1 の正式な最小メモリ／ストレージは Windows installer と Windows 実機検証の完了後に確定します。Windows の結果を macOS 対応の証拠として扱いません。

## ローカル処理とプライバシー

製品版は画像、アノテーション、モデル、推論結果を Cloud へ送らず、学習と推論を端末内で完結する設計です。カメラは推論開始時だけ許可を求め、frame と結果を既定で保存しません。公開ソフトウェアや配布物の取得、Windows コード署名、配布物の公開、利用者が明示的に行う署名済み更新物の取得は、アプリのオフライン処理境界の外です。これらの工程にも画像、ラベル、Project、モデル、学習結果を送信しません。Apple notarization は将来 macOS 対応時の例外候補であり、Version 1 の配布工程や Gate には含めません。これらは要求であり、製品実装と実機検証は未完了です。

## データ、権利、人による確認

利用者は入力画像、ラベル、アノテーションを利用・学習する権利を確認する必要があります。Copy モードは元画像を Project 領域へ複製し、Reference モードは絶対 path と内容 hash で元ファイルを参照します。Reference 元をアプリが変更・削除する設計ではありません。

Model Suggestion は Ground Truth ではありません。高 score でも自動承認せず、候補ごとの確認と画像単位の確定を必要とします。

## 既知の制約

Cloud backend、認証、共同編集、telemetry、動画、RTSP、segmentation、pose、OCR、生成 AI、未監査 model / plugin の実行時追加は MVP 対象外です。macOS アプリ、MPS/CoreML、macOS カメラ権限試験、PKG、Developer ID 署名、notarization、Gatekeeper 試験、macOS servicing も Version 1 対象外であり、現在利用できません。同梱 model はガバナンス審査を通過したものだけを許可しますが、現在の model manifest に承認済み entry はありません。この model blocker が解消するまで、モデル支援、学習、推論を含む MVP をリリース可能とは判定しません。

## 読者別クイックリンク

- 一般利用者: [インストール・設定・チュートリアル](docs/users-guide.md)
- ソフトウェアエンジニア: [開発・カスタマイズガイド](docs/developer-guide.md)
- 構造と信頼境界: [アーキテクチャ](docs/architecture.md)
- 変更の基準: [要求定義](docs/requirement-definition.md)

## ドキュメントマップ

- [インストール・設定・チュートリアル](docs/users-guide.md) — Version 1 の Windows 対応環境、現在の利用可否、設定、分類／検出 tutorial、運用上の注意
- [開発・カスタマイズガイド](docs/developer-guide.md) — Windows MVP の exact toolchain、source 構造、要求駆動の変更手順
- [アーキテクチャ](docs/architecture.md) — Windows の現行実装と目標 component、将来 macOS 境界、依存方向、図
- [要求定義](docs/requirement-definition.md) — Version 1 の要求と scope の正本
- [実装計画](docs/implementation-plan.md) — Windows Version 1 の task、依存関係、Gate と将来 macOS backlog
- [Architecture Decision Records](docs/adr/) — process、data、packaging の設計判断
- [依存採用方針](docs/dependency-policy.md) — dependency と model の採用条件
- [開発・検証規約](CONTRIBUTING.md) — 小さな変更、test、review の規約

`work/` は作成時点の Git baseline を固定した履歴スナップショットです。現在の計画は `docs/implementation-plan.md`、実測結果は各 `spikes/**/result*.md` と Git 履歴を参照してください。

## ライセンスと model governance

source code は [MIT License](LICENSE) です。第三者 dependency、学習済み model、weight、fixture にはそれぞれ別の license と由来確認が必要であり、MIT License だけで配布可能とは判断しません。

## サポートと問題報告

完成アプリケーションが未提供のため、一般利用者向けの製品サポートはまだ開始していません。Version 1 の予定サポート範囲は Windows 11 24H2 以降の x64 のみで、macOS は現在サポート対象外です。一般利用者向けの確認項目は[トラブルシューティング](docs/users-guide.md#トラブルシューティング)、開発時の報告と変更手順は[開発・検証規約](CONTRIBUTING.md)を参照してください。未実装機能や将来 macOS 対応を利用可能な機能または現在の Gate として扱わず、[実装計画](docs/implementation-plan.md)の依存 task と Gate を確認してください。

要求定義の基準版は v0.5 Draft（2026-09-07 UI改善追補、245要求）です。SHA-256 は、Windows 作業ツリー raw CRLF bytes が `cd060e8740e986271ca32cf1e22f0cad275e7c26f9ead573c9fb667f26f984fa`、LF-normalized bytes が `962f5d7209de1f607ee6cb4d31e68b084409f7b3105612e6e4042d8b893e037f` です。
