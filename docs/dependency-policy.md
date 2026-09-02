# AutoVision Studio — 依存関係・ライセンスポリシー

| 項目 | 内容 |
|---|---|
| 文書バージョン | 0.1 Draft |
| 作成日 | 2026-09-02 |
| 根拠要求 | FR-LIC-001〜008、FR-LIC-010〜015、FR-SEC-002〜004、NFR-SEC-001/003、NFR-MNT-001（FR-LIC-009 のUI・記録は DAT-13 が担当） |
| 対象タスク | A-05（`docs/implementation-plan.md` §Phase A） |
| 要求基準 SHA-256 | `2f1c57da192710ffb2fd764c7e342cf2e9106fa7387be7393133873cc815052f` |

> **免責**: 本文書は技術・運用ポリシーであり、法的助言ではない（`docs/requirement-definition.md` §20 参照）。  
> ライセンス判断は実際の採用バージョンが確定した時点で法務レビューを別途実施する。

---

## 1. 目的と適用範囲

本文書は、AutoVision Studio に同梱または参照するすべての部品について、許可・禁止基準、審査・記録手順、ビルドゲートを定める。

**対象カテゴリー（カテゴリーは独立した基準で判定する）**

| カテゴリー | 例 |
|---|---|
| **C1 — TypeScript/Node パッケージ** | npm registry のランタイム・devDependency |
| **C2 — Python パッケージ** | PyPI、uv 管理のランタイム・dev 依存 |
| **C3 — ネイティブバイナリ** | `.dll`、`.dylib`、`.so`、`.node` アドオン |
| **C4 — CUDA / cuDNN** | NVIDIA SDK redistributable（採用時のみ） |
| **C5 — モデル構造コード** | アーキテクチャ定義コード（PyTorch モジュール等） |
| **C6 — Curated Base Weight** | 基盤モデルの学習済み checkpoint（`.safetensors`、`.onnx`） |
| **C7 — Annotation Assist Model checkpoint** | 補助 AI の checkpoint（同梱時のみ） |
| **C8 — 学習元データ** | 重みを生成したデータセット（配布しないが由来を記録） |
| **C9 — フォント・アイコン・その他** | 同梱するアセット類 |

FR-LIC-001 に基づき、すべてのカテゴリーにわたり、名称・バージョン・ライセンス・再配布条件を部品ごとに記録しなければならない。

---

## 2. 許可ライセンスの原則

**FR-LIC-002** により、次のライセンスを原則許可する。

| ライセンス識別子 | 条件 |
|---|---|
| MIT | NOTICE/著作権表示を `THIRD_PARTY_NOTICES` に含める |
| BSD-2-Clause | 同上 |
| BSD-3-Clause | 同上（"Endorsed by" 禁止条項への準拠を確認） |
| Apache-2.0 | NOTICE ファイルがある場合はそれを伝播する。特許免除条項の有無を確認する |
| PSF-2.0 | Python 本体と同梱モジュールの NOTICE を保持する（[S26]） |
| Public Domain | SQLite 等、法域依存の Warranty of Title を任意検討する（[S28]） |
| 明示契約 | 商用利用・再配布・改変を明示的に許可し、法務が個別承認した契約 |

> 「許可ライセンスに一致する」は SPDX 識別子の照合だけを意味しない。NOTICE、帰属表示、特許条項、改変条件の遵守を確認して初めて「許可」となる。

**許可ライセンスの transitive 依存への適用**

直接依存が許可ライセンスでも、transitive 依存が禁止カテゴリーに該当すれば同梱不可となる。SBOM 生成（§7）で全 transitive 依存を検査する。

---

## 3. 禁止カテゴリーと fail-closed 規則

**FR-LIC-003** に基づき、次を **fail-closed** とする。すなわち、SBOM 検査で以下に分類された部品が検出された場合、ビルドをリリース不可状態（エラー終了）にする。

