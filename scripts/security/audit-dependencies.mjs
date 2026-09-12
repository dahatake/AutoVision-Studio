import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const GHSA = /^GHSA-[23456789cfghjmpqrvwx]{4}(?:-[23456789cfghjmpqrvwx]{4}){2}$/;
const SHA256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function npmVersion(value) {
  if (!text(value)) return false;
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) return false;
  if (match[4]?.split('.').some((part) => part === '' || /^0[0-9]+$/.test(part))) return false;
  return !match[5]?.split('.').some((part) => part === '');
}

function exceptionVersion(entry) {
  if (entry.ecosystem === 'npm') return npmVersion(entry.version);
  if (entry.ecosystem === 'pypi') return /^(?:[0-9]+!)?[0-9]+(?:\.[0-9]+)*(?:(?:a|b|rc)[0-9]+)?(?:\.post[0-9]+)?(?:\.dev[0-9]+)?(?:\+[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/.test(entry.version);
  return /^[0-9]+(?:[._+-][0-9A-Za-z]+)*$/.test(entry.version) && !/(?:^|[._+-])[xX](?:$|[._+-])/.test(entry.version);
}

function utcDay(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Invalid exception date.');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  requireValue(Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value, 'Invalid exception date.');
  return time;
}

export function readExceptions(markdown, now = new Date()) {
  const start = '<!-- vulnerability-exceptions:start -->';
  const end = '<!-- vulnerability-exceptions:end -->';
  requireValue(Number.isFinite(now.getTime()), 'Invalid audit time.');
  requireValue(markdown.split(start).length === 2 && markdown.split(end).length === 2, 'Exactly one exception register is required.');
  requireValue(markdown.indexOf(start) < markdown.indexOf(end), 'Invalid exception register boundaries.');
  const block = markdown.split(start)[1].split(end)[0].trim();
  const match = /^```json\s*([\s\S]*?)\s*```$/.exec(block);
  requireValue(match, 'Exception register must be a JSON block.');
  const register = JSON.parse(match[1]);
  requireValue(isObject(register) && register.schemaVersion === 1 && Array.isArray(register.exceptions), 'Invalid exception register.');
  const keys = ['ecosystem', 'package', 'version', 'advisoryId', 'cve', 'severity', 'rationale', 'mitigation', 'responsible', 'approvedBy', 'approvedOn', 'expiresOn', 'decision'];
  const seen = new Set();
  for (const entry of register.exceptions) {
    requireValue(isObject(entry) && Object.keys(entry).length === keys.length && keys.every((key) => text(entry[key])), 'Incomplete vulnerability exception.');
    requireValue(['npm', 'pypi', 'native'].includes(entry.ecosystem), 'Invalid exception ecosystem.');
    requireValue(exceptionVersion(entry), 'Exception must name an exact version.');
    requireValue(GHSA.test(entry.advisoryId) || /^CVE-\d{4}-\d{4,}$/.test(entry.advisoryId) || /^npm:\d+$/.test(entry.advisoryId), 'Invalid exception advisory ID.');
    requireValue(/^CVE-\d{4}-\d{4,}$/.test(entry.cve), 'Exception requires a CVE.');
    requireValue(['high', 'critical'].includes(entry.severity), 'Exception severity must be high or critical.');
    requireValue(!keys.some((key) => /^(?:unknown|tbd|pending|n\/a|none|not_run)$/i.test(entry[key])), 'Unapproved exception placeholder.');
    const approved = utcDay(entry.approvedOn);
    const expires = utcDay(entry.expiresOn) + 86_400_000;
    requireValue(approved <= now.getTime() && approved < expires, 'Exception approval date is invalid.');
    requireValue(now.getTime() < expires, 'Expired vulnerability exception.');
    const key = JSON.stringify([entry.ecosystem, entry.package, entry.version, entry.advisoryId]);
    requireValue(!seen.has(key), 'Duplicate vulnerability exception.');
    seen.add(key);
  }
  return register.exceptions;
}

export function npmInventory(lock, manifest) {
  requireValue(isObject(lock) && lock.lockfileVersion === 3 && isObject(lock.packages), 'A version 3 npm lock is required.');
  const root = lock.packages[''];
  requireValue(isObject(root) && root.name === manifest.name && root.version === manifest.version && lock.version === manifest.version, 'npm manifest and lock disagree.');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const declared = Object.entries(manifest[field] ?? {}).sort();
    const locked = Object.entries(root[field] ?? {}).sort();
    requireValue(JSON.stringify(declared) === JSON.stringify(locked), `npm ${field} and lock disagree.`);
  }
  const inventory = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') continue;
    requireValue(path.startsWith('node_modules/') && !path.includes('\\') && !path.split('/').some((part) => part === '..' || part === '.' || part === ''), 'Invalid npm lock package path.');
    requireValue(isObject(entry) && !entry.link && npmVersion(entry.version), 'Every npm dependency must have a locked version.');
    requireValue(text(entry.resolved) && text(entry.integrity), 'Missing npm resolved/integrity evidence.');
    const source = new URL(entry.resolved);
    requireValue(source.protocol === 'https:' && !source.username && !source.password, 'Unapproved npm lock source.');
    // Legacy sha1 SRI exists in the approved feed lock; this scan does not verify tarball bytes.
    requireValue(/^sha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity), 'Invalid npm lock integrity.');
    const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    requireValue(text(name), 'Missing npm package name.');
    inventory.set(path, { name, version: entry.version });
  }
  requireValue(inventory.size > 0, 'Empty npm inventory.');
  return inventory;
}

