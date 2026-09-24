# Gallery の 200 件超の page 送りの設計（GAL-D1）

- 入力: `work/20260924-0630-GalleryBeyond200Investigation.md`（GAL-01）、`docs/requirement-definition.md`（FR-UI-008 `:211`、FR-UI-010 `:213`）
- 対象: `src/renderer/features/annotations/AnnotationWorkspacePage.tsx` だけ。IPC・Main・`ImageGallery.tsx`・`AnnotationPage.tsx` は変えない。

## 方式

- 既存の list の IPC の `offset` / `limit` で page 単位に取得する（`src/shared/contracts/annotation-ipc.ts:100`、`:101`）。Main は `LIMIT ? OFFSET ?` で page を返す（`src/main/annotations/workspace-repository.ts:250`）。このため **IPC と Main は変えない**。新しい IPC・設定・抽象層は追加しない。
- `AnnotationWorkspaceSession` に現在の page の先頭位置 `offset`（state、初期値 0）を 1 つ加える。`load` に引数 `nextOffset`（既定は現在の `offset`）を加え、list の要求の `offset: 0`（`src/renderer/features/annotations/AnnotationWorkspacePage.tsx:170`）を、その値に替える。
- 状態表示の下に「前の 200 件」「次の 200 件」の 2 つの button を置き、それぞれ `load(false, offset - PAGE_LIMIT)`、`load(false, offset + PAGE_LIMIT)` を呼ぶ。button は `total > PAGE_LIMIT` の場合だけ表示する（200 件以下の既存の表示は変えない）。
- 保持するのは現在の page の item だけで、page を移ると `items` を置き換える（追加しない）。全件の一括読み込みはしない（FR-UI-010 `docs/requirement-definition.md:213`「page/filter/resize で対象を勝手に追加せず」）。全件へは page 送りで到達できる（FR-UI-008 `docs/requirement-definition.md:211`「全件へfilter/pageで到達可能とする」）。

## page の大きさ

既存の `PAGE_LIMIT = 200`（`src/renderer/features/annotations/AnnotationWorkspacePage.tsx:30`）を保つ。IPC の上限（`src/shared/contracts/annotation-ipc.ts:101`、`:136`）と Main の上限（`src/main/annotations/workspace-service.ts:23`）も 200 のため、値を変える理由がない。

## 順序

Main の `ORDER BY a.id`（`src/main/annotations/workspace-repository.ts:250`）に従う。Renderer で並べ替えない。list の要求に `state` を渡さない（現在と同じ）ため、item の状態が変わっても順序と page の境界は変わらない。

## filter 変更時の位置

filter は `ImageGallery` の中の状態で、受け取った `items` の中だけに掛かる（`src/renderer/features/annotations/ImageGallery.tsx:36`）。filter を変えても `offset` は変えず、再取得もしない。page を移っても `ImageGallery` は同じ instance のため filter は保たれ、新しい page の `items` に掛かる。filter で別の page の item を追加しない。

## 総件数

list の応答の `total`（Main の `SELECT count(*)`、`src/main/annotations/workspace-repository.ts:247`）を、page ごとの応答で更新する（現在の `setTotal`、`src/renderer/features/annotations/AnnotationWorkspacePage.tsx:180`）。状態表示の「全 N件（表示 M件）」は保ち、`total > items.length` の場合の文言（`:347`）を「表示は <offset+1>〜<offset+items.length>件目です。残り <total−items.length>件は未取得で、この未確認件数には含まれていません。」に替える（「残り … 件は未取得」の部分は既存の test `src/renderer/features/annotations/AnnotationWorkspacePage.test.tsx:110` の検査のまま通る）。

## 重複・欠落

- page の先頭は 0, 200, 400, … で、各 page は `[offset, offset+200)` の範囲を `ORDER BY a.id` で取るため、page の間に重複も欠落もない（`src/main/annotations/workspace-repository.ts:250`）。
- `load` は毎回 Workspace の一覧から最新の Workspace を選ぶ（`src/renderer/features/annotations/AnnotationWorkspacePage.tsx:168`）。選んだ Workspace が表示中のもの（`workspace.id`）と違う場合は `offset` を 0 にする（別の Workspace の位置を持ち越さない）。
- 応答の検証（`items.length <= limit`、`items.length <= total - offset`）は既存の parser が行う（`src/shared/contracts/annotation-ipc.ts:203`、`:204`）。Renderer で重複を除く処理は加えない。

## keyboard の前後移動

