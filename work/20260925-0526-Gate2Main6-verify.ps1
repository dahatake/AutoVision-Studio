# Gate 2 main6（work/20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md §5.2）の G2Q-03D の verify_command。
# work/20260925-0420-Gate2Main4-verify.ps1 の G2Q-03D の検査に、ParityA（所有者の判断 G2Q-03D-T の A1〜A3）と
# CHECKJSON の必須キー parity_policy・f1_by_backend を加えたもの。
# 使い方: pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File work/20260925-0526-Gate2Main6-verify.ps1 G2Q-03D
param([Parameter(Mandatory)][string]$Node)
$ErrorActionPreference = 'Stop'
$PY = 'vendor\models\_spike\venv\Scripts\python.exe'

function Fail([int]$code = 1) { exit $code }
function Review([string]$id) { if (-not (Select-String -Path "work\20260925-0526-Gate2Main6-$id-Review.md" -Pattern '^blocking: 0$' -Quiet)) { Fail } }
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
function Selection([string]$out) { & $PY work\20260925-0420-check-selection.py $out; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }
function ParityA([string]$out) { & $PY work\20260925-0526-check-parity-A.py $out; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }
function IsPass([string]$out) { & $PY -c "import json,sys; sys.exit(0 if json.load(open(r'$out',encoding='utf-8')).get('verdict')=='PASS' else 1)"; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }
function Recorded([string]$md, [string]$out, [string]$code = '0') {
  $h = (Get-FileHash $out).Hash.ToLower()
  if (-not (Select-String -Path $md -Pattern "^evidence: $h exit=$code$" -Quiet)) { Fail }
}

switch -CaseSensitive ($Node) {
  'G2Q-03D' {
    $o = 'vendor\models\_spike\owlvit-goldset.json'
    CheckJson $o 'environment', 'goldset_sha256', 'onnx_sha256', 'compared_detections', 'confidenceThreshold', 'thresholdPolicy', 'threshold_boundary', 'prompt_rule', 'seeds', 'parity_policy', 'f1_by_backend'
    Recorded 'spikes\models\owlvit-assist-result.md' $o; IsPass $o; Selection $o; ParityA $o; Ruff 'spikes\models\owlvit_assist_parity.py'; Review 'G2Q-03D'
  }
  default { Fail 3 }
}
exit 0
