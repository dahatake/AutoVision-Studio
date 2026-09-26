$ErrorActionPreference = 'Stop'
# EXT-X1 (a)/(b) の DoD（work/20260924-1815-OwnerRulingExecutionPlan.md §3 X）
$raw = 'work\20260924-1815-EXT-X1-a.raw.log'
$rec = 'work\20260924-0730-EXT-X1-ExecutionRecord.md'
$starts = @(Select-String -Path $raw -Pattern '^run (\d+) start ')
if ($starts.Count -lt 1) { Write-Output 'no start line'; exit 1 }
if (@($starts | Where-Object { $_.Line -notmatch ' npm_version=12\.0\.0 ' }).Count) { Write-Output 'start without npm 12.0.0'; exit 1 }
$runLines = @(Select-String -Path $raw -Pattern '^run ')
$grammar = '^run [1-3] (start \S+ npm_version=\S+ node_processes=\d+|exit=\d+ end \S+|stopped reason=no-progress pid=\d+)$'
if (@($runLines | Where-Object { $_.Line -notmatch $grammar }).Count) { Write-Output 'run line outside start/exit/stopped grammar or run 1..3'; exit 1 }
$done = @(Select-String -Path $raw -Pattern '^run ([1-3]) exit=(\d+) end ')
# 行の順の event 列（回の番号 + s=start・p=stopped・x=exit）。回は 1→2→3 の順に並び、各回は
# 完了（sx）、停止後の再試行が完了（spsx）、再試行も停止（spsp。以降の回は無い）のどれか
$seq = ($runLines | ForEach-Object { $w = $_.Line.Split(' '); $w[1] + $(if ($w[2] -eq 'start') { 's' } elseif ($w[2] -eq 'stopped') { 'p' } else { 'x' }) }) -join ''
$R = { param($k) "(${k}s${k}x|${k}s${k}p${k}s${k}x)" }
$A = { param($k) "${k}s${k}p${k}s${k}p" }
if ($seq -notmatch "^($(& $R 1)$(& $R 2)($(& $R 3)|$(& $A 3))|$(& $R 1)$(& $A 2)|$(& $A 1))$") { Write-Output "run event order invalid: $seq"; exit 1 }
$failed = @($done | Where-Object { $_.Matches[0].Groups[2].Value -ne '0' })
$line = @(Select-String -Path $rec -Pattern '^\(a\) 完了した回: ([0-3])/3 再現: ([0-3])$')
if ($line.Count -ne 1) { Write-Output "(a) record lines=$($line.Count)"; exit 1 }
$n = [int]$line[0].Matches[0].Groups[1].Value
$m = [int]$line[0].Matches[0].Groups[2].Value
if ($n -ne $done.Count -or $m -ne $failed.Count) { Write-Output "record n=$n m=$m raw n=$($done.Count) m=$($failed.Count)"; exit 1 }
$bNo = @(Select-String -Path $rec -Pattern '^\(b\) 不実施: ').Count
$bYes = @(Select-String -Path $rec -Pattern '^\(b\) 実施: ').Count
if ($m -eq 0) {
    if ($bNo -ne 1 -or $bYes -ne 0) { Write-Output "(b) 不実施=$bNo 実施=$bYes (m=0)"; exit 1 }
} else {
    if ($bNo -ne 0 -or $bYes -ne 1) { Write-Output "(b) 不実施=$bNo 実施=$bYes (m>0)"; exit 1 }
    # 基準群は (a) の FAIL の file。全体は (b) の raw log の先頭の `files: all` の行（`vitest list --filesOnly` の出力。
    # (a) の raw log は非 TTY の既定 reporter のため失敗した file の行しか持たない。2026-09-24 19:06 の訂正）
    $aText = Get-Content $raw -Encoding utf8
    $base = @($aText | Select-String -Pattern '^ FAIL  (\S+\.test\.tsx?) ' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique)
    $b = 'work\20260924-1815-EXT-X1-b.raw.log'
    if (-not (Test-Path $b)) { Write-Output 'no (b) raw log'; exit 1 }
    $allLine = @(Select-String -Path $b -Pattern '^files: all (.+)$')
    if ($allLine.Count -ne 1) { Write-Output 'files: all must be 1 line'; exit 1 }
    $all = @($allLine[0].Matches[0].Groups[1].Value -split ' ' | Where-Object { $_ } | Sort-Object -Unique)
    if (@($base | Where-Object { $all -notcontains $_ }).Count) { Write-Output 'base not in files: all'; exit 1 }
    $rest = @($all | Where-Object { $base -notcontains $_ })
    $half = [math]::Ceiling($rest.Count / 2)
    $want = @{ first = @($rest | Select-Object -First $half); second = @($rest | Select-Object -Skip $half) }
    foreach ($g in 'first', 'second') {
        $fl = @(Select-String -Path $b -Pattern "^files: $g (.+)$")
        if ($fl.Count -ne 1) { Write-Output "files: $g must be 1 line"; exit 1 }
        $got = @($fl[0].Matches[0].Groups[1].Value -split ' ' | Where-Object { $_ })
        $expect = @($base + $want[$g])
        if ($base.Count -eq 0 -or $want[$g].Count -eq 0 -or (Compare-Object $got $expect) -or @($got | Sort-Object -Unique).Count -ne $got.Count) { Write-Output "files: $g does not match base + $g half"; exit 1 }
        foreach ($k in 1, 2) {
            $s = @(Select-String -Path $b -Pattern "^b-$g $k start .* npm_version=12\.0\.0( |$)").Count
            $e = @(Select-String -Path $b -Pattern "^b-$g $k exit=\d+ end ").Count
            if ($s -ne 1 -or $e -ne 1) { Write-Output "b-$g $k start=$s end=$e"; exit 1 }
        }
    }
}
Write-Output "ok completed=$n reproduced=$m"
exit 0