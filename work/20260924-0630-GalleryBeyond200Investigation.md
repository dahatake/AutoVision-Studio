# Gallery 200 件超調査（GAL-01）

## 1) 読んだ file と行範囲

- `work\202609232400-RemainTaskExecutionPlan.md:244-258`
- `.github\skills\atg\references\planning.md:1-80`
- `src\renderer\features\annotations\AnnotationPage.tsx:60-110`
- `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:1-130,150-194,338-362`（544 行ファイル。合計 200 行、非重複の union）
- `src\renderer\features\annotations\ImageGallery.tsx:1-84`
- `src\shared\contracts\annotation-ipc.ts:90-110,132-140,196-206`
- `src\main\ipc\annotation-handlers.ts:188-212`
- `src\main\annotations\workspace-service.ts:1-80,140-260`
- `src\main\annotations\workspace-repository.ts:150-254`
- `src\main\annotations\workspace-service.test.ts:410-430`
- `src\renderer\features\annotations\AnnotationWorkspacePage.test.tsx:80-120`
- `src\shared\contracts\annotation-ipc.test.ts:178-190`
- `src\renderer\features\annotations\AnnotationPage.test.tsx:40-75`

## 2) 結論（上限・総件数の出所・最初の境界・変更が要る層）

### 現在の取得上限

- Renderer の workspace 入口は `PAGE_LIMIT = 200` を持つ。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:30`
- workspace 初期 load は `offset: 0, limit: PAGE_LIMIT` だけを list request に入れる。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:169`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:170`
- standalone skeleton 側の入口も `offset: 0, limit: 200` を直接 request に入れる。根拠: `src\renderer\features\annotations\AnnotationPage.tsx:83`
- IPC 入力契約は list `limit` を `1..200` に制限する。根拠: `src\shared\contracts\annotation-ipc.ts:100`、`src\shared\contracts\annotation-ipc.ts:101`
- IPC 応答契約は `items` を最大 200 件に制限する。根拠: `src\shared\contracts\annotation-ipc.ts:136`
- Main service 側も `MAX_ANNOTATION_PAGE_SIZE = 200` を持ち、list options の `limit` をその値以下に検証する。根拠: `src\main\annotations\workspace-service.ts:23`、`src\main\annotations\workspace-service.ts:216`

### 総件数の出所

- Main repository は `annotation_items` から `SELECT count(*) AS total` を実行し、workspace と optional state filter に対する総件数を得る。根拠: `src\main\annotations\workspace-repository.ts:245`、`src\main\annotations\workspace-repository.ts:247`
- Main repository は page rows とは別に `count.total` を戻り値 `total` として返す。根拠: `src\main\annotations\workspace-repository.ts:250`、`src\main\annotations\workspace-repository.ts:251`
- IPC handler は `annotation:list` を `listAnnotationItems(...)` へ委譲している。根拠: `src\main\ipc\annotation-handlers.ts:202`、`src\main\ipc\annotation-handlers.ts:204`
- Renderer workspace は response の `listed.value.total` を `setTotal` する。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:179`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:180`
- standalone skeleton も response の `listResponse.value.total` を `setTotal` する。根拠: `src\renderer\features\annotations\AnnotationPage.tsx:87`

### 201 件目へ到達できない最初の境界

- workspace 画面で最初に 201 件目が落ちる境界は Renderer の初期 list request で、`offset: 0` と `limit: PAGE_LIMIT`（200）しか要求していない箇所。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:30`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:169`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:170`
- その後 Renderer は最初の response の `items` だけを state に保持する。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:179`
- Gallery へ渡される props もその `items` だけである。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:356`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:357`
- `ImageGallery` は受け取った `items` から `visible` を作り、`visible.map(...)` だけを描画するため、props に入らない 201 件目は描画対象にならない。根拠: `src\renderer\features\annotations\ImageGallery.tsx:36`、`src\renderer\features\annotations\ImageGallery.tsx:71`
- keyboard navigation も `visible` の index 範囲内に clamp されるため、props に入らない 201 件目へは移動できない。根拠: `src\renderer\features\annotations\ImageGallery.tsx:39`、`src\renderer\features\annotations\ImageGallery.tsx:42`、`src\renderer\features\annotations\ImageGallery.tsx:43`
- standalone skeleton でも初期 list request は `offset: 0, limit: 200` である。根拠: `src\renderer\features\annotations\AnnotationPage.tsx:83`

### Main / IPC / Renderer のどこに変更が要るか

- 事実として、Renderer には変更が要る。理由は、workspace 入口が最初の `offset: 0, limit: PAGE_LIMIT` response だけを `items` として保持し、その `items` だけを Gallery に渡すため。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:169`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:170`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:179`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:357`
- IPC は現状、単一 request/response で 201 件以上を扱う形には変更が要る制約を持つ。根拠: `src\shared\contracts\annotation-ipc.ts:101`、`src\shared\contracts\annotation-ipc.ts:136`
- ただし IPC には既に `offset` と `limit` が存在し、parser は `items.length <= i.limit` と `items.length <= total - offset` を検証している。根拠: `src\shared\contracts\annotation-ipc.ts:100`、`src\shared\contracts\annotation-ipc.ts:201`、`src\shared\contracts\annotation-ipc.ts:203`、`src\shared\contracts\annotation-ipc.ts:204`
- Main には page size 200 の上限はあるが、repository SQL は `LIMIT ? OFFSET ?` を使う。根拠: `src\main\annotations\workspace-service.ts:23`、`src\main\annotations\workspace-service.ts:216`、`src\main\annotations\workspace-repository.ts:250`
- 既存 Main test は複数 page と offset 境界を検証している。根拠: `src\main\annotations\workspace-service.test.ts:419`、`src\main\annotations\workspace-service.test.ts:421`、`src\main\annotations\workspace-service.test.ts:424`
- よって、本調査で「必ず変更が要る」と確認できた層は Renderer。IPC/Main は GAL-02 で決める方式次第で変更要否が分かれる。方式は本調査では決めない。

## 3) 再現記録

### 201 件 fixture の手順（コード根拠に基づく再現）

1. annotation workspace に、同一 workspace/state filter に一致する `annotation_items` を 201 件用意する。
2. workspace 画面の初期 load は `offset: 0, limit: PAGE_LIMIT` だけを送る。`PAGE_LIMIT` は 200。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:30`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:169`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:170`
3. Main repository は total を `SELECT count(*) AS total` から 201 として返し得るが、rows は `LIMIT ? OFFSET ?` によって request limit 分だけになる。根拠: `src\main\annotations\workspace-repository.ts:247`、`src\main\annotations\workspace-repository.ts:250`、`src\main\annotations\workspace-repository.ts:251`
4. Renderer は `listed.value.items` だけを `items` に保持するため、201 件 fixture では先頭 200 件だけが `items` になる。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:179`
5. Gallery は `items` から作った `visible` だけを描画・移動対象にするため、201 件目は list item として到達できない。根拠: `src\renderer\features\annotations\ImageGallery.tsx:36`、`src\renderer\features\annotations\ImageGallery.tsx:39`、`src\renderer\features\annotations\ImageGallery.tsx:71`
6. 既存 Renderer test は `items` が page 分、`total` が workspace-wide count である時に「残り ... 件は未取得」を表示することを検証している。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.test.tsx:105`、`src\renderer\features\annotations\AnnotationWorkspacePage.test.tsx:110`

