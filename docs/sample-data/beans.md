# Beans 固定サンプル採用記録（LIC-S01）

| 項目 | 記録 |
|---|---|
| 採用状態 | **条件付き採用・60画像の原bytes/manifest検証済み、通常decode/import未実施** |
| 対象 | Beans（Bean disease dataset / ibean）の画像・分類annotation。C9の固定サンプルのみ |
| 判断責任者 | `dahatake`（repository owner / repository license decision authority） |
| 承認根拠・日 | 2026-09-06、ユーザーによる固定サンプル計画デフォルトの明示承認 |
| 基準 | `docs/implementation-plan.md` §14、`docs/requirement-definition.md` v0.5 Draft §3.3・FR-SMP-001〜005、`docs/dependency-policy.md` §2.1・§9.2 |
| 資料取得（閲覧）日 | 2026-09-06。LICENSE・原READMEも同日に原bytesで保存。ZIP本体の取得とは区別する |
| 原データ公開日 | 2020-01-20（原READMEの `Data Released: 20-January-2020`） |
| 独立レビュー | 2026-09-06、別担当による読み取り専用の敵対的レビューで必須修正0件。LICENSE/READMEのraw hash、データ許諾、未取得実体との区別を確認 |

ownerの判断は、下記固定版から選定する60枚と対応ラベル、そのbytes・通知・検証条件に限定する。未取得bytesの承認完了、製品出荷承認、弁護士による法的助言、新たな暗号学的署名ではない。権利がunknownの場合はowner承認でも通過させない。版・取得元・選定ID・配布主体・条件の変更時は再審査する。

## 1. 一次資料と固定取得元

