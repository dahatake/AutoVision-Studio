$ids = 'G2D-01','G2D-01T','G2D-02','G2D-02R','G2D-04','G2D-05','G2D-06','G2D-07C','G2D-07D','G2D-08','G2D-10','G2D-11','G2D-12','G2D-12T','EXT-41','EXT-X1','G2T-10','G2T-11','G2T-40','G2T-50C','G2T-50D','G2T-60C','G2T-60D','G2X-01a','G2X-01b','G2X-01c','G2Q-01C','G2Q-01D','G2Q-01CM','G2Q-01DM','G2Q-02','G2Q-03C','G2Q-03D','G2Q-04C','G2Q-04D','G2Q-05C','G2Q-05D','G2Q-06C','G2Q-06D','G2A-01','G2A-02','G2A-03','G2A-04','G2V-01'
if (@($ids | Select-Object -Unique).Count -ne 44) { exit 3 }
$t = Get-Content work/20260924-1425-Gate2-TerminalState.md -Raw
$rows = [regex]::Matches($t, '(?m)^\| ([A-Za-z0-9-]+) \| ([a-z-]+) \|')
$state = [System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
foreach ($r in $rows) {
  $id = $r.Groups[1].Value; $s = $r.Groups[2].Value
  if ($id -ceq 'ID') { continue }
  if ($ids -cnotcontains $id -or $state.ContainsKey($id) -or $s -cnotin 'done','failed','not-started') { exit 1 }
  $state[$id] = $s
}
if ($state.Count -ne 44) { exit 1 }
$rt = Get-Content work/20260924-1425-Gate2-AtgReport.md -Raw
$rep = [System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
if ($rt -cmatch '\A(?:\uFEFF)?主 run: 未作成(?:\r?\n|\z)') {
  if (@($ids | Where-Object { $state[$_] -cne 'not-started' }).Count -ne 0) { exit 1 }
} else {
  foreach ($r in [regex]::Matches($rt, '(?m)^\| ([A-Za-z0-9-]+) \| ([a-z_]+) \| \d+ \| \d+ \|\r?$')) {
    $id = $r.Groups[1].Value
    if ($rep.ContainsKey($id)) { exit 1 }
    $rep[$id] = $r.Groups[2].Value
  }
  if ($rep.Count -ne $ids.Count -or (Compare-Object -CaseSensitive @($ids) @($rep.Keys))) { exit 1 }
}
foreach ($i in $ids) {
  $m = switch ($rep[$i]) { 'succeeded' { 'done' } 'failed' { 'failed' } default { 'not-started' } }
  if ($state[$i] -cne $m) { exit 1 }
}
$all = @($ids | Where-Object { $state[$_] -cne 'done' }).Count -eq 0
if ($all) {
  $mf = Get-Content resources\models\manifest.json -Raw | ConvertFrom-Json
  foreach ($role in 'C6/classification','C6/detection','C7/classification','C7/detection') {
    $cat, $task = $role.Split('/')
    if (@($mf.models | Where-Object { $_.category -ceq $cat -and $_.task -ceq $task }).Count -lt 1) { exit 1 }
  }
}
$want = if ($all) { '主 run: 全成功' } elseif ($rt -cmatch '\A(?:\uFEFF)?主 run: 未作成(?:\r?\n|\z)') { '主 run: 未作成' } else { '主 run: 静止（失敗あり）' }
if ($t -cnotmatch "(?m)^$([regex]::Escape($want))\r?$") { exit 1 }
$a3 = if ($state['G2A-03'] -ceq 'done') { 'G2A-03: done' } else { 'G2A-03: not-done' }
if ($t -cnotmatch "(?m)^$([regex]::Escape($a3))\r?$") { exit 1 }
exit 0