| 分類 | 例 | 解除条件 |
|---|---|---|
| Copyleft または置換・再リンク等の追加義務を持つライセンス | GPL-2.0-only、GPL-3.0-or-later、AGPL-3.0、LGPL 系 | 法務がリンク形態、再リンク可能性、通知、ソース提供等を確認し、製品全体の配布条件との適合を**個別に書面で承認**した場合のみ。LGPL の動的リンクを自動的に不適合とは判定しない |
| 研究限定 | "for research purposes only"、"academic use only" | 同上 |
| 非商用限定 | CC-BY-NC 系、"non-commercial use" | 同上 |
| 用途制限付き | "not for military use"、"not for clinical use" など特定用途禁止 | 同上 |
| **unknown** | SPDX が `NOASSERTION` または空欄 | **解除なし — unknown は常にリリース失敗** |

> `unknown` を承認で上書きする手段は存在しない。ライセンスが確認できない部品は含めない（FR-LIC-010）。

---

## 4. コード / checkpoint / 学習データの分離審査

FR-LIC-005 および FR-LIC-015 に基づき、**3 つのレイヤーを独立して審査する**。  
あるレイヤーが許可されても、他のレイヤーの審査結果を変えない。

```
┌──────────────┐  ┌──────────────────────┐  ┌────────────────────────────┐
│ C5 コード     │  │ C6/C7 checkpoint      │  │ C8 学習元データ            │
│ アーキテクチャ│  │ 重みファイル自体の    │  │ データセット terms、        │
│ 定義コードの  │  │ ライセンス・          │  │ 画像著作権、               │
│ ライセンス    │  │ 再配布条件            │  │ annotation 条件            │
└──────────────┘  └──────────────────────┘  └────────────────────────────┘
   ↑承認しても          ↑承認しても                ↑承認しても
   C6/C7を承認しない    C8の不適合を                他のレイヤーを
                        解消しない                   承認しない
```

**具体的な禁止・要確認事例（FR-LIC-005〜008/015 より）**

- TorchVision コードが BSD-3-Clause でも、`DEFAULT` weight は学習データ由来の別条件が存在し得る（[S14]）。コードライセンスだけで weight を承認しない。
- ImageNet 配布データは non-commercial research/educational purposes 限定のため（[S19]）、ImageNet 由来 weight を商用可と自動判定しない。
- COCO annotations は CC BY 4.0 だが画像著作権は個別条件に従うため（[S18]）、COCO 由来 weight も由来確認なしに承認しない。
- Open Images 由来 weight は、annotations の CC BY 4.0、表示上 CC BY 2.0 とされる画像の個別条件、帰属表示を証拠記録で確認できない限り同梱しない（FR-LIC-008、[S20]）。
- OpenAI CLIP は code が MIT でも model card が deployed use を out-of-scope とするため（[S46][S47]）、既定の Annotation Assist Model から除外する（FR-LIC-015）。

---

## 5. lock ファイルと再現性

**NFR-MNT-001 / FR-LIC-010** により、OS・アーキテクチャごとに exact lock を保持し、再現可能なビルドを行う。

### 5.1 TypeScript / Node（C1）

- `package-lock.json` を Git で管理する（`.gitignore` で除外しない）。
- `npm ci` を使用し、`npm install` を CI・リリースビルドで使用しない。
- lock の変更は必ず diff レビューを経る（§9.1）。
- `package-lock.json` に `resolved`・`integrity` フィールドが欠落した場合はビルドを失敗させる。

### 5.2 Python（C2）

- `uv.lock` を Git で管理する（`ml/uv.lock`）。
- `uv lock --check` で metadata と lock の整合を確認した後、`uv sync --locked` を使用し、stale/lockなしインストールを禁止する（[P11]）。
- OS・Python バージョンごとのプラットフォームマーカーが lock に含まれることを確認する。
- wheel が存在しない sdist 専用パッケージは、`uv.lock` に含まれた時点でライセンスと使用実績を別途確認する。

