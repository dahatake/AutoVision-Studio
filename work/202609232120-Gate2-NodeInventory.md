# Gate 2 残タスク — ノード一覧（終端化 run の入力）

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書。[`202609232120-RemainTaskExecutionPlan.md`](202609232120-RemainTaskExecutionPlan.md) の主 run の全ノード ID の正本。終端化 run の G2F-00 と G2F-01a3 は計画本体の代わりに本書を読む。§3・§4 は graph の作成時に使う |
| 作成日時 | 2026-09-23 JST |
| 規則 | 計画のノードを追加・削除した場合は、本書の §1 と、§2・§3 のコマンドの `$ids` を同時に更新する |

## 1. 主 run のノード ID（44 件）

| 区分 | ID |
|---|---|
| 判断 | `G2D-01`、`G2D-01T`、`G2D-02`、`G2D-02R`、`G2D-04`、`G2D-05`、`G2D-06`、`G2D-07C`、`G2D-07D`、`G2D-08`、`G2D-10`、`G2D-11`、`G2D-12`、`G2D-12T` |
| 外部前提 | `EXT-41`、`EXT-X1` |
| 技術 | `G2T-10`、`G2T-11`、`G2T-40`、`G2T-50C`、`G2T-50D`、`G2T-60C`、`G2T-60D`、`G2X-01a`、`G2X-01b`、`G2X-01c` |
| 補助品質 | `G2Q-01C`、`G2Q-01D`、`G2Q-01CM`、`G2Q-01DM`、`G2Q-02`、`G2Q-03C`、`G2Q-03D`、`G2Q-04C`、`G2Q-04D`、`G2Q-05C`、`G2Q-05D`、`G2Q-06C`、`G2Q-06D` |
| 採用・版 | `G2A-01`、`G2A-02`、`G2A-03`、`G2A-04`、`G2V-01` |

準備 run（計画 §7.0）の node は `G2D-09` と `EXT-ATG` の 2 件で、主 run には含めない。準備 run の結果によって主 run の node を増減した場合は、本書を更新してから主 run の graph を作る。

## 2. 終端状態の記録の検査コマンド（G2F-00）

`pwsh.exe -NoLogo -NoProfile` で、repository root から実行する。`<file>` は G2F-00 が作る `work/<yyyymmdd-hhmm>-Gate2-TerminalState.md`、`<report>` は同じく `work/<yyyymmdd-hhmm>-Gate2-AtgReport.md`（主 run の `python -m atg report` の出力。準備 run が失敗して主 run を作らなかった場合は、1 行目を `主 run: 未作成` とし、準備 run の report を続ける）。状態の記録の node 行は `| <ID> | <done|failed|not-started> | <根拠> |` の形に限り、ATG の report は状態の記録に含めない。主 run を作らなかった場合、状態の記録の冒頭行は `主 run: 未作成` とする。

```powershell
$ids = 'G2D-01','G2D-01T','G2D-02','G2D-02R','G2D-04','G2D-05','G2D-06','G2D-07C','G2D-07D','G2D-08','G2D-10','G2D-11','G2D-12','G2D-12T','EXT-41','EXT-X1','G2T-10','G2T-11','G2T-40','G2T-50C','G2T-50D','G2T-60C','G2T-60D','G2X-01a','G2X-01b','G2X-01c','G2Q-01C','G2Q-01D','G2Q-01CM','G2Q-01DM','G2Q-02','G2Q-03C','G2Q-03D','G2Q-04C','G2Q-04D','G2Q-05C','G2Q-05D','G2Q-06C','G2Q-06D','G2A-01','G2A-02','G2A-03','G2A-04','G2V-01'
if (@($ids | Select-Object -Unique).Count -ne 44) { exit 3 }
$t = Get-Content <file> -Raw
$rows = [regex]::Matches($t, '(?m)^\| ([A-Za-z0-9-]+) \| ([a-z-]+) \|')
$state = [System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
foreach ($r in $rows) {
  $id = $r.Groups[1].Value; $s = $r.Groups[2].Value
  if ($id -ceq 'ID') { continue }
  if ($ids -cnotcontains $id -or $state.ContainsKey($id) -or $s -cnotin 'done','failed','not-started') { exit 1 }
  $state[$id] = $s
}
if ($state.Count -ne 44) { exit 1 }
$rt = Get-Content <report> -Raw
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
```

見出し行 `| ID | 状態 | 根拠 |` 以外の表の行は、node 行として検査される。

## 3. 主 run の graph と本書の一致の検査コマンド（変換時）

`<graph>` は `work/202609232120-atg-graph-main.json`。

```powershell
$ids = 'G2D-01','G2D-01T','G2D-02','G2D-02R','G2D-04','G2D-05','G2D-06','G2D-07C','G2D-07D','G2D-08','G2D-10','G2D-11','G2D-12','G2D-12T','EXT-41','EXT-X1','G2T-10','G2T-11','G2T-40','G2T-50C','G2T-50D','G2T-60C','G2T-60D','G2X-01a','G2X-01b','G2X-01c','G2Q-01C','G2Q-01D','G2Q-01CM','G2Q-01DM','G2Q-02','G2Q-03C','G2Q-03D','G2Q-04C','G2Q-04D','G2Q-05C','G2Q-05D','G2Q-06C','G2Q-06D','G2A-01','G2A-02','G2A-03','G2A-04','G2V-01'
$g = Get-Content <graph> -Raw | ConvertFrom-Json
$gid = @($g.nodes.id)
if ($gid.Count -ne $ids.Count -or @($gid | Select-Object -Unique).Count -ne $gid.Count -or (Compare-Object -CaseSensitive @($ids) $gid)) { exit 1 }
exit 0
```

## 4. 終端化 run の graph の検査コマンド（終端化 run の graph を作った後）

`<graph>` は `work/202609232120-atg-graph-final.json`、`<variant>` は G2F-00 の前に report から求めた値（`全成功`、`静止-G2A03done`、`静止`、`未作成` のいずれか）。node の集合と依存が variant の形と完全に一致しなければ exit 1。

```powershell
$variant = '<variant>'
$x = if ($variant -ceq '全成功') { 'G2F-01m' } else { 'G2F-01r' }
$a2 = $variant -cin '全成功','静止-G2A03done'
if ($variant -cnotin '全成功','静止-G2A03done','静止','未作成') { exit 2 }
$want = [ordered]@{ 'G2F-00' = @(); $x = @('G2F-00'); 'G2F-01a1' = @($x) }
if ($a2) { $want['G2F-01a2'] = @('G2F-01a1'); $want['G2F-01a3'] = @('G2F-01a1','G2F-01a2') } else { $want['G2F-01a3'] = @('G2F-01a1') }
$want['G2F-03'] = @('G2F-01a3')
$g = Get-Content <graph> -Raw | ConvertFrom-Json
$nodes = @($g.nodes)
if ($nodes.Count -ne $want.Count -or @($nodes.id | Select-Object -Unique).Count -ne $nodes.Count) { exit 1 }
foreach ($n in $nodes) {
  if (@($want.Keys) -cnotcontains $n.id) { exit 1 }
  $key = @($want.Keys) | Where-Object { $_ -ceq $n.id }
  $deps = @($n.deps)
  if ($deps.Count -ne @($want[$key]).Count -or ($deps.Count -gt 0 -and (Compare-Object -CaseSensitive @($want[$key]) $deps))) { exit 1 }
}
exit 0
```