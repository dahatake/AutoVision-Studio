# EXT-41: 確認の実行記録

計画: [`20260924-0730-EXT-41-Plan.md`](20260924-0730-EXT-41-Plan.md)。製品 code と `spikes/models/assist_benchmark.py` は変更していない。合成の JSONL は `$env:TEMP` に作り、repository に置かない。合成の記録は harness の形式の確認だけに使い、session の記録ではない。

## コマンドと結果

1. 既存の self-test（metric の算術。`assist_benchmark.py` の `--self-test`）

   ```powershell
   & vendor\models\_spike\venv\Scripts\python.exe spikes\models\assist_benchmark.py --self-test; exit $LASTEXITCODE
   ```

2. 合成の session（manual 1 件、accept 1 件）が `load_session` を通る

   ```powershell
   $p = Join-Path $env:TEMP 'ext41-ok.jsonl'; @(@{item_id='a';proposed=$false;outcome='manual';seconds=4.5}, @{item_id='b';proposed=$true;outcome='accept';seconds=3}) | ForEach-Object { $_ | ConvertTo-Json -Compress } | Set-Content $p -Encoding utf8; & vendor\models\_spike\venv\Scripts\python.exe -c 'import sys,pathlib; sys.path.insert(0, r''spikes\models''); import assist_benchmark as a; a.load_session(pathlib.Path(sys.argv[1]))' $p; exit $LASTEXITCODE
   ```

3. 否定 test: `seconds` の無い記録は補完されずに拒否される（`RecordError` の `missing 'seconds'` で exit 0）

   ```powershell
   $p = Join-Path $env:TEMP 'ext41-noseconds.jsonl'; @{item_id='a';proposed=$false;outcome='manual'} | ConvertTo-Json -Compress | Set-Content $p -Encoding utf8; $o = & vendor\models\_spike\venv\Scripts\python.exe -c 'import sys,pathlib; sys.path.insert(0, r''spikes\models''); import assist_benchmark as a; a.load_session(pathlib.Path(sys.argv[1]))' $p 2>&1 | Out-String; if ($LASTEXITCODE -ne 0 -and $o.Contains('RecordError') -and $o.Contains('missing ''seconds''')) { exit 0 }; exit 1
   ```

4. 否定 test: `outcome` の無い記録は補完されずに拒否される（`RecordError` の `missing 'outcome'` で exit 0）

   ```powershell
   $p = Join-Path $env:TEMP 'ext41-nooutcome.jsonl'; @{item_id='a';proposed=$false;seconds=4.5} | ConvertTo-Json -Compress | Set-Content $p -Encoding utf8; $o = & vendor\models\_spike\venv\Scripts\python.exe -c 'import sys,pathlib; sys.path.insert(0, r''spikes\models''); import assist_benchmark as a; a.load_session(pathlib.Path(sys.argv[1]))' $p 2>&1 | Out-String; if ($LASTEXITCODE -ne 0 -and $o.Contains('RecordError') -and $o.Contains('missing ''outcome''')) { exit 0 }; exit 1
   ```

5. 計画 §3 の 2 つの検査が、合成の一致する入力で exit 0、不一致の入力（sidecar の `output` が null・無い、sidecar の SHA-256 の不一致、sidecar と `proposed: true` の item の不一致、manual-only session の `proposed: true`、受け渡しメモの空の `recorder:`、gold set の件数の不一致）で exit 1 になる（検査は計画の行をそのまま取り出し、directory を `$env:TEMP` の下に替えて実行する）

   ```powershell
   $d = Join-Path $env:TEMP 'ext41-chk'; Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $d | Out-Null; $L = Get-Content work\20260924-0730-EXT-41-Plan.md -Encoding utf8; $g = ($L | Where-Object { $_ -match 'goldset-<task>\.json' -and $_ -match 'python\.exe' }).Trim().Replace("r'vendor\models\_spike\assist'", "r'$d'").Replace('<task>', 'zz'); $c = ($L | Where-Object { $_ -match 'sidecar_sha256: \(' }).Trim().Replace("r'vendor\models\_spike\assist'", "r'$d'").Replace('<task>', 'zz'); $m = 'recorded_at: 2026-09-24T10:00', 'recorder: x', 'settings: y'; $a = '{"item_id":"a","proposed":false,"outcome":"manual","seconds":1}'; Set-Content "$d\goldset-zz.json" '{"expected_item_count":2,"items":[{"item_id":"a"},{"item_id":"b"}]}'; Set-Content "$d\assisted-zz.jsonl" $a, '{"item_id":"b","proposed":true,"outcome":"accept","seconds":2}'; Set-Content "$d\manual-zz.jsonl" $a, '{"item_id":"b","proposed":false,"outcome":"manual","seconds":2}'; Set-Content "$d\manual-zz.jsonl.meta.txt" $m; function Gold($k) { pwsh -NoLogo -NoProfile -Command $g.Replace('<session>', $k); $LASTEXITCODE }; function Chk($s, $h) { Set-Content "$d\assisted-zz.sidecar.jsonl" $s; if (-not $h) { $h = (Get-FileHash "$d\assisted-zz.sidecar.jsonl").Hash.ToLower() }; Set-Content "$d\assisted-zz.jsonl.meta.txt" ($m + "sidecar_sha256: $h"); pwsh -NoLogo -NoProfile -Command $c; $LASTEXITCODE }; $r = @((Gold 'manual'), (Chk '{"item_id":"b","output":[]}'), (Gold 'assisted'), (Chk '{"item_id":"b","output":null}'), (Chk '{"item_id":"b"}'), (Chk '{"item_id":"b","output":[]}' ('0' * 64)), (Chk '{"item_id":"a","output":[]}')); Set-Content "$d\manual-zz.jsonl" $a, '{"item_id":"b","proposed":true,"outcome":"accept","seconds":2}'; $r += Gold 'manual'; Set-Content "$d\manual-zz.jsonl" $a, '{"item_id":"b","proposed":false,"outcome":"manual","seconds":2}'; Set-Content "$d\manual-zz.jsonl.meta.txt" 'recorded_at: 2026-09-24T10:00', 'recorder: ', 'settings: y'; $r += Gold 'manual'; Set-Content "$d\manual-zz.jsonl.meta.txt" $m; Set-Content "$d\goldset-zz.json" '{"expected_item_count":3,"items":[{"item_id":"a"},{"item_id":"b"},{"item_id":"c"}]}'; $r += Gold 'manual'; Remove-Item $d -Recurse -Force; Write-Output ($r -join ','); if (($r -join ',') -eq '0,0,0,1,1,1,1,1,1,1') { exit 0 }; exit 1
   ```

## 結果

実行: 2026-09-24 19:46（JST。コマンド 5 は計画 §3 の検査の追加の後に実行した）、各コマンドを `pwsh -NoLogo -NoProfile -Command` で実行した（Gate 2 主 run の verify の `Confirmed` と同じ呼び方）。

| コマンド | exit | 出力 |
|---|---|---|
| 1 | 0 | `verdict: PASS`（`failures: []`） |
| 2 | 0 | なし（`load_session` が例外なしで戻った） |
| 3 | 0 | なし（`RecordError` の `missing 'seconds'` で拒否された） |
| 4 | 0 | なし（`RecordError` の `missing 'outcome'` で拒否された） |
| 5 | 0 | `0,0,0,1,1,1,1,1,1,1`（gold set の照合 manual・sidecar の照合・gold set の照合 assisted の一致、sidecar の null・無い・SHA-256・item、manual の proposed、空の recorder、件数の順の exit） |
