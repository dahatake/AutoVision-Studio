# SPI-07 Inference Pipe PoC Result

## Scope and verdict

- Transport PoC only（30-minute acceptanceは未実施）
- Windows: **VERIFIED**
- macOS: **NOT_RUN**
- Gate 1: **unresolved**
- FR-INF-010: **not claimed**
- 2026-09-04 adversarial revalidation: **PASS**（200 frames、malformed 3/3 fail-closed、mutant拒否）

## Environment outputs

```text
Core
7.6.5
v24.19.0
Python 3.14.7
```

## Node 24 TypeScript strict check (`spikes/inference/pipe.ts`)

### Failed attempt (honest record)

```text
spikes/inference/pipe.ts(333,37): error TS2339: Property 'ok' does not exist on type 'never'.
spikes/inference/pipe.ts(333,92): error TS2339: Property 'error' does not exist on type 'never'.
spikes/inference/pipe.ts(335,22): error TS2339: Property 'frames' does not exist on type 'never'.
spikes/inference/pipe.ts(336,55): error TS2339: Property 'frames' does not exist on type 'never'.
spikes/inference/pipe.ts(391,39): error TS2339: Property 'cpu_process_ns' does not exist on type 'never'.
spikes/inference/pipe.ts(392,47): error TS2339: Property 'rss_last_bytes' does not exist on type 'never'.
spikes/inference/pipe.ts(393,47): error TS2339: Property 'rss_peak_bytes' does not exist on type 'never'.

Command exited with code 1
```

### Final run

```text
Command produced no output
```

## Harness run (`node --experimental-strip-types spikes/inference/pipe.ts ml/.venv/Scripts/python.exe`)

```json
{
	"status": "ok",
	"transport": {
		"protocol": {
			"prefix": "4-byte big-endian body length",
			"header": "magic(2)+version(1)+shape(1)+width(2)+height(2)+channels(1)+reserved(1)+frame_index(4)",
			"header_size": 14,
			"target_hz": 10
		},
		"frames_total": 200,
		"frames_per_shape": 100,
		"node_cpu_ns": 453000000,
		"node_rss_sampled_peak_bytes": 131497984,
		"python_cpu_ns": 546875000,
		"python_rss_sample_bytes": 24494080,
		"python_rss_peak_bytes": 28487680,
		"python_rss_sample_kind": "current-working-set-after-last-frame",
		"child_exit_code": 0,
		"child_signal": null,
		"child_stderr": "",
		"shape_metrics": [
			{
				"shape": "320x320",
				"frames": 100,
				"interval_ms": {
					"mean": 99.90728484848485,
					"p95": 113.7468,
					"max": 128.0786
				},
				"jitter_ms": {
					"mean": 4.321731313131313,
					"p95": 15.2062,
					"max": 32.7955
				},
				"send_to_ack_latency_ms": {
					"mean": 3.02609902,
					"p95": 3.1494,
					"max": 128.0462
				},
				"python_service_ms": {
					"mean": 0.517581,
					"p95": 0.6878,
					"max": 1.034
				}
			},
			{
				"shape": "640x640",
				"frames": 100,
				"interval_ms": {
					"mean": 100.02076969696971,
					"p95": 110.4901,
					"max": 112.3585
				},
				"jitter_ms": {
					"mean": 6.351767737373738,
					"p95": 11.3092,
					"max": 12.8314
				},
				"send_to_ack_latency_ms": {
					"mean": 4.41483604,
					"p95": 7.3513,
					"max": 17.1791
				},
				"python_service_ms": {
					"mean": 2.061938,
					"p95": 3.5262,
					"max": 4.1927
				}
			}
		]
	},
	"malformed_probes": [
		{
			"name": "bad_version",
			"exitCode": 2,
			"signal": null,
			"ackOkCount": 0,
			"ackErrorCount": 1,
			"summaryOk": false,
			"stderr": "",
			"observedFailClosed": true
		},
		{
			"name": "bad_shape_code",
			"exitCode": 2,
			"signal": null,
			"ackOkCount": 0,
			"ackErrorCount": 1,
			"summaryOk": false,
			"stderr": "",
			"observedFailClosed": true
		},
		{
			"name": "bad_length_prefix",
			"exitCode": 2,
			"signal": null,
			"ackOkCount": 0,
			"ackErrorCount": 1,
			"summaryOk": false,
			"stderr": "",
			"observedFailClosed": true
		}
	],
	"children_reaped": true
}
```

