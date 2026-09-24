# Owner ruling G2D-11 — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答と、それに基づく用意の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 05:56 JST。G2D-09 と同じ回答） |
| 記録者 | 実装担当（session `c1997536-bb53-4fae-8696-6838c192fa9a`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §5 の G2D-11「検証に使う npm の用意（S11）」 |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft、[`CONTRIBUTING.md`](../../../CONTRIBUTING.md) §8 |

## 回答の原文

実装担当が、未完了の原因を A（npm 12.0.0 の不在）、B（所有者判断 G2D-09 の不在）、C（利用者本人の操作）、D（Gate 2 未通過）に分けて提示した後の、権限者の回答（該当行をそのまま転記）:

> A: インストールしてください。

## 判断

npm `12.0.0` を導入する（権限者の指示）。実装担当が次のとおり導入し、版を確認した。ただし、権限者の回答は導入の指示であり、下表の導入方法（`--prefix` の場所と取得元の registry）を CONTRIBUTING §8 の「組織承認済みの方法」として選んだり承認したりしたものではない。このため、G2D-11 の成功条件（Gate 2 計画 §8.1「用意の完了」）は**成立していない**。

| 項目 | 値 |
|---|---|
| 導入先 | `%LOCALAPPDATA%\npm-12.0.0`（repository の外。CONTRIBUTING §8「環境固有の cache path はリポジトリへ固定しない」） |
| 導入コマンド | `npm install --global --prefix "$env:LOCALAPPDATA\npm-12.0.0" npm@12.0.0` |
| 取得元 | この端末の npm 設定の registry（`npm config get registry` = `https://packagefeedproxy.microsoft.io/npm/`）。`npm view npm@12.0.0 dist.tarball` = `https://ms-feed-25.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry/npm/-/npm-12.0.0.tgz`、`dist.shasum` = `867836fd333dbd272da3705a7c2b32908cbd90c6`（2026-09-24 に再照会、exit 0） |
| PATH | 恒久的には変更しない。npm を使う各コマンドの先頭で `$env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH` を行う（CONTRIBUTING §8「その `bin` directory を PATH の先頭へ置く」） |
| 確認 | 上記の PATH で `npm --version` = `12.0.0`、`(Get-Command npm).Source` = `C:\Users\dahatake\AppData\Local\npm-12.0.0\npm.ps1` |

## 根拠

| 根拠 | 内容 |
|---|---|
| CONTRIBUTING §8（137〜138 行） | npm は exact `12.0.0` を使う。組織承認済みの方法で用意し、その `bin` directory を PATH の先頭へ置く |
| 要求定義 | npm の版は要求定義の要件ではなく、開発手順（CONTRIBUTING）の規定である。要求定義の要件を変更・緩和する判断ではない |

## 本判断が意味しないこと

1. 取得元の registry が組織の方針に適合することを示すものではない。導入は権限者の指示と、この端末に設定済みの registry に基づく。方法の承認を得た場合は、新しい日付の判断記録を追加する。
2. system の npm（11.17.0）を置き換えない。PATH の恒久的な変更、`npx` / `npm exec` による取得は行わない。
3. 製品の依存・lock を変更しない。
4. ほかの所有者判断（G2D-01、02、04〜08、10、12）を含まない。

選択: 未確定（npm 12.0.0 は導入済み。導入方法が組織承認済みであることは未確認）

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
