# PRE-03: Gate 2 正本 §6.1・§8 のノード ID と inventory §1 の照合（202609232400 計画 §6）
# §6.1 の略記（「04〜12」「01C / 01D」「01a〜c」等）は下の $expand で展開する。各行の見出しが $expand の key と完全一致しなければ exit 1。
$ErrorActionPreference = 'Stop'
$c = Get-Content work/202609232120-RemainTaskExecutionPlan.md -Encoding utf8
$i61 = ($c | Select-String -Pattern '^### 6\.1').LineNumber
$i7 = ($c | Select-String -Pattern '^## 7\. ').LineNumber
$i8 = ($c | Select-String -Pattern '^## 8\. ').LineNumber
$i9 = ($c | Select-String -Pattern '^## 9\. ').LineNumber
$expand = [ordered]@{
  'G2D-01、02、04〜12（各。判断記録のみ）' = 'G2D-01','G2D-02','G2D-04','G2D-05','G2D-06','G2D-07C','G2D-07D','G2D-08','G2D-09','G2D-10','G2D-11','G2D-12'
  'G2D-01T（adoption-template §11・§16.7 の更新）' = @('G2D-01T')
  'G2D-12T（adoption-template §16.7・§16.10・§16.11 の更新）' = @('G2D-12T')
  'G2D-02R（assist-result への解除の追記）' = @('G2D-02R')
  'G2T-10' = @('G2T-10'); 'G2T-11' = @('G2T-11'); 'G2T-40' = @('G2T-40')
  'G2T-50C / 50D、G2T-60C / 60D（各）' = 'G2T-50C','G2T-50D','G2T-60C','G2T-60D'
  'G2X-01a〜c（各、診断のみ）' = 'G2X-01a','G2X-01b','G2X-01c'
  'G2Q-01C / 01D、01CM / 01DM（各）' = 'G2Q-01C','G2Q-01D','G2Q-01CM','G2Q-01DM'
  'G2Q-02' = @('G2Q-02')
  'G2Q-03C / 03D（各）' = 'G2Q-03C','G2Q-03D'
  'G2Q-04C〜05D（各）' = 'G2Q-04C','G2Q-04D','G2Q-05C','G2Q-05D'
  'G2Q-06C / 06D（各）' = 'G2Q-06C','G2Q-06D'
  'G2A-01 / 02（各）' = 'G2A-01','G2A-02'
  'G2A-03' = @('G2A-03'); 'G2A-04' = @('G2A-04'); 'G2V-01' = @('G2V-01')
  'EXT-41、EXT-ATG、EXT-X1 の確認（各）' = 'EXT-41','EXT-ATG','EXT-X1'
  'G2F-00（終端化）' = @('G2F-00')
  'G2F-01r（BLOCKED 時の manifest `reason`）' = @('G2F-01r')
  'G2F-01m（`ready=true` 時の manifest と test）' = @('G2F-01m')
  'G2F-01a1（ADR-0004）' = @('G2F-01a1')
  'G2F-01a2（実装計画の Gate 2 状態行）' = @('G2F-01a2')
  'G2F-01a3（実行記録）' = @('G2F-01a3')
  'G2F-03' = @('G2F-03')
}
$labels = @($c[$i61..($i7 - 2)] | Where-Object { $_ -match '^\| (G2|EXT)' } | ForEach-Object { ($_ -split '\|')[1].Trim() })
if (Compare-Object -CaseSensitive $labels @($expand.Keys)) { Write-Output 'NG: §6.1 の行見出しが展開表と一致しない'; exit 1 }
$all = @($expand.Values | ForEach-Object { $_ })
if (@($all | Select-Object -Unique).Count -ne $all.Count) { Write-Output 'NG: 展開後に重複'; exit 1 }
# 主 run = §6.1 − 準備 run（G2D-09、EXT-ATG）− 終端化 run（G2F-*）
$main = @($all | Where-Object { $_ -cnotin 'G2D-09','EXT-ATG' -and $_ -notlike 'G2F-*' })
$inv = Get-Content work/202609232120-Gate2-NodeInventory.md -Raw -Encoding utf8
$s1 = [regex]::Match($inv, '(?s)## 1\..*?(?=\r?\n## 2\.)').Value
$inv1 = @([regex]::Matches(($s1 -split '\r?\n' | Where-Object { $_ -match '^\| (判断|外部前提|技術|補助品質|採用・版) \|' }) -join "`n", '`([A-Za-z0-9-]+)`') | ForEach-Object { $_.Groups[1].Value })
$inv2 = @([regex]::Match($inv, "(?s)## 2\..*?\`$ids = ([^\r\n]+)").Groups[1].Value -split ',' | ForEach-Object { $_.Trim("' ") })
Write-Output "§6.1 展開: $($all.Count) 件、主 run: $($main.Count) 件、inventory §1: $($inv1.Count) 件、inventory §2 `$ids: $($inv2.Count) 件"
if ($main.Count -ne 44 -or (Compare-Object -CaseSensitive $main $inv1) -or (Compare-Object -CaseSensitive $main $inv2)) { Write-Output 'NG: 主 run の ID 集合が inventory と一致しない'; exit 1 }
# §8 に現れる ID は §6.1 の展開か、§8 の節見出しで使う総称（G2F-01、G2T-50、G2T-60）
$s8 = $c[($i8 - 1)..($i9 - 2)] -join "`n"
$ids8 = @([regex]::Matches($s8, '\b(G2[DTXQAVF]-[0-9A-Za-z]+|EXT-(?:41|ATG|X1))\b') | ForEach-Object Value | Sort-Object -Unique)
$extra = @($ids8 | Where-Object { $_ -cnotin $all -and $_ -cnotin 'G2F-01','G2T-50','G2T-60' })
if ($extra.Count) { Write-Output "NG: §8 にだけある ID: $($extra -join ',')"; exit 1 }
# 逆方向: §6.1 の ID はすべて §8 に字句で現れるか、下の略記で現れる
$abbr = @{ 'G2D-05' = '（G2D-01、02、04〜12）'; 'G2D-07D' = 'G2D-07C / 07D' }
$missing = @($all | Where-Object { $_ -cnotin $ids8 -and -not ($abbr.ContainsKey($_) -and $s8.Contains($abbr[$_])) })
if ($missing.Count) { Write-Output "NG: §8 にない ID: $($missing -join ',')"; exit 1 }
Write-Output '① OK'
# ② 状態の対応。本計画 §6 PRE-03 の ② は、対応（succeeded→done 等）と「根拠の列に ATG の生の状態」の両方が正本か inventory に書いてあることを求める
$both = ($c -join "`n") + "`n" + $inv
if (-not $both.Contains('（`succeeded`→`done`、`failed`→`failed`、それ以外→`not-started`）')) { Write-Output 'NG: ② 状態の対応の記述がない'; exit 1 }
if (-not $both.Contains('生の状態')) { Write-Output 'NG: ② 根拠の列に ATG の生の状態を書く規則が正本・inventory にない'; exit 1 }
Write-Output '② OK'
exit 0