export function evaluateFindings(findings, exceptions) {
  const blocked = [];
  const waived = [];
  for (const finding of findings) {
    requireValue(SEVERITIES.includes(finding.severity), 'Unknown vulnerability severity.');
    if (!['high', 'critical'].includes(finding.severity)) continue;
    const exception = exceptions.find((entry) => entry.ecosystem === finding.ecosystem
      && entry.package === finding.package && entry.version === finding.version
      && entry.advisoryId === finding.id && entry.severity === finding.severity);
    (exception ? waived : blocked).push(finding);
  }
  return { status: blocked.length ? 'FAIL' : 'PASS', blocked, waived };
}

export function evaluateNpmAudit(report, inventory, exceptions = []) {
  requireValue(isObject(report) && report.auditReportVersion === 2 && !Object.hasOwn(report, 'error'), 'Invalid or failed npm audit report.');
  requireValue(isObject(report.vulnerabilities) && isObject(report.metadata?.vulnerabilities), 'Missing npm vulnerability coverage.');
  requireValue(report.metadata?.dependencies?.total === inventory.size, 'npm audit dependency coverage does not match the lock.');
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  const findings = [];
  const visiting = new Set();
  const checked = new Set();
  function check(name) {
    requireValue(!visiting.has(name), 'Cyclic npm advisory references.');
    if (checked.has(name)) return report.vulnerabilities[name].severity;
    const entry = report.vulnerabilities[name];
    requireValue(isObject(entry) && entry.name === name && SEVERITIES.includes(entry.severity), 'Unknown npm vulnerability severity or package.');
    requireValue(Array.isArray(entry.nodes) && entry.nodes.length > 0 && new Set(entry.nodes).size === entry.nodes.length, 'Missing npm affected package paths.');
    requireValue(Array.isArray(entry.via) && entry.via.length > 0, 'Missing npm advisory evidence.');
    for (const path of entry.nodes) requireValue(inventory.get(path)?.name === name, 'npm affected package is not in the lock.');
    visiting.add(name);
    for (const via of entry.via) {
      if (typeof via === 'string') {
        requireValue(Object.hasOwn(report.vulnerabilities, via), 'Missing transitive npm advisory.');
        requireValue(SEVERITIES.indexOf(check(via)) <= SEVERITIES.indexOf(entry.severity), 'Inconsistent npm transitive severity.');
        continue;
      }
      requireValue(isObject(via) && via.name === name && Number.isSafeInteger(via.source) && via.source > 0 && SEVERITIES.includes(via.severity), 'Invalid npm advisory.');
      requireValue(SEVERITIES.indexOf(via.severity) <= SEVERITIES.indexOf(entry.severity), 'Inconsistent npm advisory severity.');
      requireValue(text(via.url), 'Missing npm advisory URL.');
      const url = new URL(via.url);
      requireValue(url.protocol === 'https:' && !url.username && !url.password, 'Invalid npm advisory URL.');
      const candidate = url.pathname.split('/').at(-1);
      const id = url.hostname === 'github.com' && url.pathname.startsWith('/advisories/') && GHSA.test(candidate) ? candidate : `npm:${via.source}`;
      for (const path of entry.nodes) {
        findings.push({ ecosystem: 'npm', package: name, version: inventory.get(path).version, id, severity: via.severity, url: via.url, path });
      }
    }
    visiting.delete(name);
    checked.add(name);
    counts[entry.severity] += 1;
    return entry.severity;
  }
  for (const name of Object.keys(report.vulnerabilities)) check(name);
  const metadata = report.metadata.vulnerabilities;
  requireValue(SEVERITIES.every((severity) => Number.isSafeInteger(metadata[severity]) && metadata[severity] === counts[severity]) && metadata.total === checked.size, 'Inconsistent npm vulnerability counts.');
  // A package-level High must not disappear through lower-severity via records.
  for (const entry of Object.values(report.vulnerabilities)) {
    const maximum = Math.max(...entry.via.map((via) => SEVERITIES.indexOf(typeof via === 'string' ? report.vulnerabilities[via].severity : via.severity)));
    requireValue(maximum === SEVERITIES.indexOf(entry.severity), 'npm package severity lacks matching advisory evidence.');
  }
  return { ...evaluateFindings(findings, exceptions), dependencyCount: inventory.size, findings };
}

