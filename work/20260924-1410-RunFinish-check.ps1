param(
    [Parameter(Mandatory)][string]$AcceptanceFile,
    [Parameter(Mandatory)][string]$ExecutionId,
    [Parameter(Mandatory)][string]$StateDb
)
# 残タスク計画 §5「試行の終端の検査」: Acceptance file の acceptance_exit / accepted の各 1 行と ATG report の accepted=1/0 の一致を確かめる。
$text = Get-Content -LiteralPath $AcceptanceFile
$exitLines = @($text | Select-String -Pattern '^acceptance_exit: -?\d+$')
$acceptedLines = @($text | Select-String -Pattern '^accepted: (true|false)$')
if ($exitLines.Count -ne 1 -or $acceptedLines.Count -ne 1) {
    Write-Output "acceptance_exit lines=$($exitLines.Count) accepted lines=$($acceptedLines.Count) (each must be 1)"
    exit 1
}
$expected = if ($acceptedLines[0].Matches[0].Groups[1].Value -eq 'true') { 'accepted=1' } else { 'accepted=0' }
$env:PYTHONPATH = "$PWD\tools\atg\vendor"
$report = python -m atg report --execution-id $ExecutionId --state $StateDb
if ($LASTEXITCODE -ne 0) { Write-Output "ATG report exit=$LASTEXITCODE"; exit 1 }
$actual = if ($report -match 'accepted=1') { 'accepted=1' } elseif ($report -match 'accepted=0') { 'accepted=0' } else { 'none' }
if ($actual -ne $expected) { Write-Output "file=$expected report=$actual"; exit 1 }
Write-Output "ok $expected"
exit 0
