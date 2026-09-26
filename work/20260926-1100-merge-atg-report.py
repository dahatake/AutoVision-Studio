"""Gate 2 G2F-00: merge the `python -m atg report` node rows of the main runs in run order and keep,
for each of the 44 main-run node IDs (work/202609232120-Gate2-NodeInventory.md §1), the row of the last
run that contains it. Output: work/20260926-1100-Gate2-AtgReport.md (input of the inventory check §2)."""
import os, re, subprocess, sys
from pathlib import Path

RUNS = [  # (label, state DB, execution ID) in execution order
    ('main2', 'work/20260924-1815-Gate2Main2-atg-state/main.sqlite3', '0b7a6834-a226-4f48-b87c-5bc31dc2f2cd'),
    ('main3', 'work/20260924-2230-Gate2Main3-atg-state/main.sqlite3', '5618d7f3-f408-4e3d-bc2b-a745c1602a19'),
    ('main4', 'work/20260925-0420-Gate2Main4-atg-state/main.sqlite3', '84e8cb29-8aa9-40b6-bcab-411bfae30eff'),
    ('main5', 'work/20260925-0420-Gate2Main5-atg-state/main.sqlite3', '01ff4f75-d29a-453b-bb71-8e9bbb492a89'),
    ('main6', 'work/20260925-0526-Gate2Main6-atg-state/main.sqlite3', 'e52b01c9-2f58-4024-abf9-8d74f4671c85'),
    ('main7', 'work/20260925-0745-Gate2Main7-atg-state/main.sqlite3', '8c3df57e-0c2c-4806-9be9-7eb74c082560'),
    ('main8', 'work/20260925-0745-Gate2Main8-atg-state/main.sqlite3', '6cfad899-a4d7-4f12-8abd-82738be3209f'),
    ('main9', 'work/20260926-0815-Gate2Main9-atg-state/main.sqlite3', '860384d4-4af8-4b3a-baef-f64adacb3b98'),
]
IDS = ['G2D-01', 'G2D-01T', 'G2D-02', 'G2D-02R', 'G2D-04', 'G2D-05', 'G2D-06', 'G2D-07C', 'G2D-07D', 'G2D-08', 'G2D-10', 'G2D-11',
       'G2D-12', 'G2D-12T', 'EXT-41', 'EXT-X1', 'G2T-10', 'G2T-11', 'G2T-40', 'G2T-50C', 'G2T-50D', 'G2T-60C', 'G2T-60D', 'G2X-01a',
       'G2X-01b', 'G2X-01c', 'G2Q-01C', 'G2Q-01D', 'G2Q-01CM', 'G2Q-01DM', 'G2Q-02', 'G2Q-03C', 'G2Q-03D', 'G2Q-04C', 'G2Q-04D',
       'G2Q-05C', 'G2Q-05D', 'G2Q-06C', 'G2Q-06D', 'G2A-01', 'G2A-02', 'G2A-03', 'G2A-04', 'G2V-01']
if len(sys.argv) != 3:
    sys.exit('usage: merge-atg-report.py <main10 state DB> <main10 execution ID>')
runs = RUNS + [('main10', sys.argv[1], sys.argv[2])]
env = dict(os.environ, PYTHONPATH=str(Path('tools/atg/vendor').resolve()))
row = re.compile(r'^\| ([A-Za-z0-9-]+) \| ([a-z_]+) \| (\d+) \| (\d+) \|$')
last = {}
for label, state, eid in runs:
    out = subprocess.run([sys.executable, '-m', 'atg', 'report', '--state', state, '--execution-id', eid],
                         capture_output=True, text=True, encoding='utf-8', env=env, check=True).stdout
    for line in out.splitlines():
        m = row.match(line.strip())
        if m and m.group(1) in IDS:
            last[m.group(1)] = (m.group(2), m.group(3), m.group(4), label, eid)
missing = [i for i in IDS if i not in last]
assert not missing, missing
lines = ['# Gate 2 の ATG report の合成（main2〜main10、2026-09-26）', '',
         '各 run の `python -m atg report` の node 行を run の実行順に重ね、主 run の 44 node の ID ごとに最後の run の行を残した（生成: `work/20260926-1100-merge-atg-report.py`）。列は ATG の report の node 表と同じ（ID・状態・試行・成果物）。どの run の行かは下の対応表に記す。', '',
         '| ID | 状態 | 試行 | 成果物 |', '|---|---|---|---|']
lines += [f'| {i} | {last[i][0]} | {last[i][1]} | {last[i][2]} |' for i in IDS]
lines += ['', '## 行の出典', '', '| ID | run | 実行 ID |', '|---|---|---|']
lines += [f'| {i} | {last[i][3]} | `{last[i][4]}` |' for i in IDS]
Path('work/20260926-1100-Gate2-AtgReport.md').write_bytes(('\n'.join(lines) + '\n').replace('\n', '\r\n').encode('utf-8'))
print({s: sum(1 for v in last.values() if v[0] == s) for s in {v[0] for v in last.values()}})
