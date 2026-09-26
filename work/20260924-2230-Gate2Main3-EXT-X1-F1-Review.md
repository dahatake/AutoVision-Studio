# Gate2Main3 EXT-X1-F1 の敵対的レビュー

- 対象: `src/main/data/import-files.test.ts`（test だけの変更。製品の code は変えない）。
- 方法: 独立の rubber-duck agent（読み取りだけ）が、3 file の差分（EXT-X1-F1〜F3）と `work/20260924-2230-EXT-X1-RootCause.md` §1 を、EXT-X1 の計画 §3（`work/20260924-0730-EXT-X1-Plan.md:66-68`。test を弱めない）に照らして確認した。trace log（`work/20260924-2215-EXT-X1-trace.raw.log` 5〜16・83〜93 行）の引用、spy が本物の `closeSync` を呼ぶこと、Node の `closeSync` が OS の失敗で例外を投げること（Node v24.19.0 で `EBADF` を確認）、同じ危険のある他の test の点検、3 file の vitest（192 tests passed）と `npm run typecheck`（exit 0）を確認した。
- 結果: 指摘なし。mock は本物の解放を行った後に失敗を注入し、製品の再試行（`src/main/data/import-files.ts:161-167`）には再利用された番号に触れずに `EBADF` を返す（`import-files.test.ts:273-279`）。注入の経路と確認する結果は変わらない。

blocking: 0