## Ruff and Pyright (`spikes/inference/pipe.py`)

### Failed attempt (honest record)

```text
BLE001 Do not catch blind exception: `Exception`
	 --> spikes\inference\pipe.py:205:16
...
Found 1 error.

Command exited with code 1
```

独立再検証では`BinaryIO.read()`を`None`と比較する到達不能分岐をPyrightが1件検出した。分岐を削除し、下記の最終runで0 errorsを確認した。

### Final runs

```text
All checks passed!
0 errors, 0 warnings, 0 informations
```

## Locks, changed scope, diagnostics

```text
git status --short
?? spikes/inference/
```

```text
Get-ChildItem spikes/inference -Name
pipe-result.md
pipe.py
pipe.ts
```

`git diff --name-only -- package-lock.json ml/uv.lock` は出力なし（lock未変更）。

最終run後の対象Node/Python processは0。lock SHA-256は`package-lock.json`=`7F1BD82EFE1E4919DCE6DDFFDB763CEFF4404D29B60E8E946A150345A8DFE1A5`、`ml/uv.lock` canonical Git blob LF bytes=`D14D188A0D1F92F34A9436ECC0B2C801BB0375B36619199F846924C112C7E5FC`で正本から不変だった。

## 敵対的レビュー

2026-09-03、protocol/timing/process回収と証拠整合性を独立read-only contextでレビューした。

| ID | 指摘 | 再現・裁定 |
|---|---|---|
| SR-01 | ackまたはchild終了が来ない場合に無期限待機する | code pathとして再現。各ack、正常close、負例close、SIGTERM後closeへ5秒上限を追加し、`exit`ではなくstdio終了後の`close`まで待機するよう修正 |
| SR-02 | magic/version検査前に最大1,228,814 byteのbodyを読む | 再現するが上限検査済みで、固定shapeのlocal pipe PoCではblockingでない。streaming header検査はINF-05のproduction framingへdefer |
| SR-03 | queue=1、warm-up、実model、camera、30分試験がない | 正本どおりSPI-07の非対象。SPI-09、INF-05〜15で検証し、本結果をFR-INF-010合格へ転用しない |
| SR-04 | malformed probeが`observedFailClosed=false`でもtop-level `status=ok`になる | childの失敗exitを0へ変えた隔離mutantで3件すべてfalseのままexit 0を再現 | 3 probeそれぞれのexit 2、signalなし、error ack 1、summary false、stderr空、`observedFailClosed=true`をtop-level成功条件へ追加。mutantはexit 1へ変化 |
| SR-05 | stdout callback内の不正JSON/field例外がmain promiseへ伝播せず、timeout時にmalformed childを回収しない | EventEmitter callbackのthrowと`withTimeout`拒否後にcleanupがないcode pathを確認 | callback failureをpromiseへ伝播し、正常/負例の全childを`finally`でSIGTERM、必要時SIGKILLまで待って回収 |
| SR-06 | Nodeの離散sampleをpeakと断定し、POSIXの`ru_maxrss`をlast/current RSSと表示する | field名とplatform API意味が不一致 | Nodeは`sampled_peak`、Pythonは`sample`と`peak`を分離し、sample kindをWindows current working set / POSIX high-water markで明示 |
| ER-01 | 数値、lock、OS/Gate境界がcode/実行結果と矛盾する | 再現せず。最終runの200 frames、3負例、CPU/RSS、process 0、lock hashへ同期 |

SR-04〜06反映後の2026-09-04再検証では、TypeScript strict check、Ruff check/format、Pyright、200-frame run、負例3件が全て合格した。raw JSONは2,512 bytes、SHA-256 `85B4E109CCFA5E2FDA241689077371D1067BEFDB7819E43A09BD8FFB923381A1`。PoC scope内のblocking findingは0件。

最終エディタ診断:

- `spikes/inference/pipe.ts`: No errors found
- `spikes/inference/pipe.py`: No errors found
- `spikes/inference/pipe-result.md`: No errors found
