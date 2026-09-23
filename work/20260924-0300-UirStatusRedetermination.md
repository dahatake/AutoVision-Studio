# UIR 状態再判定記録（AUD-01）

| 項目 | 値 |
|---|---|
| 文書種別 | AUD-01 状態再判定記録 |
| 作成日時 | 2026-09-24 JST |
| 対象 | UIR-025 残条件 9 件、UIR-041Q / UIR-084 前提 |
| 実行範囲 | 読み取り監査のみ。アプリ起動・test実行なし |
| 出力 | `work\20260924-0300-UirStatusRedetermination.md` |

## 入力 files（Get-FileHash SHA-256）

| file | SHA-256 |
|---|---|
| docs\ui-ux-execution.md | 81991147afa419b4f032b155ebda2512485dbd0a08a2404d0c8ea02a1a5ebb27 |
| work\202609232400-RemainTaskExecutionPlan.md | 29ba4798ca69069cf0f2799a7960a650b0d56bf456b4e219eb6addc9959b2579 |
| docs\implementation-plan.md | ba446dd8c08390dfb29c757de5f438ab90dcac51f4bc74bc6a775c6acf019b16 |
| src\main\projects\delete-preview.ts | 2878fc8514932b3dc78687439b1393a80703381b4a51fa9edd923883ae725a12 |
| src\main\projects\delete-preview.test.ts | c9b12b29faff3db7ac2ab619b7e04a18a290f722468310d8e5416b6b629dfd77 |
| src\renderer\layout\AppShell.tsx | f96194b6bd2123c6cb703d268e7fd6c3c302b743d43867aa340a5f47f6b27099 |
| src\renderer\features\projects\DeleteProjectDialog.tsx | 2d6309fdbe22337f0c44ec1e936e96e0e88a8a4b3aaa21dc22d77a19acf1b0c0 |
| src\renderer\features\projects\DeleteProjectDialog.test.tsx | c74154a0d616e44c52a3e40988acf9485a830bc1cc3fa5dc9f17754fde25ac17 |
| src\renderer\layout\AppShell.test.tsx | 5996353bf065e3fa2291dc533c01fbe0def11c23943f30ac49924e4a6c4fc1d6 |
| tests\e2e\harness.ts | b91af4919e076ba6b25c920be57099d5593fdb6d6d1c382ef381b3bb9a7e3544 |
| tests\e2e\project-crud.spec.ts | e763e426e2da7a8654fc864415a017ecca141c61f754cf0b8151c74378583d0f |
| src\main\projects\delete-project.ts | 1b40ccb80df9fc8aed91f909cb1531ba59f5a5062bc6b0daa95bf64845fd448d |
| src\main\projects\delete-project.test.ts | 0f06a74747a1324a91221a538502a9977fd92dffb5752513775e6da4cfa53763 |
| src\main\ipc\project-handlers.ts | e472a8fbd353bbdedc2fe41e18eac11e595b5c0f694146d3b54540d922f3c86a |
| tests\manual\ui-shell-review.md | 36c861c6ea504aa29bf299dd2b1e8b5f6b3103b2e156c71bd5f35f4639422812 |
| tests\manual\windows-file-picker.md | 0212dabf7ba9e87764a49a0a87a9dfd167aaf702a7bf1e11177e40cc18b68fbd |
| work\20260921-1330-TaskExecutionPlan.md | 0ec294ae79f3b694c698d338f841c45ee233a0e2bf661481abc448cece3ca880 |
| docs\adr\0003-packaging.md | a46567f343b480adaf8f6c34e827fcc9d1be00885f9d9784e4ad979b803db6b2 |
| docs\adr\0004-spike-decisions.md | 29d12240a49832b17ac1df1f7c9a92a2672a7b719a8c8f16bf0b412c2810fd5e |
| src\main\annotations\confirm-and-queue.ts | 11c11f5795b00a21869d6d4ab6097632d851a4779dc88b7473fbed3976af0851 |
| tests\e2e\annotation-classification.spec.ts | 11f6dc4c3ba1d804192db9622183de8f51ed3cfb5e7ec2f240046825b5c4acf9 |
| tests\e2e\annotation-detection.spec.ts | dbf4d314cebd6e14296f3ea8c06aea5dc44b4c3a71c42268e5830883a137f2d1 |
| docs\users-guide.md | 5063151d875b23fb8974e980e15c774b4aa7ddc9655afdd7d1bc89870092dc45 |
| src\renderer\features\settings\SettingsPage.tsx | 4ef66b5eec1d6fe0ffd59ee15665e43586508b8b9d0571f9c56f82fd9e447159 |