### 5.3 ネイティブバイナリ（C3）

- `better-sqlite3` 等の native addon は、ビルド済みバイナリのハッシュを manifest に記録する。
- CI ビルドの成果物ハッシュが manifest と一致しなければリリースを失敗させる。
- ハッシュ照合は完全性検証であり脆弱性検査の代替ではない。native component の名称・版を SBOM へ関連付け、SEC-08 で採用する advisory source と照合する。

---

## 6. 承認証拠の記録要件

### 6.1 Curated Base Weight（C6）— FR-LIC-004 準拠

各 weight ごとに次を `docs/model-governance/` 配下の採用記録ファイルに記録する。

| 項目 | 必須 |
|---|---|
| 名称・版 | ✓ |
| 取得 URL | ✓ |
| SHA-256（weight ファイル） | ✓ |
| 重みライセンス（SPDX または URL） | ✓ |
| 学習データ由来（dataset 名・出典） | ✓ |
| dataset terms URL と取得日 | ✓ |
| 再配布条件 | ✓ |
| NOTICE 内容 | ✓ |
| 判断根拠一次資料 URL + 保存 hash | ✓ |
| 承認者氏名 | ✓ |
| 承認日 | ✓ |

- 上記のいずれかが **unknown** の場合は同梱しない（fail-closed）。
- `docs/model-governance/adoption-template.md`（A-06 成果物）を証拠記録の統一フォームとして使用する。

### 6.2 Annotation Assist Model checkpoint（C7）— FR-LIC-014 準拠

C6 の全項目に加え、次を追加記録する。

| 追加項目 | 必須 |
|---|---|
| model card の intended use / out-of-scope use | ✓ |
| 全公開学習 dataset と各 terms（複数ある場合は全列挙） | ✓ |

- コードと checkpoint を独立してそれぞれ判定する。
- intended/out-of-scope use、研究限定、非商用、製品用途対象外のいずれかが unknown または不適合なら **同梱しない**。
- 現時点で商用製品への同梱を最終承認した Annotation Assist Model は **ない**（`docs/requirement-definition.md` §13.3）。本文書は既存 Model の承認を意味せず、将来の審査通過によってのみ承認が成立する。

---

## 7. SBOM と THIRD_PARTY_NOTICES

**FR-LIC-010 / FR-LIC-012** に基づき、ビルドごとに次を生成する。

| 成果物 | 生成スクリプト（A-05 以降のタスク LIC-01 で実装） | 用途 |
|---|---|---|
| SBOM（SPDX または CycloneDX 形式） | `scripts/licenses/generate.mjs`（C1/C3）、`scripts/licenses/verify.py`（C2/C6/C7） | 全 transitive 依存の追跡 |
| `THIRD_PARTY_NOTICES` | 同上から生成 | アプリ内表示（FR-LIC-012）・配布添付 |
| license report（テキスト／CSV） | 同上 | レビューと保管 |

**fail-closed 条件**: 禁止ライセンス（§3）または `unknown` が SBOM に含まれる場合、スクリプトは非ゼロ終了コードを返し、リリースパイプラインを停止する。

- 配布SBOMと `THIRD_PARTY_NOTICES` は最終payloadに含まれる production dependency を対象とする。
- devDependency は脆弱性・ライセンス監査の対象に含めるが、最終payloadに含まれないことを確認できたものは配布SBOM/通知へ混在させない。
- C9 のフォント・アイコン・asset は名称、版または取得revision、ライセンス、SHA-256をasset manifestへ記録し、配布SBOMと通知へ含める。

---

## 8. ネイティブバイナリと CUDA / cuDNN

**FR-LIC-013** に基づき、CUDA / cuDNN の同梱は次の条件を全て満たす場合のみ許可する。

