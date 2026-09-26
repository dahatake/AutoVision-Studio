# UIR-017 — M1画面枠の実ウィンドウ確認

## 範囲と実行方法

状態：**技術確認PASS・本人確認NOT_RUNのためUIR-017全体はBLOCKED**。Project/core、編集・学習・推論は未実装であり、本検査はM1の画面枠だけを対象とする。Gate 1や製品受入を代替しない。

出力追加は[UI実行記録](../../docs/ui-ux-execution.md)で事前登録した。`ui-shell-probe.mjs`は既存buildのMain entryを読み、一時profileを指定して実Electronを起動するtask限定の検査であり、製品の起動script・API・設定flagへ接続しない。

- 前提：規約のnpm 12.0.0／Node 24.19.xで既存のtest・typecheck・buildが成功していること。
- 実行：repository rootから`node_modules/electron/dist/electron.exe tests/manual/ui-shell-probe.mjs`。
- 結果：`test-results/ui-shell-<UUID>/result.json`とPNG。profileも同じ一時出力内へ隔離し、既存のuserDataやProjectを使用しない。
- 操作：Electronのnative入力イベントでTab／矢印／Home・End／Enter／mouseを送り、DOM矩形・scroll・focusと実画面captureを確認する。本人の操作・回答ではない。
- 原本：source/buildのraw SHA-256を実行前後で照合する。full notice本文の一致は別途検証し、raw hashと改行正規化後の本文を区別する。

## 技術確認

最終runは `test-results/ui-shell-7fca05c0-0e4e-4649-82fb-baadaff176b0/`。開始 `2026-09-06T21:52:43.571Z`、終了 `2026-09-06T21:52:56.154Z`（JSTでは2026-09-07 06:52）。`result.json`のraw bytes SHA-256は `d0ec93252331ee5f55cf821c0a21d07cf6fc2b87d97c8ae8d918bdfbfa0c0613`。検査とElectronの終了コードはともに0、repositoryのElectron executableを対象にした終了後の残processは0件だった。

| 確認対象 | 実測・判定 |
|---|---|
| 環境 | Windows x64 `10.0.29648`、Electron `44.0.0`、Chromium `152.0.7977.54`。ディスプレイ1920×1280 DIP、workArea 1920×1232 DIP、OS scale 1.25 |
| 初期window | 外枠 x=280/y=216/1360×800 DIP、content 1346×737。workArea内。外枠とCSS viewportを混同しない |
| 通常表示 | 設定したcontent 1280×640と実CSS viewportが一致。5作業タブ、設定、両通知展開でdocumentの幅/高さは1280×640。対象操作は画面内 |
| 拡大表示 | zoom=2で実CSS viewport 640×320、DPR 2.5。縦scrollを許容し、対象へTabで到達した後の矩形・中央hit・focus・document可視性を検証 |
| 200% keyboard | 37観測すべてPASS。5作業タブ、5設定カテゴリ、Project一覧、skip-link、Project設定・診断入口、補助画面、設定往復、両通知の開閉入口を含む。Tab/矢印/Enterで操作し、検査からfocus/scroll位置を強制して到達証拠にしていない |
| 通知 | LICENSE/NOTICEの全文がローカルfileと一致（CRLFをLFへ正規化）。100%と200%の計4回すべて、Tabで本文へfocusしCtrl+Endで末尾へ到達 |
| その他の寸法 | 1024×600、1440×900、1920×1080のcamera画面枠を実viewportで確認。業務画像・件数の増加は未実装であり検証対象外 |
| 描画・画像証拠 | 28ケース・28個の一意なPNG、全raw SHA-256を保存後にも再照合。各画像は連続2回の同一captureで安定を確認。倍率/寸法/theme変更時は前回画像との差異も要求。今回の最大取得回数は2 |
| 100%→200%の画像 | `information-open-dark` は `032ca0199427a24215ce8ff37963e1c25faeacb1668bdbb6c62cb6d6392e8df2`、`information-open-dark-200` は `c942ee2cac0d18802e01092629a31cacee1dd022ec74c12edf254855e91f70c0`。異なる描画として取得 |
| 境界・整合 | 公開bridgeは`contractVersion`だけ。source・buildの実行前後hash一致、Renderer error 0。一時profileを使用 |

