# SPI-19 macOS — Reference 永続アクセス実測

## 判定

**NOT_RUN**

実測日: 未実施

## blocker

native Apple Silicon arm64 Mac（要求対象: macOS 13 以降）をこの作業環境で利用できない。`CONTRIBUTING.md` §7 に従い、Windows 上の結果、Node の cross-platform API、またはコードレビューから macOS の挙動を推定して合格扱いにしない。

次の native 実測が未完了である。

1. 明示選択した絶対 source path と macOS 上の永続 identity/size/mtime/SHA-256 の manifest 保存。
2. manifest 保存 process 終了後の別 process 検証。
3. manifest を保持した **実機 OS reboot 後**の read/hash/identity 検証。
4. 変更・消失の検出と fail-closed 動作。
5. hash 不一致候補の拒否、および正しい候補への明示 relink。
6. 各 read-only ケース前後の source 存在・内容・hash・mtime 不変性。
7. direct-distribution の non-sandbox app 前提が実際の配布形態でも成立すること。

macOS では command、build、fixture 操作を一切実行していない。実測値および推定結果はない。

## SPI-19 全体状態

**PARTIAL** — Windows の別 process lifecycle は実測済みだが、Windows OS reboot と macOS native lane が未実施。D-19 と Gate 1 は未確定のままとする。