1. 採用バージョンの NVIDIA CUDA Toolkit EULA（[S30]）と、使用する GPU 機能に対応する supplement を法務が書面承認している。
2. CUDA は EULA Attachment A の `CUDA Redistributables` リストに明示された `.dll` / `.so` のみを同梱する。未列挙の開発ツール、ヘッダー、pre-release SDK は含めない。
3. cuDNN は cuDNN Software License Agreement（[S31]）で許可された runtime `.dll` / `.so` のみを同梱する。
4. 採用バージョン・同梱ファイル一覧・EULA hash・承認者・承認日を `docs/model-governance/cuda-redistribution.md`（LIC-03 成果物）に記録している。
5. `scripts/licenses/verify-cuda-payload.py` による allowlist 照合が成功している。

CUDA を同梱しない場合は、その決定と CPU fallback の保証を上記ファイルに記録する。

その他の `.dll` / `.dylib` / `.so` および `.node` native addon は、C3 として SBOM に含め、許可ライセンス（§2）または法務個別承認（§3）を経なければ同梱できない。

---

## 9. ランタイム・ビルド時のネットワーク境界

**FR-SEC-002/003 / FR-LIC-011** に基づく。

### 9.1 ランタイム（製品動作中）

- **外向きネットワーク通信は deny-by-default** とする。
- モデル、コード、Execution Provider、フォント、アイコン、外部 CDN コンテンツの実行時ダウンロードは禁止する。
- オフライン環境での全主要フローの完了と通信キャプチャでの外向き通信 0 件を、毎リリースの POC-06 ゲートで確認する。
- Electron の CSP を `default-src 'self'` 基準に設定し、リモートコンテンツ読み込みを防止する（FR-SEC-004 / [S8]）。

### 9.2 ビルド時

- `npm ci` および `uv sync --locked` は lock ファイルに基づき package を取得する。これはビルドマシンのネットワーク接続を前提とするが、**取得先は lock ファイルに記録・承認された source のみ**とする。
- lock ファイルに存在しない URL への接続、または lock の integrity と一致しないパッケージのインストールをエラーとする。
- 自動更新ツール（Dependabot 等）が提案した変更は、§10 の依存追加・更新手順を経てレビューされるまで適用しない。
- macOS notarization は採用済みデフォルト D-11 の配布工程例外として、承認済み製品payloadを含む最終PKGを Apple notary service へ送信する。ユーザー画像・ラベル・Project・ユーザー学習済みモデル・学習結果は提出物に含めない。それ以外の build 時外部通信はログに記録し、意図しない通信は異常として扱う。

---

## 10. 依存関係の追加・更新・削除ワークフロー

### 10.1 追加（新規導入）

1. **必要性の明文化**: 既存依存またはネイティブ実装では代替できない理由を Issue または PR 本文に記載する。
2. **ライセンス事前確認**:
   - C1/C2: 許可ライセンス（§2）であることを SPDX 識別子で確認する。
   - C6/C7: §6 の証拠記録を完成させてから PR を開く。
3. **脆弱性初期確認**: `npm audit` / `uv run pip-audit` で Critical/High がないことを確認する。
4. **transitive 依存確認**: 追加後に SBOM を再生成し、新たに追加された transitive 依存の全ライセンスを確認する。
5. **lock ファイル更新と diff レビュー**: `package-lock.json` または `uv.lock` の diff を PR レビュアーが確認する。
6. **レビュー承認**: 少なくとも 1 名の承認を得てからマージする。

### 10.2 更新（バージョン変更）

1. **変更理由の記録**: セキュリティ修正、機能追加、互換性のいずれかを明記する。
2. **CHANGELOG / リリースノート確認**: ライセンス変更、動作変更、新たな transitive 依存の有無を確認する。
3. **ライセンス再確認**: 更新後のバージョンでライセンスが変わっていないことを確認する。特に major バージョンアップでは必須。
4. **脆弱性確認**: §11 と同じスキャンを実行する。
5. **lock ファイル更新とテスト実行**。
6. **レビュー承認**: §10.1 と同様。

