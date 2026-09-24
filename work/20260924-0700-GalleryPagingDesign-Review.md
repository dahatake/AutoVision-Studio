# GAL-D1 の敵対的レビュー（`work/20260924-0700-GalleryPagingDesign.md`）

- reviewer: rubber-duck agent `825f166a-f906-4d46-a0e1-99442446caf3`（3 回）
- 対象: `work/20260924-0700-GalleryPagingDesign.md`、完了条件は計画 `work/202609240830-RemainTaskExecutionPlan.md` の D1

## 1 回目の指摘（blocking 2）

1. filter を保ったまま page の先頭の item を自動で選ぶと、filter で非表示の item の editor が開く（filter は `src/renderer/features/annotations/ImageGallery.tsx:34`・`:36` の内部状態。一覧は `visible` だけを描画する: 同 `:71`〜`:75`。editor は `detail` があれば出る: `src/renderer/features/annotations/AnnotationWorkspacePage.tsx:363`）。
2. 旧 item の `detail` の破棄を effect（`AnnotationWorkspacePage.tsx:201`〜`:203`）に任せると、新しい page の一覧と旧 item の editor が同時に描画されうる。

反映: page を移る場合は取得の前に `setSelectedId(null)` と `setDetail(null)` を行い、取得後も自動で選ばない。Workspace が替わって選択が変わる場合は `setSelectedId` と同じ処理で `setDetail(null)`。編集範囲 `:156-190` の説明と、`GAL 201 items`・`GAL filter boundary` の検査内容を更新した（設計の「keyboard の前後移動」節、「必須 test」の表）。

## 2 回目の指摘（blocking 1）

1. page の要求の取得中に最新の Workspace が替わった場合、「自動で選ばない」と「先頭の item を選ぶ」のどちらが優先するか未定義（`AnnotationWorkspacePage.tsx:160`〜`:168`）。

反映: page の要求の規則を優先する（`offset` は 0、`selectedId` と `detail` は `null` のまま）。初回と「再読込」の Workspace 交替は既存の先頭の選択を保つ。`GAL 201 items` にこの case を加えた（test 名は 9 のまま）。

## 3 回目（再確認）

blocking なし、non-blocking なし。

blocking: 0
