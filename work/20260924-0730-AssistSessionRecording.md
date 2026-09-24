# G2T-40: Assist session 記録手段の調査

## 結論

製品 editor は、annotation item と target provenance として `manual` / `import-unmodified` / `import-edited` を保持できる。import 由来 target は workspace 作成時に `import-unmodified` で作られ（ src\main\annotations\workspace-service.ts:93 ）、draft save で変更が入ると `import-edited` へ変わる（ src\main\annotations\save-draft.ts:113 ）。一方、harness が要求する per-image `seconds` と `outcome` は editor contract / IPC / draft save input には見つからない。`seconds` / `outcome` は生成・推定・補完してはならず、実作業から得た値だけにする（ work\202609232120-RemainTaskExecutionPlan.md:320 、 spikes\models\assist_benchmark.py:6 、 spikes\models\assist_benchmark.py:7 ）。

調査メモ: `seconds|outcome|elapsed|duration|timer|session` を指定 5 件の TS ファイルで検索したところ、該当は「timers を持たない」というコメントのみ（ src\main\annotations\save-draft.ts:125 ）。`Date.now|new Date` は workspace/item の lifecycle timestamp（createdAt/updatedAt）用であり（ src\main\annotations\workspace-service.ts:86 、 src\main\annotations\workspace-service.ts:88 、 src\main\annotations\save-draft.ts:151 ）、per-image elapsed time ではない。

## 現行 code から確認できること

- `AnnotationItem` は `state` / `editVersion` / `confirmedAt` / `updatedAt` を持つが、session ID、elapsed seconds、accept/edit/reject はない（ src\shared\contracts\annotation.ts:176 、 src\shared\contracts\annotation.ts:181 ）。
- provenance kind は `manual` / `import-unmodified` / `import-edited` を含む（ src\shared\contracts\annotation.ts:198 ）。import/model/manual の source 整合性は `sourceSuggestionId` などで制約される（ src\shared\contracts\annotation.ts:209 、 src\shared\contracts\annotation.ts:210 、 src\shared\contracts\annotation.ts:211 ）。
- annotation save IPC input は annotation/state/exclusionReason/CAS だけで、`seconds` や `outcome` を受け取らない（ src\shared\contracts\annotation-ipc.ts:104 、 src\shared\contracts\annotation-ipc.ts:105 、 src\shared\contracts\annotation-ipc.ts:106 ）。
- save-draft は新規 target を `manual` として扱う（ src\main\annotations\save-draft.ts:97 ）。model provenance は draft save では未有効（ src\main\annotations\save-draft.ts:100 ）。
- target history は target key ごとの保存であり（ src\main\annotations\target-history.ts:111 、 src\main\annotations\target-history.ts:127 ）、1 画像内で keep/edit/delete/add が混在し得るため、harness の 1 item 1 record（ spikes\models\assist_benchmark.py:20 ）へ機械的に roll-up して outcome を作ってはいけない。
- harness 入力は JSON Lines で `item_id` / `proposed` / `outcome` / `seconds` が必須（ spikes\models\assist_benchmark.py:20 、 spikes\models\assist_benchmark.py:55 ）。`outcome` は `accept` / `edit` / `reject` / `manual` のみ（ spikes\models\assist_benchmark.py:41 ）。

### 候補 1: 外部ストップウォッチ + 作業中の per-item outcome 入力 + sidecar 証跡

方法: editor は通常どおり使う。作業者または観測者が item ごとの開始/終了から `seconds` を実測し、同じ作業中に item 単位の `outcome`（accept/edit/reject/manual）を明示入力する。assisted session で import を C7 提案の搬送手段にする場合は、import provenance だけでは C7 提案とは言えないため、approved C7 の実出力と `item_id` / `sourceImageKey` を結び付ける real-work sidecar を必須にする。provenance/history は入力済み outcome の監査材料に限定し、target-level action を item outcome へ生成・集約しない。

根拠: import provenance は `sourceSuggestionId: null` で作られる（ src\main\annotations\workspace-service.ts:94 ）、draft save は model provenance を拒む（ src\main\annotations\save-draft.ts:100 ）、assisted session は approved C7 があって初めて存在できる（ spikes\models\assist_benchmark.py:8 、 spikes\models\assist_benchmark.py:9 ）。harness は実作業 JSONL だけを入力に取る（ spikes\models\assist-result.md:80 ）。