### 10.3 削除

1. **使用箇所ゼロの確認**: コード・テスト・スクリプト全体を検索し、参照がないことを確認する。
2. **lock ファイル更新と SBOM 再生成**: 削除後に transitive 依存が残存しないことを確認する。
3. **THIRD_PARTY_NOTICES の更新**: 削除部品の通知を除去する。
4. **レビュー承認**。

---

## 11. 脆弱性スキャンとリリースゲート

**NFR-SEC-003** に基づき、リリースごとに次を実行する。

| スキャン対象 | ツール | 設定スクリプト（SEC-08 成果物） |
|---|---|---|
| C1（npm） | `npm audit --audit-level=high`（Moderate は記録するが release gate は High 以上） | `scripts/security/audit-dependencies.mjs` |
| C2（uv） | `uv run pip-audit` | `scripts/security/audit-python.py` |
| C3（native） | SBOM の component 名・版を採用済み advisory source と照合し、別途 PE/dylib hash を manifest と照合 | 同上 |

**ゲートルール**

- **Critical / High** の未承認脆弱性が 1 件でも存在する場合、リリースを失敗させる。
- 例外（承認済み脆弱性）は次を `docs/security-vulnerability-policy.md`（SEC-08 成果物）に記録する: CVE ID、影響バージョン、根拠、代替策、期限、責任者。
- 期限を超えた例外は自動的に無効化しリリースを失敗させる。

---

## 12. リリースゲートのまとめ

次の全条件を満たさなければリリースを失敗させる（FR-LIC-010 / NFR-INS-007）。

| ゲート | 合格条件 |
|---|---|
| G-DEP-01 | C1/C2 lock ファイルが最新で integrity が一致する |
| G-DEP-02 | SBOM に禁止ライセンスおよび `unknown` が存在しない |
| G-DEP-03 | `THIRD_PARTY_NOTICES` が SBOM と整合する |
| G-DEP-04 | Critical/High 未承認脆弱性がゼロ |
| G-DEP-05 | C3 native バイナリが manifest hash と一致する |
| G-DEP-06 | C4 CUDA/cuDNN（採用時）が allowlist と一致し、法務承認記録が存在する |
| G-DEP-07 | C6 各 weight の証拠記録（§6.1 全項目）が完備し、unknown がない |
| G-DEP-08 | C7 各 checkpoint の証拠記録（§6.2 全項目）が完備し、unknown がない。現時点で合格済みの C7 はない |
| G-DEP-09 | オフライン通信キャプチャで外向き通信が 0 件（POC-06） |

G-DEP-02 および G-DEP-07/08 の `unknown` は承認で上書きできない。

---

## 13. 参照ドキュメント

| 参照 | 内容 |
|---|---|
| `docs/requirement-definition.md` §8.8 | FR-LIC-001〜015（本文書のすべての根拠要求） |
| `docs/requirement-definition.md` §11.3 | NFR-SEC-001/003 |
| `docs/requirement-definition.md` §11.5 | NFR-MNT-001 |
| `docs/requirement-definition.md` §13.1 | 採用候補部品一覧（最終承認ではない）|
| `docs/requirement-definition.md` §13.3 | Annotation Assist Model 評価（現時点で承認済みなし） |
| `docs/requirement-definition.md` §19.3 | [S14][S18][S19][S20][S26][S28][S30][S31]（一次資料） |
| `docs/model-governance/adoption-template.md` | A-06 成果物：証拠記録フォーム |
| `docs/model-governance/cuda-redistribution.md` | LIC-03 成果物：CUDA/cuDNN allowlist |
| `docs/security-vulnerability-policy.md` | SEC-08 成果物：脆弱性例外記録 |
| `scripts/licenses/generate.mjs` | LIC-01 成果物：SBOM/NOTICES 生成 |
| `scripts/security/audit-dependencies.mjs` | SEC-08 成果物：脆弱性ゲート |
