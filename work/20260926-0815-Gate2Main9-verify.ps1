param([Parameter(Mandatory = $true)][string]$Node)
# Gate 2 main9 の各 node の完了条件（計画: work/20260926-0815-OwnerRulings5-ExecutionPlan.md §3）
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH
function Need([bool]$ok, [string]$what) { if (-not $ok) { Write-Output "FAIL: $what"; exit 1 } }
function Reviewed([string]$path) { Need ((Test-Path $path) -and (Select-String -Path $path -Pattern '^blocking: 0$' -Quiet)) "review $path blocking: 0" }
$rulings = 'docs\model-governance\evidence\2026-09-26-owner-rulings.md'
$owl = 'docs\model-governance\owlvit-base-patch32-adoption.md'
$sig = 'docs\model-governance\siglip-base-patch16-224-adoption.md'
switch -Regex ($Node) {
  '^G2Q-0[456][CD]$' {
    Need (Select-String -Path $rulings -SimpleMatch '/実施対象から削除して、完了扱いにしてください。' -Quiet) 'ruling answer line'
    foreach ($rec in $sig, $owl) { Need (Select-String -Path $rec -SimpleMatch '**免除（所有者の判断。未実施）。**' -Quiet) "$rec §12 waiver" }
    $m = Get-Content resources\models\manifest.json -Raw | ConvertFrom-Json
    Need ($null -eq $m.releaseStatus.assistQuality) 'assistQuality must stay absent'
    Reviewed 'work\20260926-0815-Q1-Review.md'
  }
  '^G2A-02$' {
    $t = Get-Content $owl -Raw
    $one = { param($p) $x = [regex]::Matches($t, $p); if ($x.Count -ne 1) { $null } else { $x[0] } }
    foreach ($p in '(?m)^\| 最終判定 \| \*\*承認\*\* \|\r?$', '(?m)^\| 承認者氏名 \| [^|\s][^|]* \|\r?$', '(?m)^\| 承認者の役割 \| [^|\s][^|]* \|\r?$') { Need ($null -ne (& $one $p)) $p }
    $d = (& $one '(?m)^\| 承認日 \| (\d{4}-\d{2}-\d{2}) \|\r?$').Groups[1].Value
    $dt = [datetime]::MinValue
    Need ([datetime]::TryParseExact($d, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, 'None', [ref]$dt) -and $dt -le (Get-Date).Date) 'approval date'
    $a = & $one '(?m)^\| 承認対象 artifact \| `([^`]+)` SHA-256 `([0-9a-f]{64})` \|\r?$'
    $r = (& $one '(?m)^\| 承認対象 revision \| `([0-9a-f]{40})` \|\r?$').Groups[1].Value
    $sha = '4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b'
    Need ($a.Groups[1].Value -eq 'model.safetensors' -and $a.Groups[2].Value -eq $sha -and $r -eq 'cbc355fb364588351c5d51c7f74465e8e7ec6f72') 'artifact and revision'
    Need ((Get-FileHash 'vendor\models\_spike\owlvit-b32\model.safetensors').Hash.ToLower() -eq $sha) 'local artifact SHA-256'
    npm run -s verify:docs | Out-Null; Need ($LASTEXITCODE -eq 0) 'verify:docs'
    Reviewed 'work\20260926-0815-A2-Review.md'
  }
  '^G2A-03$' {
    $m = Get-Content resources\models\manifest.json -Raw | ConvertFrom-Json
    Need (@($m.models | Where-Object { $_.id -eq 'owlvit-base-patch32' }).Count -eq 1) 'OWL-ViT entry'
    node --test scripts/models/manifest-schema.test.mjs | Out-Null; Need ($LASTEXITCODE -eq 0) 'manifest test'
    Reviewed 'work\20260926-0815-A3-Review.md'
  }
  '^G2A-04$' {
    & .\node_modules\.bin\vitest.cmd run src/renderer/features/settings/SettingsPage.test.tsx | Out-Null; Need ($LASTEXITCODE -eq 0) 'SettingsPage test'
    Reviewed 'work\20260926-0815-A4-Review.md'
  }
  default { Write-Output "unknown node $Node"; exit 2 }
}
Write-Output "OK: $Node"
exit 0
