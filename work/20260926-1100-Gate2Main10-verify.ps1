param([Parameter(Mandatory = $true)][string]$Node)
# Gate 2 main10 の各 node の完了条件（計画: work/20260926-0955-OwnerRulings6-ExecutionPlan.md、Gate 2 計画 §8.19〜§8.22）
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH
function Need([bool]$ok, [string]$what) { if (-not $ok) { Write-Output "FAIL: $what"; exit 1 } }
function Ok([string]$cmd) { Invoke-Expression "$cmd *> `$null"; return ($LASTEXITCODE -eq 0) }
$review = 'work\20260926-1100-Gate2Final-Review.md'
Need ((npm --version) -eq '12.0.0') 'npm 12.0.0'
$pkg = (Get-Content package.json -Raw | ConvertFrom-Json).version
$m = Get-Content resources\models\manifest.json -Raw | ConvertFrom-Json
function Common {
  Need (Ok 'npm run -s verify:docs') 'verify:docs'; Need (Ok 'npm run -s test:docs') 'test:docs'
  Need (Ok 'npm run -s verify:version') 'verify:version'; Need (Ok 'npm run -s test:version') 'test:version'
  Need (Ok 'git --no-pager diff --check') 'git diff --check'
}
switch ($Node) {
  'G2V-01' {
    Need ($pkg -eq '0.1.12') 'package.json 0.1.12 (G2D-08)'
    Need (Ok 'npm run -s verify:version') 'verify:version'; Need (Ok 'npm run -s test:version') 'test:version'
    Need (@(git tag).Count -eq 0) 'no git tag created'
    Need (Select-String -Path work\20260926-1055-G2V01-checks.raw.log -Pattern '^typecheck exit 0$' -Quiet) 'typecheck exit 0'
    Need (Select-String -Path work\20260926-1055-G2V01-checks.raw.log -Pattern '^build exit 0 ' -Quiet) 'build exit 0'
    Need (Select-String -Path work\20260926-1055-G2V01-npmtest-retry.raw.log -Pattern '^npm test exit 0 ' -Quiet) 'npm test exit 0'
    Need (Select-String -Path work\20260924-1815-GAL-V1-VersionDecision.md -Pattern '^version: 0\.1\.11$' -Quiet) 'GAL-V1 0.1.11 first'
  }
  'G2F-00' {
    $ctx = Get-Content work\20260926-1100-Gate2Main10-atg-state\main.sqlite3.context.json -Raw | ConvertFrom-Json
    Need ($ctx.execution_id -match '^[0-9a-f-]{36}$') 'main10 execution ID from the state context'
    python work\20260926-1100-merge-atg-report.py work/20260926-1100-Gate2Main10-atg-state/main.sqlite3 $ctx.execution_id | Out-Null
    Need ($LASTEXITCODE -eq 0) 'merge report'
    $check = [regex]::Match((Get-Content work\202609232120-Gate2-NodeInventory.md -Raw), '(?s)## 2\..*?```powershell\r?\n(.*?)```').Groups[1].Value
    $check = $check.Replace('<file>', 'work\20260926-1100-Gate2-TerminalState.md').Replace('<report>', 'work\20260926-1100-Gate2-AtgReport.md')
    $f = Join-Path $env:TEMP 'g2f00-check.ps1'; Set-Content $f $check -Encoding utf8
    pwsh -NoLogo -NoProfile -File $f; $e = $LASTEXITCODE; Remove-Item $f
    Need ($e -eq 0) 'inventory check (node inventory §2)'
  }
  'G2F-01m' {
    Need (Ok 'node --test scripts/models/manifest-schema.test.mjs') 'MANIFEST'
    Need ($m.releaseStatus.ready -eq $true -and $m.productVersion -eq $pkg) 'ready=true and productVersion = root version'
  }
  'G2F-01a1' { Need (Select-String -Path docs\adr\0004-spike-decisions.md -SimpleMatch 'Gate 2終端化追補6' -Quiet) 'ADR addendum 6'; Common }
  'G2F-01a2' { Need (Select-String -Path docs\implementation-plan.md -SimpleMatch '`releaseStatus.ready: true`' -Quiet) 'implementation-plan Gate 2 line'; Common }
  'G2F-01a3' {
    $rec = 'work\20260926-1100-Gate2-RemainTaskExecution.md'
    Need ((Select-String -Path $rec -SimpleMatch "承認件数: $($m.models.Count)" -Quiet) -and (Select-String -Path $rec -SimpleMatch "ready: $($m.releaseStatus.ready.ToString().ToLower())" -Quiet)) 'execution record lines'
    Common
  }
  'G2F-03' { Need ((Select-String -Path CHANGELOG.md -SimpleMatch 'G2V-01' -Quiet) -and (Select-String -Path CHANGELOG.md -SimpleMatch '`0.1.12`' -Quiet)) 'CHANGELOG'; Need (Ok 'npm run -s verify:docs') 'verify:docs' }
  default { Write-Output "unknown node $Node"; exit 2 }
}
Need ((Test-Path $review) -and (Select-String -Path $review -Pattern '^blocking: 0$' -Quiet)) "review $review"
Write-Output "OK: $Node"; exit 0
