# Gate 2 main7（work/20260925-0745-Gate2Main7-Plan.md §4）の各ノードの verify_command。
# work/20260925-0420-Gate2Main4-verify.ps1 から G2A-01〜04・G2D-08 の分だけを複製した。差分は Review の path と、G2D-08 の判断記録の日付だけ。
# 使い方: pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File work/20260925-0745-Gate2Main7-verify.ps1 <node ID>
param([Parameter(Mandatory)][string]$Node)
$ErrorActionPreference = 'Stop'
$Ev = 'docs\model-governance\evidence'
$Sig = 'docs\model-governance\siglip-base-patch16-224-adoption.md'
$Owl = 'docs\model-governance\owlvit-base-patch32-adoption.md'
function Fail([int]$code = 1) { exit $code }
function Npm12 { $env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { Fail 2 } }
function Docs { Npm12; npm run verify:docs; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }
function Review([string]$id) { if (-not (Select-String -Path "work\20260925-0745-Gate2Main7-$id-Review.md" -Pattern '^blocking: 0$' -Quiet)) { Fail } }
function Ruling([string]$id, [string]$choice, [string]$file = $id) {
  $f = "$Ev\2026-09-25-owner-ruling-$file.md"
  if (-not (Test-Path $f)) { Fail }
  if (-not (Select-String -Path $f -Pattern "^選択: $choice$" -Quiet)) { Fail }
  $t = Get-Content $f -Raw -Encoding utf8
  if (-not $t.Contains('判断者') -or $t -cnotmatch '(?m)^> ') { Fail }
  Review $id; Docs
}
function Approval([string]$rec, [string]$name, [string]$path, [string]$sha, [string]$rev) {
  $t = Get-Content $rec -Raw -Encoding utf8
  $one = { param($p) $m = [regex]::Matches($t, $p); if ($m.Count -ne 1) { exit 1 }; $m[0] }
  [void](& $one '(?m)^\| 最終判定 \| \*\*承認\*\* \|\r?$')
  [void](& $one '(?m)^\| 承認者氏名 \| [^|\s][^|]* \|\r?$')
  [void](& $one '(?m)^\| 承認者の役割 \| [^|\s][^|]* \|\r?$')
  $d = (& $one '(?m)^\| 承認日 \| (\d{4}-\d{2}-\d{2}) \|\r?$').Groups[1].Value
  $dt = [datetime]::MinValue
  if (-not [datetime]::TryParseExact($d, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, 'None', [ref]$dt) -or $dt -gt (Get-Date).Date) { Fail }
  $a = & $one '(?m)^\| 承認対象 artifact \| `([^`]+)` SHA-256 `([0-9a-f]{64})` \|\r?$'
  $r = (& $one '(?m)^\| 承認対象 revision \| `([0-9a-f]{40})` \|\r?$').Groups[1].Value
  if ($a.Groups[1].Value -ne $name -or $a.Groups[2].Value -ne $sha -or $r -ne $rev -or (Get-FileHash $path).Hash.ToLower() -ne $sha) { Fail }
}
switch -CaseSensitive ($Node) {
  'G2A-01' { Approval $Sig 'model.safetensors' 'vendor\models\_spike\siglip\model.safetensors' '2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8' '7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed'; Review 'G2A-01'; Docs }
  'G2A-02' { Approval $Owl 'model.safetensors' 'vendor\models\_spike\owlvit-b32\model.safetensors' '4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b' 'cbc355fb364588351c5d51c7f74465e8e7ec6f72'; Review 'G2A-02'; Docs }
  'G2A-03' { Npm12; node --test scripts/models/manifest-schema.test.mjs; if ($LASTEXITCODE) { Fail $LASTEXITCODE }; Review 'G2A-03' }
  'G2A-04' { Npm12; & .\node_modules\.bin\vitest.cmd run src/renderer/features/settings/SettingsPage.test.tsx; if ($LASTEXITCODE) { Fail $LASTEXITCODE }; Review 'G2A-04' }
  'G2D-08' { Ruling 'G2D-08' '\d+\.\d+\.\d+' }
  default { Fail 3 }
}
exit 0