export function auditNpmDependencies({ repositoryRoot, npmCliPath, run = spawnSync, clock = () => new Date() }) {
  requireValue(/^24\.19\./.test(process.versions.node), 'Node 24.19.x is required.');
  requireValue(isAbsolute(npmCliPath) && /[\\/]npm-cli\.js$/.test(npmCliPath), 'Provide an absolute path to the approved npm-cli.js.');
  const inputs = ['package.json', 'package-lock.json', 'docs/security-vulnerability-policy.md'];
  const before = inputs.map((path) => readFileSync(resolve(repositoryRoot, path)));
  const startedAt = clock();
  const exceptions = readExceptions(before[2].toString('utf8'), startedAt);
  const inventory = npmInventory(JSON.parse(before[1]), JSON.parse(before[0]));
  const options = { cwd: repositoryRoot, encoding: 'utf8', shell: false, windowsHide: true, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 };
  try {
    const version = run(process.execPath, [npmCliPath, '--version'], { ...options, timeout: 30_000 });
    requireValue(!version.error && version.status === 0 && version.stdout.trim() === '12.0.0', 'The approved npm 12.0.0 is required; no fallback is allowed.');
    const args = [npmCliPath, 'audit', '--json', '--audit=true', '--offline=false', '--prefer-online', '--audit-level=high', '--package-lock-only', '--ignore-scripts', '--include=prod', '--include=dev', '--include=optional', '--include=peer', '--fetch-retries=0', '--fetch-timeout=30000'];
    const audit = run(process.execPath, args, options);
    requireValue(!audit.error && [0, 1].includes(audit.status), 'npm audit execution failed or timed out.');
    const rawReport = JSON.parse(audit.stdout);
    const result = evaluateNpmAudit(rawReport, inventory, exceptions);
    const expectedExit = Object.values(rawReport.vulnerabilities).some((entry) => ['high', 'critical'].includes(entry.severity)) ? 1 : 0;
    requireValue(audit.status === expectedExit, 'npm audit exit code and report disagree.');
    const completedAt = clock();
    readExceptions(before[2].toString('utf8'), completedAt);
    return { schemaVersion: 1, scope: 'C1', ...result, auditedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), tool: { name: 'npm', version: '12.0.0', exitCode: audit.status }, inputs: Object.fromEntries(inputs.map((path, index) => [path, SHA256(before[index])])), rawReportSha256: SHA256(audit.stdout), rawReport };
  } finally {
    requireValue(inputs.every((path, index) => readFileSync(resolve(repositoryRoot, path)).equals(before[index])), 'npm audit inputs changed during the scan.');
  }
}