## 再判定表

| # | 項目 | 受入条件（原文の要約と出典行） | 判定 | 根拠 <path>:<行> | 備考 |
|---|---|---|---|---|---|
| 1 | UIR-025 残条件1：削除previewのMain実装 | 所有データとReference参照データを区別した件数・容量取得（docs\ui-ux-execution.md:446） | 完了 | src\main\projects\delete-preview.ts:161, src\main\projects\delete-preview.ts:179, src\main\projects\delete-preview.ts:185, src\main\projects\delete-preview.ts:205, src\main\projects\delete-preview.test.ts:96, src\main\projects\delete-preview.test.ts:125 | 実preview関数と単体testで、所有/Reference、容量、read-only性を確認した。 |
| 2 | UIR-025 残条件2：UIR-025B 削除preview接続 | 実previewの件数・容量・所有/Reference境界をUIへ接続し、失敗・Project切替後の古いpreviewを使わない（docs\ui-ux-execution.md:447、docs\implementation-plan.md:867） | 未完了 | src\renderer\features\projects\DeleteProjectDialog.tsx:81, src\renderer\features\projects\DeleteProjectDialog.tsx:96, src\renderer\layout\AppShell.tsx:357, src\renderer\layout\AppShell.tsx:359, src\renderer\layout\AppShell.tsx:364, src\renderer\layout\AppShell.test.tsx:479 | UI表示と失敗時clearはあるが、preview応答後の再検証はAPI同一性のみで、Project切替後の古いpreview不使用を満たすguard/testを確認できなかった。 |
| 3 | UIR-025 残条件3：PRE-03 E2E harness | 実在・build可能なappだけを起動し、一時profile/Projectと確実な終了を検証（docs\ui-ux-execution.md:448） | 完了 | tests\e2e\harness.ts:14, tests\e2e\harness.ts:33, tests\e2e\harness.ts:86, tests\e2e\harness.ts:91, tests\e2e\harness.ts:110, tests\e2e\harness.ts:115 | built artifact確認、isolated user-data-dir、残process 0件検査を確認した。 |
| 4 | UIR-025 残条件4：CORE-13A Project E2E受入 | 親UIR-025とPRE-03の後にpreviewを含む受入を実施（docs\ui-ux-execution.md:449） | 未完了 | tests\e2e\project-crud.spec.ts:55, tests\e2e\project-crud.spec.ts:64, tests\e2e\project-crud.spec.ts:65, tests\e2e\project-crud.spec.ts:74, docs\implementation-plan.md:1740, docs\implementation-plan.md:1744 | happy path E2Eは存在し記録もPASSだが、#2の古いpreview条件が未充足のため、親UIR-025を閉じる受入としては未完了。 |
| 5 | UIR-025 残条件5：実削除の接続 | REL-04・UIR-079後のUIN-07→08→09で実削除を接続しCORE-13Dへ合流（docs\ui-ux-execution.md:450） | 完了 | src\main\projects\delete-project.ts:102, src\main\projects\delete-project.ts:116, src\main\projects\delete-project.ts:127, src\main\projects\delete-project.ts:146, src\main\projects\delete-project.test.ts:106, src\main\projects\delete-project.test.ts:121, src\main\ipc\project-handlers.ts:451, tests\e2e\project-crud.spec.ts:70 | delete Main、IPC接続、明示確認後のE2E削除、Reference保持を確認した。 |
| 6 | UIR-025 残条件6：本人確認（通常密度・Narrator・OS picker実操作） | UIR-025A節が未完として残した利用者実操作項目（docs\ui-ux-execution.md:451） | 未完了 | tests\manual\ui-shell-review.md:50, tests\manual\ui-shell-review.md:54, tests\manual\windows-file-picker.md:7, tests\manual\windows-file-picker.md:8, tests\manual\windows-file-picker.md:46 | 本人確認とOS標準pickerの実機受入はNOT_RUNのまま。 |
| 7 | UIR-025 残条件7：正式製品Gate（Gate 3） | 縦スライス成立を実E2Eから判定。前提は #3・#4（docs\ui-ux-execution.md:452） | 未完了 | docs\ui-ux-execution.md:452, docs\implementation-plan.md:1718, docs\implementation-plan.md:1740, docs\implementation-plan.md:1744 | 実装計画には Gate 3 再判定 PASS の記録があるが、W1-03 が前提とする #4 が本表で未完了（#2 の古いpreview不使用を検証していない）のため、親UIR-025を閉じる条件としては未完了。Gate 3 PASS の記録そのものは変更しない。 |
| 8 | UIR-025 残条件8：署名（Windowsコード署名証明書 D-16） | 利用者からの証明書提示が必要（docs\ui-ux-execution.md:453） | 未完了 | docs\implementation-plan.md:85, docs\implementation-plan.md:690, work\20260921-1330-TaskExecutionPlan.md:314, docs\adr\0003-packaging.md:109 | 正式証明書はユーザー提示待ちで、署名検証taskも後続。 |
| 9 | UIR-025 残条件9：clean install | SPI-03のclean Windows実測。SKIPPED_BY_USERを保持し、別名で開発前提へ戻さない（docs\ui-ux-execution.md:454） | 未完了 | docs\adr\0004-spike-decisions.md:22, docs\adr\0004-spike-decisions.md:110, docs\adr\0003-packaging.md:223, work\202609232400-RemainTaskExecutionPlan.md:62 | clean Windows / offline installの正式受入は未実施で、SPI-03はPASSへ読み替えない。 |
| 10 | UIR-041Q 前提 | W1-02はUIR-041未着手、confirm-and-queue不在、結果file 0件を前提不足としていた（docs\ui-ux-execution.md:433） | 完了 | src\main\annotations\confirm-and-queue.ts:10, src\main\annotations\confirm-and-queue.ts:16, src\main\annotations\confirm-and-queue.ts:17, tests\e2e\annotation-classification.spec.ts:50, tests\e2e\annotation-classification.spec.ts:87, tests\e2e\annotation-detection.spec.ts:50, tests\e2e\annotation-detection.spec.ts:110, docs\implementation-plan.md:1740 | 手動編集→確認→Revision→Queueの実装・E2E記録を確認。UIR-041Q本人確認そのものは別。 |
| 11 | UIR-084 前提 | W1-02はUIR-082の設定書出し・削除・運用domainとE2E基盤を前提不足としていた（docs\ui-ux-execution.md:434） | 未完了 | docs\implementation-plan.md:846, docs\implementation-plan.md:854, docs\users-guide.md:20, docs\users-guide.md:875, docs\users-guide.md:877, src\renderer\features\settings\SettingsPage.tsx:24 | E2E基盤は存在するが、UIR-082T/082Dの設定・運用domainは未完。したがってUIR-084前提は未完了。 |

完了: 4 / 未完了: 7 / 未確認: 0

## test実行

本AUD-01では、指示に従いアプリを起動せず、既存testも実行しなかった。判定は上記fileの現在内容と既存記録の読み取りに基づく。

## 本記録が主張しないこと

- `docs\ui-ux-execution.md` の状態は更新していない。
- UIR-041Q / UIR-084 の利用者本人確認（MAN-05）が完了したとは主張しない。
- UIR-025親タスクが完了したとは主張しない。特に#2、#4、#6、#7、#8、#9が残る。
- 敵対的レビュー（2026-09-24）の指摘により、#7 を当初の「完了」から「未完了」へ改めた（#4 が前提であり、#4 を未完了と判定したため）。
- Gate 3 PASSを正式署名、clean Windows install、Gate 4/5、release可否へ拡張しない。
- 本記録の読み取り確認を、未実施testや未実施実機受入のPASSへ読み替えない。
