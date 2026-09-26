# Gate 2 主 run の残り（main3、work/20260924-2230-UserRulings3-ExecutionPlan.md §2 G）の各ノードの verify_command。
# work/20260924-1815-Gate2Main2-verify.ps1 の複製で、差分は Review の path と、EXT-X1 の修正ノード（EXT-X1-F1〜F3）の追加だけ。
# 使い方: pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File work/20260924-2230-Gate2Main3-verify.ps1 <node ID>
param([Parameter(Mandatory)][string]$Node)
$ErrorActionPreference = 'Stop'
$PY = 'vendor\models\_spike\venv\Scripts\python.exe'
$Ev = 'docs\model-governance\evidence'
$Sig = 'docs\model-governance\siglip-base-patch16-224-adoption.md'
$Owl = 'docs\model-governance\owlvit-base-patch32-adoption.md'
$Tpl = 'docs\model-governance\adoption-template.md'

function Fail([int]$code = 1) { exit $code }
function Npm12 { $env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { Fail 2 } }
function Docs { Npm12; npm run verify:docs; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }
function Review([string]$id) { if (-not (Select-String -Path "work\20260924-2230-Gate2Main3-$id-Review.md" -Pattern '^blocking: 0$' -Quiet)) { Fail } }
function Ruff([string]$file) {
  $r = if (Test-Path ml\.venv\Scripts\ruff.exe) { 'ml\.venv\Scripts\ruff.exe' } else { (Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Recurse -Filter ruff.exe | Select-Object -First 1).FullName }
  & $r check $file; if ($LASTEXITCODE) { Fail $LASTEXITCODE }
  & $r format --check $file; if ($LASTEXITCODE) { Fail $LASTEXITCODE }
}
function CheckJson([string]$out, [string[]]$keys) {
  $k = ($keys | ForEach-Object { "'$_'" }) -join ','
  & $PY -c "import json,sys; d=json.load(open(r'$out',encoding='utf-8')); sys.exit(0 if d.get('verdict') in ('PASS','FAIL') and all(d.get(k) not in (None,'',[],{}) for k in ($k,)) else 1)"
  if ($LASTEXITCODE) { Fail $LASTEXITCODE }
}
function IsPass([string]$out) { & $PY -c "import json,sys; sys.exit(0 if json.load(open(r'$out',encoding='utf-8')).get('verdict')=='PASS' else 1)"; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }
function Recorded([string]$md, [string]$out, [string]$code = '0') {
  $h = (Get-FileHash $out).Hash.ToLower()
  if (-not (Select-String -Path $md -Pattern "^evidence: $h exit=$code$" -Quiet)) { Fail }
}
function Ruling([string]$id, [string]$choice, [string]$file = $id) {
  $f = "$Ev\2026-09-24-owner-ruling-$file.md"
  if (-not (Test-Path $f)) { Fail }
  if (-not (Select-String -Path $f -Pattern "^選択: $choice$" -Quiet)) { Fail }
  $t = Get-Content $f -Raw -Encoding utf8
  if (-not $t.Contains('判断者') -or $t -cnotmatch '(?m)^> ') { Fail }
  Review $id; Docs
}
function Confirmed([string]$id) {
  $lines = @(Select-String -Path "work\20260924-0730-$id-Confirmation.md" -Pattern '^evidence: (.+) exit=0$')
  if ($lines.Count -eq 0) { Fail }
  foreach ($l in $lines) { pwsh -NoLogo -NoProfile -Command $l.Matches[0].Groups[1].Value; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }
}
function Comparisons3([string]$out) {
  & $PY -c "import json,re,sys; c=json.load(open(r'$out',encoding='utf-8'))['comparisons']; n=[re.sub(r'^DP-\d+ ','',x.get('comparison','')) for x in c]; sys.exit(0 if len(n)==3 and set(n)=={'torch vs onnxruntime-cpu','torch vs onnxruntime-directml','onnxruntime-cpu vs onnxruntime-directml'} else 1)"
  if ($LASTEXITCODE) { Fail }
}
function Sections([string]$file, [string]$pattern) {
  $t = Get-Content $file -Raw -Encoding utf8
  return @([regex]::Split($t, '(?m)^(?=#+ )') | Where-Object { $_ -match "\A#+ .*$pattern" })
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
function TokenizerAudit([string]$dir, [string]$api, [string[]]$files) {
  $j = Get-Content $api -Raw | ConvertFrom-Json; $bad = 0
  foreach ($n in $files) {
    $s = @($j.siblings | Where-Object rfilename -eq $n); $p = Join-Path $dir $n
    if ($s.Count -ne 1 -or -not (Test-Path $p)) { $bad++; continue }
    $got = if ($s[0].lfs) { (Get-FileHash $p -Algorithm SHA256).Hash.ToLower() } else { git hash-object $p }
    $want = if ($s[0].lfs) { $s[0].lfs.sha256 } else { $s[0].blobId }
    if (((Get-Item $p).Length -ne $s[0].size) -or ($got -ne $want)) { $bad++ }
  }
  return $bad
}
function GoldsetCheck([string]$file, [string]$plan, [string]$task) {
  # 画像を読む前に、全 path が images-<task>/ 配下に解決されることを検査する
  & $PY -c "import json,sys,pathlib; b=pathlib.Path(r'vendor\models\_spike\assist'); d=(b/'images-$task').resolve(); m=json.load(open(b/'$file',encoding='utf-8')); p=[i['image'].replace(chr(92),'/') for i in m['items']]; sys.exit(0 if all(len(pathlib.PurePosixPath(x).parts)>1 and pathlib.PurePosixPath(x).parts[0]=='images-$task' and '..' not in pathlib.PurePosixPath(x).parts and d in (b/x).resolve().parents for x in p) else 1)"
  if ($LASTEXITCODE) { Fail $LASTEXITCODE }
  & $PY -c "import hashlib,json,sys,pathlib; b=pathlib.Path(r'vendor\models\_spike\assist'); m=json.load(open(b/'$file',encoding='utf-8')); it=m['items']; ids=[i['item_id'] for i in it]; ok=len(ids)==len(set(ids))==m['expected_item_count'] and all(hashlib.sha256((b/i['image']).read_bytes()).hexdigest()==i['image_sha256'] and i.get('license') and i.get('source') for i in it); sys.exit(0 if ok else 1)"
  if ($LASTEXITCODE) { Fail $LASTEXITCODE }
  if (-not (Select-String -Path "vendor\models\_spike\assist\$file.check.txt" -Pattern '^goldset-check exit=0$' -Quiet)) { Fail }
  if (-not (Select-String -Path "vendor\models\_spike\assist\$file.check.txt" -Pattern '^coverage-check exit=0$' -Quiet)) { Fail }
  $s = @(Sections $plan '被覆の検査コマンド')
  $m = [regex]::Match([string]$s[0], '(?s)```powershell\r?\n(.+?)\r?\n```')
  if (-not $m.Success) { Fail }
  pwsh -NoLogo -NoProfile -Command $m.Groups[1].Value; if ($LASTEXITCODE) { Fail $LASTEXITCODE }
}
function Session([string]$id, [string]$file) {
  & $PY -c "import sys,pathlib; sys.path.insert(0, r'spikes\models'); import assist_benchmark as a; a.load_session(pathlib.Path(r'vendor\models\_spike\assist\$file'))"
  if ($LASTEXITCODE) { Fail $LASTEXITCODE }
  if (-not (Test-Path "vendor\models\_spike\assist\$file.meta.txt")) { Fail }
  # EXT-41 計画 §3 の gold set との照合と、assisted session の sidecar との照合
  $task = $file -replace '^[a-z]+-|\.jsonl$', ''; $kind = $file -replace '-.*$', ''
  $L = Get-Content work\20260924-0730-EXT-41-Plan.md -Encoding utf8
  $cmds = @(($L | Where-Object { $_ -match 'goldset-<task>\.json' -and $_ -match 'python\.exe' }).Trim().Replace('<task>', $task).Replace('<session>', $kind))
  if ($kind -eq 'assisted') { $cmds += ($L | Where-Object { $_ -match 'sidecar_sha256: \(' }).Trim().Replace('<task>', $task) }
  foreach ($c in $cmds) { pwsh -NoLogo -NoProfile -Command $c; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }
  Review $id
}
function Diagnosis([string]$id, [string]$x) {
  $f = "work\20260924-0730-VitestFailure-$x.md"
  if ((Select-String -Path $f -Pattern 'run \d exit=\d+').Count -ne 5) { Fail }
  Review $id; Docs
}
function Vitest3 {
  Npm12
  for ($i = 0; $i -lt 3; $i++) { & .\node_modules\.bin\vitest.cmd run src/main/samples/sample-assets.test.ts src/main/data/reference-source.test.ts src/main/data/copy-source.test.ts; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }
}

switch -CaseSensitive ($Node) {
  'G2D-01' { Ruling 'G2D-01' 'A' }
  'G2D-02' { Ruling 'G2D-02' 'A' }
  'G2D-04' { Ruling 'G2D-04' '実装する' }
  'G2D-05' { Ruling 'G2D-05' 'A' }
  'G2D-06' { Ruling 'G2D-06' '署名する' }
  'G2D-07C' { Ruling 'G2D-07C' '承認' }
  'G2D-07D' { Ruling 'G2D-07D' '承認' }
  'G2D-08' { Ruling 'G2D-08' '\d+\.\d+\.\d+' }
  'G2D-10' { Ruling 'G2D-10' 'A' }
  'G2D-11' { Ruling 'G2D-11' '用意の完了' 'G2D-11-readiness'; Npm12 }
  'G2D-12' { Ruling 'G2D-12' 'A' }
  'G2D-01T' { if ((Select-String -Path $Tpl -SimpleMatch '2026-09-24-owner-ruling-G2D-01.md').Count -lt 2) { Fail }; Review 'G2D-01T'; Docs }
  'G2D-12T' { if ((Select-String -Path $Tpl -SimpleMatch '2026-09-24-owner-ruling-G2D-12.md').Count -lt 3) { Fail }; Review 'G2D-12T'; Docs }
  'G2D-02R' { if (-not (Select-String -Path spikes\models\assist-result.md -SimpleMatch '2026-09-24-owner-ruling-G2D-02.md' -Quiet)) { Fail }; Review 'G2D-02R'; Docs }
  'EXT-41' {
    # 確認の evidence 行が実行記録の 5 つのコマンドと同じであること
    $want = @([regex]::Matches((Get-Content work\20260924-0730-EXT-41-ExecutionRecord.md -Raw -Encoding utf8), '(?s)```powershell\r?\n\s*(.+?)\r?\n\s*```') | ForEach-Object { $_.Groups[1].Value.Trim() })
    $got = @(Select-String -Path work\20260924-0730-EXT-41-Confirmation.md -Pattern '^evidence: (.+) exit=0$' | ForEach-Object { $_.Matches[0].Groups[1].Value })
    if ($want.Count -ne 5 -or ($want -join "`n") -cne ($got -join "`n")) { Fail }
    Confirmed 'EXT-41'
  }
  'EXT-X1-F1' { Npm12; & .\node_modules\.bin\vitest.cmd run src/main/data/import-files.test.ts; if ($LASTEXITCODE) { Fail $LASTEXITCODE }; Review 'EXT-X1-F1' }
  'EXT-X1-F2' { Npm12; & .\node_modules\.bin\vitest.cmd run src/main/data/reference-source.test.ts; if ($LASTEXITCODE) { Fail $LASTEXITCODE }; Review 'EXT-X1-F2' }
  'EXT-X1-F3' { Npm12; & .\node_modules\.bin\vitest.cmd run src/main/ipc/import-handlers.test.ts; if ($LASTEXITCODE) { Fail $LASTEXITCODE }; Review 'EXT-X1-F3' }
  'EXT-X1' { Confirmed 'EXT-X1'; Vitest3; Review 'EXT-X1' }
  'G2T-10' {
    $o = 'vendor\models\_spike\c6-cls-transfer.json'
    CheckJson $o 'environment', 'checkpoint', 'onnx_sha256', 'comparisons', 'repeat_run_bitwise_identical'
    Comparisons3 $o
    # 所有者の判断 2026-09-24-owner-ruling-G2T-10.md: FR-TRN-018 の allclose（rtol 1e-3、atol 1e-4）と top-1 一致率 99.5% 以上
    & $PY -c "import json,sys; d=json.load(open(r'$o',encoding='utf-8')); t=d['tolerances']; ok=t.get('logit_rule')=='allclose' and t.get('rtol')==0.001 and t.get('atol')==0.0001 and t.get('min_top1_agreement')==0.995 and all(c.get('logit_allclose') is True and int(c['top1_agreement'].split('/')[0])/int(c['top1_agreement'].split('/')[1])>=0.995 for c in d['comparisons']); sys.exit(0 if ok else 1)"
    if ($LASTEXITCODE) { Fail $LASTEXITCODE }
    Recorded 'spikes\models\classification-checkpoint-result.md' $o; IsPass $o
    Ruff 'spikes\models\classification_checkpoint_parity.py'; Review 'G2T-10'
  }
  'G2T-11' {
    $o = 'vendor\models\_spike\c6-det-transfer.json'
    CheckJson $o 'environment', 'checkpoint', 'onnx_sha256', 'comparisons', 'repeat_run_bitwise_identical', 'compared_detections'; Comparisons3 $o
    Recorded 'spikes\models\detection-checkpoint-parity-result.md' $o; IsPass $o
    Ruff 'spikes\models\detection_checkpoint_parity.py'; Review 'G2T-11'
  }
  'G2T-40' {
    $f = 'work\20260924-0730-AssistSessionRecording.md'
    if ((Select-String -Path $f -Pattern '\S+\.(ts|py|md):\d+').Count -lt 3) { Fail }
    $c = @(Sections $f '候補')
    if ($c.Count -eq 0) { Fail }
    foreach ($s in $c) { if ($s -notmatch '\S+\.(ts|py|md):\d+' -or $s -notmatch 'Gate 2 前に製品 code の変更が必要か: (はい|いいえ)') { Fail } }
    Review 'G2T-40'; Docs
  }
  'G2T-60C' { Recorded $Sig 'vendor\models\_spike\advisories-C.txt' '0'; Review 'G2T-60C'; Docs }
  'G2T-60D' { Recorded $Owl 'vendor\models\_spike\advisories-D.txt' '0'; Review 'G2T-60D'; Docs }
  'G2T-50C' {
    if ((TokenizerAudit 'vendor\models\_spike\siglip' "$Ev\siglip-base-patch16-224-hf-api-20260923.json" 'spiece.model', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json') -ne 0) { Fail }
    if (-not (Select-String -Path $Sig -Pattern 'tokenizer-audit exit=0' -Quiet)) { Fail }
    Review 'G2T-50C'; Docs
  }
  'G2T-50D' {
    if ((TokenizerAudit 'vendor\models\_spike\owlvit-b32' "$Ev\owlvit-base-patch32-hf-api-20260923.json" 'vocab.json', 'merges.txt', 'tokenizer_config.json', 'special_tokens_map.json') -ne 0) { Fail }
    if (-not (Select-String -Path $Owl -Pattern 'tokenizer-audit exit=0' -Quiet)) { Fail }
    Review 'G2T-50D'; Docs
  }
  'G2X-01a' { Diagnosis 'G2X-01a' 'a' }
  'G2X-01b' { Diagnosis 'G2X-01b' 'b' }
  'G2X-01c' { Diagnosis 'G2X-01c' 'c' }
  { $_ -in 'G2Q-01C', 'G2Q-01D' } {
    $f = if ($Node -ceq 'G2Q-01C') { 'spikes\models\assist-goldset-plan-classification.md' } else { 'spikes\models\assist-goldset-plan-detection.md' }
    foreach ($h in '判定式', '非劣化の閾値', 'item 数', '被覆の下限', '被覆の検査コマンド', '変更の規則') {
      $s = @(Sections $f $h); if ($s.Count -ne 1) { Fail }
      # 各数値行について、最後の数字より後ろ、または次の非空行に根拠 / 所有者の判断事項があることを要求する（code block は除く）
      $lines = @(([regex]::Replace($s[0], '(?s)```.*?```', '') -split '\r?\n' | Select-Object -Skip 1) | Where-Object { $_.Trim() })
      $n = 0
      for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -notmatch '\d') { continue }
        $first = [regex]::Match($lines[$i], '\d').Index
        if ($lines[$i].Substring(0, $first) -match '根拠|所有者の判断事項') { continue }
        $n++
        $after = $lines[$i].Substring([regex]::Match($lines[$i], '\d(?!.*\d)').Index)
        $next = if ($i + 1 -lt $lines.Count) { $lines[$i + 1] } else { '' }
        if ($after -notmatch '根拠|所有者の判断事項' -and $next -notmatch '根拠|所有者の判断事項') { Fail }
      }
      # 数値案が必須の見出しだけ数値行 1 件以上を要求する（検査コマンド・変更の規則は数値を含まない場合がある）
      if ($n -lt 1 -and $h -in '判定式', '非劣化の閾値', 'item 数', '被覆の下限') { Fail }
    }
    Review $Node; Docs
  }
  'G2Q-01CM' { GoldsetCheck 'goldset-classification.json' 'spikes\models\assist-goldset-plan-classification.md' 'classification'; Review 'G2Q-01CM' }
  'G2Q-01DM' { GoldsetCheck 'goldset-detection.json' 'spikes\models\assist-goldset-plan-detection.md' 'detection'; Review 'G2Q-01DM' }
  'G2Q-02' {
    $st = & $PY spikes\models\assist_benchmark.py --self-test | Out-String; if ($LASTEXITCODE) { Fail $LASTEXITCODE }
    foreach ($case in 'quality-noninferiority-boundary', 'median-boundary', 'candidate-sha256-mismatch', 'goldset-session-id-mismatch') { if (-not $st.Contains($case)) { Fail } }
    $o = & $PY spikes\models\assist_benchmark.py | Out-String; $code = $LASTEXITCODE
    if ($code -eq 0 -or ($o | ConvertFrom-Json).verdict -ne 'BLOCKED') { Fail }
    Ruff 'spikes\models\assist_benchmark.py'; Review 'G2Q-02'
  }
  'G2Q-03C' {
    $o = 'vendor\models\_spike\siglip-goldset.json'
    CheckJson $o 'environment', 'goldset_sha256', 'onnx_sha256', 'confidenceThreshold', 'thresholdPolicy', 'prompt_rule', 'seeds'
    Recorded 'spikes\models\siglip-assist-result.md' $o; IsPass $o; Ruff 'spikes\models\siglip_assist_parity.py'; Review 'G2Q-03C'
  }
  'G2Q-03D' {
    $o = 'vendor\models\_spike\owlvit-goldset.json'
    CheckJson $o 'environment', 'goldset_sha256', 'onnx_sha256', 'compared_detections', 'confidenceThreshold', 'thresholdPolicy', 'threshold_boundary', 'prompt_rule', 'seeds'
    Recorded 'spikes\models\owlvit-assist-result.md' $o; IsPass $o; Ruff 'spikes\models\owlvit_assist_parity.py'; Review 'G2Q-03D'
  }
  'G2Q-04C' { Session 'G2Q-04C' 'manual-classification.jsonl' }
  'G2Q-04D' { Session 'G2Q-04D' 'manual-detection.jsonl' }
  'G2Q-05C' { Session 'G2Q-05C' 'assisted-classification.jsonl' }
  'G2Q-05D' { Session 'G2Q-05D' 'assisted-detection.jsonl' }
  { $_ -in 'G2Q-06C', 'G2Q-06D' } {
    $task = if ($Node -ceq 'G2Q-06C') { 'classification' } else { 'detection' }
    $o = "vendor\models\_spike\assist\benchmark-$task.json"
    CheckJson $o 'environment', 'assisted', 'manual_only', 'session_sha256', 'goldset_sha256', 'candidate_sha256'
    Recorded 'spikes\models\assist-result.md' $o; IsPass $o; Review $Node
  }
  'G2A-01' { Approval $Sig 'model.safetensors' 'vendor\models\_spike\siglip\model.safetensors' '2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8' '7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed'; Review 'G2A-01'; Docs }
  'G2A-02' { Approval $Owl 'model.safetensors' 'vendor\models\_spike\owlvit-b32\model.safetensors' '4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b' 'cbc355fb364588351c5d51c7f74465e8e7ec6f72'; Review 'G2A-02'; Docs }
  'G2A-03' { node --test scripts/models/manifest-schema.test.mjs; if ($LASTEXITCODE) { Fail $LASTEXITCODE }; Review 'G2A-03' }
  'G2A-04' { Npm12; & .\node_modules\.bin\vitest.cmd run src/renderer/features/settings/SettingsPage.test.tsx; if ($LASTEXITCODE) { Fail $LASTEXITCODE }; Review 'G2A-04' }
  'G2V-01' {
    Npm12
    foreach ($s in 'verify:version', 'test:version', 'test', 'typecheck', 'build') { npm run $s; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }
    if (Compare-Object @(Get-Content work\20260924-0730-G2V-01-tags-before.txt) @(git tag)) { Fail }
    Review 'G2V-01'
  }
  default { Fail 3 }
}
exit 0