export function auditPythonDependencies({ repositoryRoot, run = spawnSync, exceptions = [] }) {
  const python = resolve(repositoryRoot, 'ml/.venv/Scripts/python.exe');
  const script = resolve(repositoryRoot, 'scripts/security/audit-python.py');
  const child = run(python, ['-I', script], {
    cwd: resolve(repositoryRoot, 'ml'), encoding: 'utf8', shell: false,
    windowsHide: true, timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
  });
  requireValue(!child.error && child.status === 0, 'Python audit collection failed or timed out; no partial PASS.');
  const collection = JSON.parse(child.stdout);
  requireValue(isObject(collection) && collection.schemaVersion === 1 && collection.scope === 'C2' && collection.status === 'COLLECTED', 'Invalid Python audit collection.');
  requireValue(collection.tool?.name === 'pip-audit' && collection.tool.version === '2.10.1' && collection.tool.uv === '0.12.9', 'Unapproved Python audit tool.');
  requireValue(Array.isArray(collection.inventory) && collection.inventory.length > 0 && collection.dependencyCount === collection.inventory.length, 'Missing Python inventory coverage.');
  const inventory = new Map();
  for (const item of collection.inventory) {
    requireValue(isObject(item) && text(item.name) && text(item.version) && text(item.auditVersion) && !inventory.has(item.name), 'Invalid Python inventory item.');
    inventory.set(item.name, item);
  }
  const dependencies = collection.rawReport?.dependencies;
  requireValue(Array.isArray(dependencies) && dependencies.length === inventory.size && Array.isArray(collection.rawReport.fixes) && collection.rawReport.fixes.length === 0 && !Object.hasOwn(collection.rawReport, 'error'), 'Missing Python raw report coverage.');
  requireValue(Array.isArray(collection.severityEvidence), 'Missing Python severity evidence.');
  const evidence = new Map();
  for (const item of collection.severityEvidence) {
    const advisory = item?.advisory;
    requireValue(isObject(advisory) && text(advisory.ghsa_id) && GHSA.test(advisory.ghsa_id) && !evidence.has(advisory.ghsa_id), 'Invalid or duplicate severity evidence.');
    requireValue(item.url === `https://api.github.com/advisories/${advisory.ghsa_id}` && /^[a-f0-9]{64}$/.test(item.sha256 ?? ''), 'Invalid Python evidence source.');
    requireValue(advisory.type === 'reviewed' && text(advisory.github_reviewed_at) && Number.isFinite(Date.parse(advisory.github_reviewed_at)) && Object.hasOwn(advisory, 'withdrawn_at') && advisory.withdrawn_at === null, 'Unreviewed or withdrawn Python evidence.');
    requireValue(['low', 'medium', 'high', 'critical'].includes(advisory.severity) && Array.isArray(advisory.vulnerabilities), 'Unknown Python evidence severity.');
    evidence.set(advisory.ghsa_id, advisory);
  }
  const seen = new Set();
  const expectedFindings = [];
  const findingKey = (finding) => JSON.stringify([
    finding.ecosystem, finding.package, finding.version, finding.auditVersion,
    finding.id, finding.severity, finding.aliases, finding.fixVersions, finding.url,
  ]);
  for (const item of dependencies) {
    requireValue(isObject(item) && !Object.hasOwn(item, 'skip_reason') && inventory.get(item.name)?.auditVersion === item.version && !seen.has(item.name) && Array.isArray(item.vulns), 'Incomplete Python dependency report.');
    seen.add(item.name);
    for (const raw of item.vulns) {
      requireValue(isObject(raw) && text(raw.id) && Array.isArray(raw.aliases) && raw.aliases.every(text) && Array.isArray(raw.fix_versions) && raw.fix_versions.every(text), 'Invalid Python raw vulnerability.');
      const aliases = [...new Set([raw.id, ...raw.aliases])].sort();
      const ghsas = aliases.filter((id) => GHSA.test(id));
      requireValue(ghsas.length > 0, 'Missing reviewed Python advisory.');
      let selected;
      let severity;
      for (const id of ghsas) {
        const advisory = evidence.get(id);
        requireValue(advisory && advisory.vulnerabilities.some((v) => v?.package?.ecosystem === 'pip' && text(v.package.name) && v.package.name.toLowerCase().replace(/[-_.]+/g, '-') === item.name), 'Python advisory is missing or belongs to another package.');
        const rank = advisory.severity === 'medium' ? 'moderate' : advisory.severity;
        if (selected === undefined || SEVERITIES.indexOf(rank) > SEVERITIES.indexOf(severity)) { selected = id; severity = rank; }
      }
      expectedFindings.push(findingKey({ ecosystem: 'pypi', package: item.name, version: inventory.get(item.name).version, auditVersion: item.version, id: selected, severity, aliases, fixVersions: raw.fix_versions, url: `https://api.github.com/advisories/${selected}` }));
    }
  }
  requireValue(Array.isArray(collection.findings) && collection.findings.length === expectedFindings.length, 'Python findings and raw report disagree.');
  for (const finding of collection.findings) {
    requireValue(isObject(finding) && finding.ecosystem === 'pypi' && inventory.get(finding.package)?.version === finding.version && inventory.get(finding.package)?.auditVersion === finding.auditVersion && GHSA.test(finding.id), 'Invalid normalized Python finding.');
  }
  requireValue(JSON.stringify(collection.findings.map(findingKey).sort()) === JSON.stringify(expectedFindings.sort()), 'Python findings do not match raw advisories and reviewed severity.');
  requireValue(collection.tool.exitCode === (expectedFindings.length ? 1 : 0), 'Python audit exit code and report disagree.');
  for (const path of ['ml/pyproject.toml', 'ml/uv.lock']) {
    requireValue(collection.inputs?.[path] === SHA256(readFileSync(resolve(repositoryRoot, path))), 'Python collector audited different input bytes.');
  }
  return { ...collection, ...evaluateFindings(collection.findings, exceptions), collectionSha256: SHA256(child.stdout) };
}

