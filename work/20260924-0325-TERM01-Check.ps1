# TERM-01 の完了条件の検査（202609232400 計画 §14）
# node ID と §5 の 15 事項が許可した状態と空でない理由で 1 回ずつあり、running がなく、
# Gate 2 の終端化の記録（work/<yyyymmdd-hhmm>-Gate2-TerminalState.md）への参照がちょうど 1 件で、その file が存在すること
$f = 'work/20260924-0325-RemainTaskTerminalState.md'
$ids = @('PRE-00','PRE-01','PRE-02','PRE-03','PRE-03A','PRE-04','MAN-01','MAN-02','MAN-03','MAN-04','MAN-05','AUD-01','AUD-02','GAL-01','GAL-02','TBD09-D','POST-01','POST-02','POST-03','POST-04') + @(1..15 | ForEach-Object { "§5-$_" })
$lines = Get-Content $f -Encoding utf8
foreach ($id in $ids) {
  $hit = @($lines | Where-Object { $_ -cmatch "^\| $([regex]::Escape($id))( [^|]*)? \| (done|failed|not-started) \| *[^|\s][^|]* \|$" })
  if ($hit.Count -ne 1) { Write-Output "NG: $id ($($hit.Count))"; exit 1 }
}
if (@($lines | Where-Object { $_ -cmatch '^\|[^|]+\| running \|' }).Count) { Write-Output 'NG: running'; exit 1 }
Write-Output "OK: $($ids.Count) 件（node ID・事項）"
$refs = @([regex]::Matches(($lines -join "`n"), '\b\d{8}-\d{4}-Gate2-TerminalState\.md\b') | ForEach-Object Value | Sort-Object -Unique)
if ($refs.Count -ne 1) { Write-Output "NG: Gate 2 の終端化の記録（*-Gate2-TerminalState.md）への参照が $($refs.Count) 件"; exit 1 }
if (-not (Test-Path "work/$($refs[0])")) { Write-Output "NG: work/$($refs[0]) がない"; exit 1 }
Write-Output "OK: Gate 2 の終端化の記録 work/$($refs[0])"
exit 0