- 矢印 key による item の前後移動は、現在の page の `visible` の中に留まる（`src/renderer/features/annotations/ImageGallery.tsx:39`、`:43`）。`ImageGallery` は変えない。
- page の移動は 2 つの `<button>`（Tab で focus、Enter / Space で押す）で行う。矢印 key で page を越えることはしない。
- page を移るとき（`nextOffset !== offset`）は、取得を始める前に `setSelectedId(null)` と `setDetail(null)` を行い、取得の後も item を自動で選ばない（利用者が新しい page の表示中の item を選ぶまで editor を出さない）。理由: filter は `ImageGallery` の中の状態で親からは見えない（`src/renderer/features/annotations/ImageGallery.tsx:34`、`:36`）ため、先頭の item を自動で選ぶと、filter で非表示の item の editor が開きうる（一覧には描画されない: 同 `:71`〜`:75`。editor は `detail` があれば出る: `src/renderer/features/annotations/AnnotationWorkspacePage.tsx:363`）。また、旧 item の `detail` の破棄を effect（同 `:201`〜`:203`）に任せると、新しい page の一覧と旧 item の editor が同時に表示される描画が挟まりうるため、取得の前に消す。
- page の要求でない `load`（初回と「再読込」）で Workspace が替わって `offset` を 0 にする場合は、既存の選択の規則（先頭の item: 同 `:184`、`:185`）を保つ。ただし選択が変わる場合は、`setSelectedId` と同じ処理の中で `setDetail(null)` を行う（旧 Workspace の item の editor を残さない）。
- 両方が同時に起きた場合（page の要求の取得中に最新の Workspace が替わった場合）は、page の要求の規則を優先する。`offset` は 0 にし、`selectedId` と `detail` は `null` のままにして、自動で選ばない。
- 確認の後と「再読込」（`load(true)`）は現在の `offset` を保ち、選択が page にあれば保つ（既存の規則）。

## 最後の item の境界

- 「前の 200 件」は `offset === 0` のとき無効。「次の 200 件」は `offset + items.length >= total` のとき無効。例: 201 件では先頭の page（1〜200）で「次」が有効、2 番目の page（201）で無効。
- 最後の page の最後の item は選択でき、矢印 key の右・下で同じ item に留まる（`src/renderer/features/annotations/ImageGallery.tsx:43`）。
- どちらの button も `busy` の間は無効（既存の button と同じ）。
- 取得に失敗した場合は、既存の失敗の扱い（`reset` で表示を消し、error の文言を出す: `src/renderer/features/annotations/AnnotationWorkspacePage.tsx:163`、`:174`、`:188`、`:192`）をそのまま使う。前の page の item を失敗した page の item として表示しない。新しい再試行の仕組みは加えない。

## 読み・編集の行範囲

`src/renderer/features/annotations/AnnotationWorkspacePage.tsx`（544 行）:

| 区分 | 行範囲 | 内容 |
|---|---|---|
| 読む | `:1-30` | import、`PAGE_LIMIT` |
| 読む | `:120-200` | `AnnotationWorkspaceSession` の state、`load`、`reset` |
| 読む | `:338-385` | 状態表示、`ImageGallery`、操作 button |
| 編集 | `:127-128` | `offset` の state を加える |
| 編集 | `:156-190` | `load` の引数 `nextOffset`、page を移る場合の取得前の `setSelectedId(null)` / `setDetail(null)` と取得後の非選択、Workspace が替わった場合の 0 と `setDetail(null)`、list の要求の `offset`、`setOffset` |
| 編集 | `:343-349` | 状態表示の文言と、page の 2 つの button |

ほかの file は変えない。`src/renderer/features/annotations/AnnotationPage.tsx:83` の standalone の入口は変える必要がない（本設計は workspace 画面だけに閉じる）。

## 必須 test

`src/renderer/features/annotations/AnnotationWorkspacePage.test.tsx` に加える（GAL-T1）。list の mock は要求の `offset` / `limit` に応じた page を返す。

| test 名 | 確かめること |
|---|---|
| `GAL 0 items` | 0 件で「対象画像がありません。」を表示し、page の button が無い |
| `GAL 1 item` | 1 件で item を表示し、page の button が無い |
| `GAL 200 items` | 200 件で page の button が無く、list は `offset: 0, limit: 200` の 1 回だけ |
| `GAL 201 items` | 「次の 200 件」を押した直後から旧 item の editor が無く、list が `offset: 200, limit: 200` で呼ばれ、201 件目を一覧に表示し、「次」が無効になる。item を選ぶまで editor が無く、201 件目を選ぶと 201 件目の detail の editor が出る。page の要求の取得中に最新の Workspace が替わった場合も、`offset` が 0 になり、自動の選択と旧 item の editor が無い |
| `GAL multiple pages` | 450 件で次・次・前と押すと offset が 0 → 200 → 400 → 200 になり、表示範囲の文言が合う |
| `GAL filter boundary` | 2 番目の page で filter を変えても list が再び呼ばれず、別の page の item が表示されない。filter を保ったまま page を移っても、filter で非表示の item の editor が開かない |
| `GAL last item` | 最後の page の最後の item を選べ、矢印 key で同じ item に留まり、「次」が無効 |
| `GAL no duplicates` | 201 件の 2 つの page に表示された id に重複がなく、合わせて 201 件 |
| `GAL fetch failure` | 2 番目の page の取得の失敗で error の文言を表示し、先頭の page の item を表示しない |

既存の test は弱めない。
