# Gate2Main3 EXT-X1-F2 の敵対的レビュー

- 対象: `src/main/data/reference-source.test.ts`（test だけの変更。製品の code は変えない）。
- 方法: 独立の rubber-duck agent（読み取りだけ）が、3 file の差分（EXT-X1-F1〜F3）と `work/20260924-2230-EXT-X1-RootCause.md` §1 を、EXT-X1 の計画 §3（`work/20260924-0730-EXT-X1-Plan.md:66-68`。test を弱めない）に照らして確認した。trace log（`work/20260924-2215-EXT-X1-trace.raw.log` 5〜16・83〜93 行）の引用、spy が本物の `closeSync` を呼ぶこと、Node の `closeSync` が OS の失敗で例外を投げること（Node v24.19.0 で `EBADF` を確認）、同じ危険のある他の test の点検、3 file の vitest（192 tests passed）と `npm run typecheck`（exit 0）を確認した。
- round 1: blocking 0、non-blocking 1。「`fd` の代入（`openSync` の結果の取得）の前に assert が失敗すると、teardown が開いた fd を閉じられない」。対応: teardown を `open.mock.results[0]` の fd について、正常に戻った close が無い場合にだけ閉じる形にした（RootCause §1 の表も更新）。変更は teardown だけで、確認の内容は変えていない。
- 置き換えた確認（`close.mock.results` の `type: 'return'`）は、call-through の spy（`reference-source.test.ts:549`・`:646`・`:666`）で本物の `closeSync` が正常に戻ったことを示し、`fstat` による確認より弱くない。

blocking: 0