Gate 2 前に製品 code の変更が必要か: いいえ

変更範囲: 製品 code なし。外部 stopwatch/outcome form、C7 sidecar、JSONL 作成手順。

工数: 小〜中。sidecar と operator 入力欄の運用統制が必要。

注意: `seconds` と `outcome` は推定・補完しない。測り忘れた item、または C7 sidecar と照合できない assisted item は未取得として扱う。

### 候補 2: 製品外の session recorder / extractor で明示入力を join / validate する

方法: Gate 2 用の製品外 script または notebook で、作業者が item 開始/終了と item-level outcome を作業中に入力する。extractor は既存 DB の item/provenance/history を読み出して、その明示入力を join / validate するだけにする。target-level provenance/history から outcome 案を作らず、混在 action を item outcome へ roll-up しない。

根拠: save IPC response は item と provenance を返せる（ src\shared\contracts\annotation-ipc.ts:137 ）、draft save は保存後の item/provenance を読み直して返す（ src\main\annotations\save-draft.ts:182 、 src\main\annotations\save-draft.ts:189 ）。ただし IPC input 自体に `seconds` / `outcome` はない（ src\shared\contracts\annotation-ipc.ts:104 、 src\shared\contracts\annotation-ipc.ts:106 ）。

Gate 2 前に製品 code の変更が必要か: いいえ

変更範囲: 製品外の spike/tool と運用手順。製品 DB schema や IPC は変更しない。

工数: 中。DB 読み取り、sidecar join、未照合 item の fail-closed 扱いが必要。

注意: recorder/extractor が `seconds` / `outcome` を生成・推定・補完してはいけない。`seconds` と `outcome` は作業中の明示入力だけを採用し、provenance/history は検証材料に留める。

### 候補 3: 製品 editor に session recording を実装する

方法: editor UI / IPC / main persistence に session ID、item 開始/終了、operator-confirmed outcome を追加し、export で harness JSONL を出す。accept/edit/reject は UI 上で item 単位に確認させる。

根拠: 現在の `SaveAnnotationDraftInput` は annotation/state/exclusionReason/CAS だけ（ src\main\annotations\save-draft.ts:17 、 src\main\annotations\save-draft.ts:19 、 src\main\annotations\save-draft.ts:20 、 src\main\annotations\save-draft.ts:21 、 src\main\annotations\save-draft.ts:24 ）、IPC save input も `seconds` / `outcome` を含まない（ src\shared\contracts\annotation-ipc.ts:104 、 src\shared\contracts\annotation-ipc.ts:106 ）。現行 save primitive は「timers なし」と明記している（ src\main\annotations\save-draft.ts:125 ）。

Gate 2 前に製品 code の変更が必要か: はい

変更範囲: UI、shared contract、IPC、main persistence、export/test。schema migration が必要になる可能性が高い。

工数: 大。Gate 2 前に入れるなら regression test と migration review も必要。

注意: `seconds` / `outcome` は UI が実作業から記録した値だけを保存し、空欄を推定・補完しない制約を test 化する。

### 候補 4: 実装しない

方法: G2D-04 の「実装しない」選択肢を採る場合は、session 記録は作らず、assist baseline は未測定のまま Gate 2 BLOCKED を維持する。製品 editor が現在の provenance 以上の session 記録を持たないため、測定値を作らない。

根拠: 現在の結果文書は実測欄を未取得のままとし（ spikes\models\assist-result.md:107 、 spikes\models\assist-result.md:111 ）、未取得欄に推定値を書かないとしている（ spikes\models\assist-result.md:113 ）。Gate 2 は BLOCKED のままと記録され、AST 実装は baseline が MEASURED になるまで開始しない（ spikes\models\assist-result.md:129 、 spikes\models\assist-result.md:131 ）。

Gate 2 前に製品 code の変更が必要か: いいえ

変更範囲: なし。ただし Gate 2 解除に必要な実測は得られない。

工数: 小。

注意: `seconds` / `outcome` を生成・推定・補完しないという制約には合うが、baseline の完了にはならない。