- 原作者: **Makerere AI Lab**。ウガンダ各地で **National Crops Resources Research Institute（NaCRRI）** と共同収集し、NaCRRIの専門家が収集時に分類ラベルを付与したと原READMEに記載される。
- 原典repository: <https://github.com/AI-Lab-Makerere/ibean>。READMEとLICENSEはともにcommit `6bea90a2a1e6378b134f2941fba43e3d6c5b4373`へ固定する。
- [原README固定本文](https://raw.githubusercontent.com/AI-Lab-Makerere/ibean/6bea90a2a1e6378b134f2941fba43e3d6c5b4373/README.md)
- [同一commitのLICENSE原文](https://raw.githubusercontent.com/AI-Lab-Makerere/ibean/6bea90a2a1e6378b134f2941fba43e3d6c5b4373/LICENSE)
- 配布者は[Makerere AI Lab公式組織アカウント](https://huggingface.co/AI-Lab-Makerere)の `AI-Lab-Makerere/beans`。[固定dataset card](https://huggingface.co/datasets/AI-Lab-Makerere/beans/raw/27aa014ce09b193e1a6f58112d4a66e0eddb69c5/README.md)も原典repositoryを指す。旧HF短縮URLや可変`main`を取得元に使わない。
- [固定revisionの配布メタデータ](https://huggingface.co/api/datasets/AI-Lab-Makerere/beans/tree/27aa014ce09b193e1a6f58112d4a66e0eddb69c5/data)と[train.zipの公開ポインタ本文](https://huggingface.co/datasets/AI-Lab-Makerere/beans/raw/27aa014ce09b193e1a6f58112d4a66e0eddb69c5/data/train.zip)。後者はテキストでありZIP本体ではない。

| 取得対象 | 固定値 |
|---|---|
| HF revision | `27aa014ce09b193e1a6f58112d4a66e0eddb69c5` |
| ファイル | `data/train.zip`のみ（元train） |
| ZIP取得予定URL | <https://huggingface.co/datasets/AI-Lab-Makerere/beans/resolve/27aa014ce09b193e1a6f58112d4a66e0eddb69c5/data/train.zip> |
| 公開サイズ | **143812152 bytes** |
| 公開SHA-256 | `284fe8456ce20687f4367ae7ad94a64577e7f9fde2c2c6b1c74340ab5dc82715` |

サイズとSHA-256は公開ポインタ本文で指定値との一致を確認した。2026-09-06に固定版ZIPを取得し、143812152 bytesとraw SHA-256 `284fe8456ce20687f4367ae7ad94a64577e7f9fde2c2c6b1c74340ab5dc82715`が公開値と一致した。元train実体はangular_leaf_spot 345枚、bean_rust 348枚、healthy 341枚の合計1034枚。ZIPの検証は全データセットの総数差の原因を解決したことや通常decoder/importの合格を意味しない。

## 2. 画像・ラベルの許諾判断

| 対象 | datasetへのMIT適用根拠 |
|---|---|
| 原画像 | 原READMEの `The Data` が葉画像を説明し、その `Versions/Release` に `License: MIT` を明記 |
| 分類annotation | 同じ `The Data` がNaCRRI専門家による画像ごとのannotationをデータの一部として説明し、同じデータ版のMIT表示を適用根拠とする |

上記の**データ節の明示許諾**と同一commitのLICENSEを組み合わせた条件付き判断であり、コードのライセンスから画像・ラベルの許諾を推測したものではない。HFカードの `Licensing Information` 本文は `[More Information Needed]` のままであり、metadataのMITバッジだけには依存しない。AutoVision Studio自身のroot `LICENSE`を第三者データへ適用しない。

原LICENSEの著作権表示は **Copyright (c) 2020 AIR Lab Makerere University**。MITは使用・複製・改変・配布・販売等を許諾する一方、すべての複製または実質的部分に著作権表示と許諾表示を含めることを要求する。原文全体を`resources/samples/beans/LICENSE.txt`へ保持し、`resources/samples/beans/ATTRIBUTION.txt`と共に同梱することが条件である。通知・由来情報はReferenceでもProject側に保持し、オフライン閲覧可能にする（後続実装・検証事項）。

## 3. 承認済み部分集合と利用境界

- **元trainだけから60枚を配置済み**: `angular_leaf_spot`、`bean_rust`、`healthy`各20枚。各原ID・bytes/hashは `resources/samples/beans/manifest.json` に固定した。各クラスの配置直後に独立したZIP原本照合を実施し、60/60の原bytes一致を確認した。
- 変更は部分選択だけ。選定画像全体の原bytesと全分類annotationを保持し、resize・crop・再圧縮・metadata書換をしない。失敗時の枚数削減・別IDへの自動交換、別dataset・別mirror・別archiveへの自動切替はしない。公式validation/testやParquetを代用しない。
- 取得は開発者による明示準備だけとし、Python標準ライブラリのみを使う。新規dataset SDK・runtime依存・plugin・download managerを導入せず、app・build・test・install・初回起動から暗黙取得しない。cacheは`vendor/samples/`、最終原本は`resources/samples/beans/`でread-onlyとする。
- 容量は§14全体の合算で初回取得 **256 MiB（268435456 bytes）**、最終同梱 **96 MiB（100663296 bytes）**。画像・annotation・manifest・通知を含めて検査し、一時展開・コピー容量は別途確認する。権利未確定、hash不一致、取得不能、不正画像、欠損・件数不足、上限超過では停止する。
- クラス別folderから通常importし、保存場所・Copy/Reference選択・権利確認を省略しない。未変更annotationは`import-unmodified`、ユーザー編集後は`import-edited`とし、人の確認状態と分離する。自動確認・自動Ground Truth化はしない。元train由来とProject内splitは別であり、人が確認したGround TruthだけをFR-DAT-009/010の通常splitへ渡す。
- 用途は操作・学習フローの体験であり、農業診断や公式benchmarkではない。安全性、精度、学習時間、撮影session間の独立性は保証しない。専門家による原ラベルもアプリ内の人手確認を代替しない。これは製品の用途・主張範囲であり、MIT条件の変更ではない。
- 未承認weight、ImageNet由来の既定重み、偽の予測・学習結果を追加しない。C9の素材採用はC8由来確認・C6/C7重み審査やGate 1〜5の代替ではない。開いただけで学習・cameraを起動せず、人手確認後のRevision確定→Queue登録の既存要求を維持する。ユーザーの編集・生成データも外部送信しない。

## 4. 未解決事項・親担当への引継ぎ

原READMEの総数は **1,296**、HFカードのsplit掲載数合計は **1,295（1,034 + 133 + 128）** であり、差の原因は未解決である。元trainの**1,034枚**はZIP実体と独立再照合で確認したが、未取得のvalidation/testを含む実総数は未確認。原README掲載数を検証済み総数として公表しない。

| 未完了対象 | 次の担当・記録条件 |
|---|---|
| `resources/samples/beans/LICENSE.txt` | 2026-09-06に固定commitから原bytesを保存。1084 bytes、raw SHA-256 `6bd5d9a34c6a5aa3700e38f4deed272cc116f5c443d68ec461e775a6ee00b9e5` |
| `docs/sample-data/evidence/beans-readme.txt` | 2026-09-06に固定commitから原bytesを保存。2024 bytes、raw SHA-256 `5f93ff8c0b69ff62dcc8ac6d97ddbb51840a20c7cb9708901812148d376c8409` |
| ZIP・60枚・対応ラベル | angular 2800645 bytes、rust 2587196 bytes、healthy 2872342 bytes、画像合計8260183 bytes。manifestは17572 bytes、raw SHA-256 `29f0c7225ed4bcb7e79cfcb135088fd65662ac244654caec78dd2a4a5024c47d`。全画像の元ZIP・選定・manifest・通知hashの独立照合一致。通常decoder/import、目視ラベル品質・学習・製品配布は未実施 |
| 独立レビュー | 原典・通知はLIC-S01、各クラス画像はDATA-03a/b/c、manifestはDATA-03dとして別担当が確認し、必須修正0件。60枚の画像デコード・アプリ試用・Gate合格は主張しない |

LIC-S01の文書・通知・原典保存、hash/リンク検証、独立レビューは完了した。本leafの完了は画像・ZIPの検証や配布Gateの合格を意味しない。

## 5. 2026-09-11再確認(SP02)

本節はLIC-S01の差分確認であり、上記の2026-09-06の承認・取得・独立レビュー履歴を置き換えない。要求定義§3.3、FR-SMP-001〜005、FR-LIC-001/009/012、および依存関係ポリシー§2.1・§9.2を確認した。SP01は親担当から独立レビューを含む完了確認を受けているが、それをSP02の検証・レビュー済み証拠には転用しない。

**本文再確認（閲覧）日：2026-09-11。** 以下の固定版のテキストを再閲覧した日であり、画像・ZIPの取得日、原データ公開日、原典ファイルの保存日ではない。原データ公開日は2020-01-20、既存README・LICENSE原bytesの保存とZIP取得の記録日は2026-09-06のまま維持する。

| 再確認した一次資料 | 本文で確認した内容 |
|---|---|
| [原作者README（固定commit）](https://raw.githubusercontent.com/AI-Lab-Makerere/ibean/6bea90a2a1e6378b134f2941fba43e3d6c5b4373/README.md) | `The Data`が葉画像とNaCRRI専門家による収集時の画像ごとのannotationを説明し、その`Versions/Release`がデータの`License: MIT`と公開日を明記する。画像と分類annotationの許諾判断はこのデータ節に基づき、repositoryのコードがMITという理由だけでは判断しない。 |
| [LICENSE（同一固定commit）](https://raw.githubusercontent.com/AI-Lab-Makerere/ibean/6bea90a2a1e6378b134f2941fba43e3d6c5b4373/LICENSE) | `Copyright (c) 2020 AIR Lab Makerere University`、使用・複製・改変・配布・販売等の許諾、複製または実質的部分への著作権表示・許諾表示の保持義務、無保証条項を確認した。 |
| [HF dataset card（固定revision）](https://huggingface.co/datasets/AI-Lab-Makerere/beans/raw/27aa014ce09b193e1a6f58112d4a66e0eddb69c5/README.md) | 原作者repositoryへのリンク、3クラス、train 1,034・validation 133・test 128を確認した。metadataはMITだが、`Licensing Information`本文は`[More Information Needed]`であり、バッジだけを許諾根拠にしない。 |

本文内の関連テキストリンクとして[原作者repository](https://github.com/AI-Lab-Makerere/ibean/)と[旧HF短縮リンク](https://huggingface.co/datasets/beans)も同日に辿った。旧HF短縮リンクの取得結果はdataset cardではなかったため、許諾判断・取得元には用いない。これらの可変ページを固定版の代替にせず、GitHub commit `6bea90a2a1e6378b134f2941fba43e3d6c5b4373`とHF revision `27aa014ce09b193e1a6f58112d4a66e0eddb69c5`を維持する。画像・ZIP・その他のデータ本体リンクは取得していない。

**今回確認した固定版の本文と既存採用記録の範囲では、画像・分類annotationの許諾根拠、必要通知、既存の条件付き採用判断を変更する差分は見つからなかった。** これは現行データセット全体の権利・品質・整合性に関する絶対的な保証、新規の出荷承認、モデル重みの承認ではない。原READMEの1,296とHF掲載split合計1,295の差、およびHFの許諾詳細未記入は未解決のまま保持する。

- 保存済み`resources/samples/beans/LICENSE.txt`、`ATTRIBUTION.txt`、`docs/sample-data/evidence/beans-readme.txt`の本文も参照し、MIT全文・著作権表示・出典・部分選択だけという変更表示を確認した。既存原bytes・manifest・通知を変更せず、取得したWeb本文をファイルへ保存し直していない。必要通知の同梱、ReferenceでもProject側への由来・通知保持、オフライン閲覧という条件は維持する。製品内での履行確認は後続タスクで行う。
- ローカル実体の数値はSP01の親担当によるraw bytes/hash照合結果を引き継ぐ：元trainから各クラス20枚、計60枚、画像合計8,260,183 bytes、manifest・通知を含むBeans資産合計8,281,151 bytes。SP02で再計測した値ではない。正常な原画像・対応ラベルを保持し、追加取得、resize、再圧縮、metadata書換、選定ID変更を行わない。
- **今回、画像の通常decode/import、アプリ試用、学習、build、installer検証、コマンド・test実行は行っていない。** 通常decode/importは未実施のまま残す。原ラベルは人手確認を代替せず、Copy/Reference・保存場所・権利確認や既存Gateを省略しない。
- SP02の対象文書検証・独立レビュー・完了判定は親担当へ引き継ぐ。対象検証の後に独立レビューを行い、指摘修正・再検証が必要なら実施してから依存タスクへ進む。本節の追記をもってSP02をレビュー済み・完了とは判定しない。