### 実行した検証

- evidence: `$env:PATH="$env:LOCALAPPDATA\npm-12.0.0;$env:PATH"; & .\node_modules\.bin\vitest.cmd run src\shared\contracts\annotation-ipc.test.ts src\main\annotations\workspace-service.test.ts src\renderer\features\annotations\AnnotationWorkspacePage.test.tsx src\renderer\features\annotations\AnnotationPage.test.tsx` exit=0
  - 結果: 4 files passed, 82 tests passed.
- evidence: `$ok = (Select-String -Path work\20260924-0630-GalleryBeyond200Investigation.md -Pattern '\S+\.tsx?:\d+' -AllMatches).Matches.Count -ge 3; Write-Output $ok; exit ([int](-not $ok))` exit=0
  - 結果: `True`

## 4) GAL-02 への入力（事実のみ。方式は決めない）

- Renderer workspace の現在の list request は `offset: 0, limit: 200` 相当で固定されている。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:30`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:170`
- Renderer workspace は response の `items` だけを Gallery に渡している。根拠: `src\renderer\features\annotations\AnnotationWorkspacePage.tsx:179`、`src\renderer\features\annotations\AnnotationWorkspacePage.tsx:357`
- Gallery は props の `items` 以外を取得しない pure presenter である。根拠: `src\renderer\features\annotations\ImageGallery.tsx:4`、`src\renderer\features\annotations\ImageGallery.tsx:9`、`src\renderer\features\annotations\ImageGallery.tsx:33`
- workspace-wide total は Main repository の `count(*)` 由来で、page items とは別に返る。根拠: `src\main\annotations\workspace-repository.ts:247`、`src\main\annotations\workspace-repository.ts:251`
- IPC contract は page limit 200、response items max 200。根拠: `src\shared\contracts\annotation-ipc.ts:101`、`src\shared\contracts\annotation-ipc.ts:136`
- Main repository は `LIMIT ? OFFSET ?` を使って page rows を読む。根拠: `src\main\annotations\workspace-repository.ts:250`
- Main service は `MAX_ANNOTATION_PAGE_SIZE = 200` を上限にする。根拠: `src\main\annotations\workspace-service.ts:23`、`src\main\annotations\workspace-service.ts:216`

## 5) 本調査が主張しないこと

- offset / cursor / incremental append / virtualized list 等の方式は決めない。
- 1 回の IPC response で 201 件以上を返すべきとは主張しない。
- Main SQL の性能・index・並び順変更の要否は主張しない。
- 201 件目を現在 UI で到達可能とは主張しない。
- product code の変更は行っていない。