直前の全体回帰は、npm 12.0.0／Node 24.19.0で `npm test`（Vitest 12 files/155 tests、版検証25 tests、文書22 tests）、`npm run typecheck`、`npm run build`（Main/Preload/Renderer）、`git diff --check`がすべてexit 0。最終検査scriptのraw hashは `7b226b336abe43a8c926051065c1889c63e699b11c2cd78cb1df39cd8c061d8d`。Renderer JSは `012ed5e9be0b62189800c9571eea8877c9e31340394c726ec095b69dacab3af5`、CSSは `d9c14241ad2d24b377db88554930ef76a40271d98282ea9f0f00a409a732189a`。

## 失敗・独立レビュー・反映

| 検出した事実 | 修正・再確認 |
|---|---|
| 最初の検査はEnterに文字イベントを送らずbutton選択を実行できなかった | 検査のkeyDown→char→keyUpへ修正。製品側へ独自キー処理を追加せず再測定 |
| 通知のCtrl+End直後、2描画frameではネイティブscrollが終了していなかった | focusとscroll位置を記録し、最大1500msの描画frame観測で末尾到達を判定。手動scroll位置設定なしで成功 |
| 独立レビューMajor 1：keyboard/mouseのcamera画像が同名で上書きされた | ケース名を分離し重複名拒否・新規作成専用保存・全画像再hash照合を追加 |
| 独立レビューMajor 2：200%で縦scrollを許可するだけでkeyboard到達性を試していなかった | 上表の37観測と操作結果確認を追加。画面外であること自体を不具合とは判定しない |
| 独立レビューMajor 3：倍率変更直後のPNGが変更前と同じだった | DOMだけでなく合成画像の安定・変更を確認して採取。旧画像を修復せず、新runで再測定 |

別担当の最終独立レビューは上記Major 3件をすべてClosedとし、対象範囲の追加指摘なし。レビューはテキスト証跡の確認であり、利用者の画面理解やNarratorを代行したものではない。初期失敗runと、上書き/古い描画を含んだ中間runは最終合格証拠に採用しない。

検査のLIMIT：UIの画面枠のみ。本人の理解、Narrator、Windows high contrastの実設定、業務データ、性能SLA、カメラ実機、ネットワークキャプチャ、installer/servicing、Gate 1〜5はこのPASSに含めない。28ケースは全製品画面・全Windows環境の合格を意味しない。

## 本人確認

**NOT_RUN**。利用者が次の操作を行い、現在対象・表示状態・次の結果・戻り先を理解できるか確認する。未実施を承認済みDUやエージェントの回答で置き換えない。

2026-09-07、別の一時profileを使う本人確認用プレビューを起動し、`UI_USER_PREVIEW_READY`を確認した。確認依頼への応答は「現在は対応できず、後日レビューする。自律的に進める」であり、実操作・理解についての回答ではなかった。したがって本人確認はNOT_RUNのまま保持する。今回のプレビューだけを`CloseMainWindow()`で正常終了させ、対応する残process 0件を確認した。確認用の起動ファイルはGit除外領域の`test-results/ui-shell-user-preview.mjs`で、製品へ追加した起動経路ではない。

2026-09-21のWave 1実行でも、実施可否を利用者へ照会した。応答は得られず（利用者不在）、実操作・理解についての回答は今回も取得していない。今回はプレビューの起動を行っておらず、2026-09-07の起動記録を今回の実施として再利用しない。したがって本人確認は引き続き**NOT_RUN**、UIR-017全体は**BLOCKED**のまま保持する。照会したこと自体を実施・合格として扱わない。

2026-09-24、利用者が行う作業としてUIR-017の本人確認（下の1〜4）を示した。利用者の回答は「B-3: 確認済み」（原文のまま。B-3は示した作業の番号）で、操作ごとの現在対象・表示状態・次の結果・戻り先の回答はなかった。今回、実行主体はプレビューを起動していない。期待した入口と実際の回答・操作を操作ごとに対応付けられないため、1〜4のいずれも達成と記録せず、本人確認は**NOT_RUN**、UIR-017全体は**BLOCKED**のまま保持する。「B-3: 確認済み」の回答は本節に残し、操作ごとの回答が得られた時点でこの下に追記する。
1. Project一覧と「作業画面を確認」が業務機能の完成ではないと識別する。
2. 5作業タブを移動し、「設定」から製品版と通知へ到達する。
3. 教師データ／カメラ画面から設定へ移動して、元の入口へ戻る。
4. 200%拡大・keyboardで操作に到達できるか、読みにくい箇所がないかを確認する。

期待した入口と実際の回答・操作を対応付け、達成／未達／未実施を記録する。本人確認が未実施の間はUIR-017全体とM1を完了扱いにしない。