export function auditDependencies({ repositoryRoot, npmCliPath, scope = 'release', run = spawnSync, clock = () => new Date() }) {
  requireValue(['npm', 'packages', 'release'].includes(scope), 'Unknown audit scope.');
  if (scope === 'npm') return auditNpmDependencies({ repositoryRoot, npmCliPath, run, clock });
  const paths = ['package.json', 'package-lock.json', 'ml/pyproject.toml', 'ml/uv.lock', 'docs/security-vulnerability-policy.md', 'scripts/security/audit-dependencies.mjs', 'scripts/security/audit-python.py'];
  const before = new Map(paths.map((path) => [path, readFileSync(resolve(repositoryRoot, path))]));
  const startedAt = clock();
  const policy = before.get('docs/security-vulnerability-policy.md').toString('utf8');
  const exceptions = readExceptions(policy, startedAt);
  const scopes = {};
  try {
    for (const [name, collect] of [
      ['C1', () => auditNpmDependencies({ repositoryRoot, npmCliPath, run, clock })],
      ['C2', () => auditPythonDependencies({ repositoryRoot, run, exceptions })],
    ]) {
      try { scopes[name] = collect(); }
      catch (error) { scopes[name] = { scope: name, status: 'BLOCKED', error: error instanceof Error ? error.message : 'Collection failed.' }; }
    }
    if (scope === 'release') {
      // LIC-01 has not produced the final native component/advisory mapping yet.
      // This is an explicit blocker, not an empty native scan or a waiver.
      scopes.C3 = { scope: 'C3', status: 'BLOCKED', reason: 'native-inventory-and-advisory-coverage-not-verified', requiredTasks: ['LIC-01', 'SEC08-D', 'PKG-14'] };
    }
    const completedAt = clock();
    readExceptions(policy, completedAt);
    const results = Object.values(scopes);
    const status = results.some((result) => result.status === 'BLOCKED') ? 'BLOCKED'
      : results.some((result) => result.status === 'FAIL') ? 'FAIL' : 'PASS';
    return { schemaVersion: 1, scope: scope === 'release' ? 'C1+C2+C3' : 'C1+C2', status, auditedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), releaseReady: false, scopes, inputs: Object.fromEntries([...before].map(([path, bytes]) => [path, SHA256(bytes)])) };
  } finally {
    requireValue([...before].every(([path, bytes]) => readFileSync(resolve(repositoryRoot, path)).equals(bytes)), 'Audit inputs or collector source changed during the scan.');
  }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryPath === import.meta.url) {
  try {
    requireValue([4, 6].includes(process.argv.length) && process.argv[2] === '--npm-cli' && (process.argv.length === 4 || process.argv[4] === '--scope'), 'Usage: node scripts/security/audit-dependencies.mjs --npm-cli <absolute npm-cli.js path> [--scope npm|packages|release]');
    const repositoryRoot = process.cwd();
    const result = auditDependencies({ repositoryRoot, npmCliPath: process.argv[3], scope: process.argv[5] ?? 'release' });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'PASS' ? 0 : result.status === 'FAIL' ? 1 : 2;
  } catch (error) {
    console.error(JSON.stringify({ schemaVersion: 1, status: 'BLOCKED', error: error instanceof Error ? error.message : 'Audit failed.' }));
    process.exitCode = 2;
  }
}