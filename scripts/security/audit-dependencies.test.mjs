import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { auditDependencies, auditNpmDependencies, auditPythonDependencies, evaluateFindings, evaluateNpmAudit, npmInventory, readExceptions } from './audit-dependencies.mjs';

const manifest = { name: 'fixture', version: '0.1.0', dependencies: { example: '1.0.0' } };
const lockFixture = () => ({ lockfileVersion: 3, version: '0.1.0', packages: { '': structuredClone(manifest), 'node_modules/example': { version: '1.0.0', resolved: 'https://registry.example/example.tgz', integrity: 'sha512-YQ==' } } });
const clean = () => ({ auditReportVersion: 2, vulnerabilities: {}, metadata: { dependencies: { total: 1 }, vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } });
const advisory = (severity = 'high') => ({ source: 123, name: 'example', severity, url: 'https://github.com/advisories/GHSA-h35f-9h28-mq5c' });
function vulnerable(severity = 'high') {
  const report = clean();
  report.vulnerabilities.example = { name: 'example', severity, nodes: ['node_modules/example'], via: [advisory(severity)] };
  report.metadata.vulnerabilities[severity] = 1;
  report.metadata.vulnerabilities.total = 1;
  return report;
}
const inventory = () => npmInventory(lockFixture(), manifest);
const now = new Date('2026-09-12T12:00:00.000Z');
const exception = () => ({ ecosystem: 'npm', package: 'example', version: '1.0.0', advisoryId: advisory().url.split('/').at(-1), cve: 'CVE-2026-59890', severity: 'high', rationale: 'Fixture rationale only', mitigation: 'Fixture mitigation only', responsible: 'Fixture maintainer', approvedBy: 'Fixture reviewer', approvedOn: '2026-09-11', expiresOn: '2026-09-12', decision: 'Fixture review record; not a production approval' });
const register = (exceptions = []) => `<!-- vulnerability-exceptions:start -->\n\`\`\`json\n${JSON.stringify({ schemaVersion: 1, exceptions })}\n\`\`\`\n<!-- vulnerability-exceptions:end -->`;

test('current repository npm lock has a nonempty complete inventory', () => {
  const root = resolve(import.meta.dirname, '../..');
  assert.ok(npmInventory(JSON.parse(readFileSync(join(root, 'package-lock.json'))), JSON.parse(readFileSync(join(root, 'package.json')))).size > 0);
});
test('clean complete npm audit passes', () => {
  assert.equal(evaluateNpmAudit(clean(), inventory()).status, 'PASS');
});
test('reads legacy sha1 SRI from the approved lock without changing it', () => {
  const lock = lockFixture();
  lock.packages['node_modules/example'].integrity = 'sha1-tbcaJaTRavokglkt36YvzMYLx9E=';
  assert.equal(npmInventory(lock, manifest).size, 1);
  lock.packages['node_modules/example'].integrity = 'unknown-digest';
  assert.throws(() => npmInventory(lock, manifest));
});
for (const version of [['1.0.0'], '01.0.0', '1.0.0-.', '1.0.0-01', '^1.0.0', '1.x', 'latest', '1.0.0+.', '1.0.0\n']) {
  test(`rejects invalid exact npm version ${JSON.stringify(version)}`, () => {
    const lock = lockFixture(); lock.packages['node_modules/example'].version = version;
    assert.throws(() => npmInventory(lock, manifest));
    const item = exception(); item.version = version;
    assert.throws(() => readExceptions(register([item]), now));
  });
}
for (const version of ['0.0.0', '1.2.3-alpha.1+001', '1.0.0-0.3.7', '1.0.0-x-y-z.--']) {
  test(`accepts complete SemVer ${version}`, () => {
    const lock = lockFixture(); lock.packages['node_modules/example'].version = version;
    assert.equal(npmInventory(lock, manifest).size, 1);
    const item = exception(); item.version = version;
    assert.equal(readExceptions(register([item]), now).length, 1);
  });
}
for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
  test(`${severity} is retained and only unapproved high/critical fails`, () => {
    const result = evaluateNpmAudit(vulnerable(severity), inventory());
    assert.equal(result.findings.length, 1);
    assert.equal(result.status, ['high', 'critical'].includes(severity) ? 'FAIL' : 'PASS');
  });
}
for (const [name, mutate] of [
  ['missing inventory coverage', (r) => { delete r.metadata.dependencies; }],
  ['partial dependency scan', (r) => { r.metadata.dependencies.total = 0; }],
  ['unsupported format', (r) => { r.auditReportVersion = 1; }],
  ['registry failure hidden by clean result', (r) => { r.error = { code: 'EAUDIT' }; }],
  ['unknown severity', (r) => { r.vulnerabilities.example.severity = 'unknown'; }],
  ['missing advisory', (r) => { r.vulnerabilities.example.via = []; }],
  ['unknown affected node', (r) => { r.vulnerabilities.example.nodes = ['node_modules/missing']; }],
  ['duplicate node', (r) => { r.vulnerabilities.example.nodes.push('node_modules/example'); }],
  ['incorrect counts', (r) => { r.metadata.vulnerabilities.high = 0; }],
  ['fractional counts', (r) => { r.metadata.vulnerabilities.high = 0.5; }],
  ['missing transitive advisory', (r) => { r.vulnerabilities.example.via = ['missing']; }],
  ['cyclic transitive advisory', (r) => { r.vulnerabilities.example.via = ['example']; }],
  ['downgraded advisory', (r) => { r.vulnerabilities.example.via[0].severity = 'critical'; }],
  ['high with only low evidence', (r) => { r.vulnerabilities.example.via[0].severity = 'low'; }],
  ['advisory without source', (r) => { delete r.vulnerabilities.example.via[0].source; }],
  ['wrong advisory package', (r) => { r.vulnerabilities.example.via[0].name = 'other'; }],
  ['insecure advisory URL', (r) => { r.vulnerabilities.example.via[0].url = 'http://example.test'; }],
]) {
  test(`rejects ${name}`, () => {
    const report = vulnerable();
    mutate(report);
    assert.throws(() => evaluateNpmAudit(report, inventory()));
  });
}
for (const field of ['version', 'resolved', 'integrity']) {
  test(`rejects missing locked ${field}`, () => {
    const lock = lockFixture(); delete lock.packages['node_modules/example'][field];
    assert.throws(() => npmInventory(lock, manifest));
  });
}
test('rejects stale root dependencies, empty inventory and link packages', () => {
  const lock = lockFixture(); lock.packages[''].dependencies.example = '2.0.0';
  assert.throws(() => npmInventory(lock, manifest));
  assert.throws(() => npmInventory({ ...lockFixture(), packages: { '': manifest } }, manifest));
  const linked = lockFixture(); linked.packages['node_modules/example'].link = true;
  assert.throws(() => npmInventory(linked, manifest));
});
test('transitive advisory fails until actual vulnerable component is waived', () => {
  const inv = inventory(); inv.set('node_modules/parent', { name: 'parent', version: '2.0.0' });
  const report = vulnerable();
  report.vulnerabilities.parent = { name: 'parent', severity: 'high', nodes: ['node_modules/parent'], via: ['example'] };
  report.metadata.dependencies.total = 2; report.metadata.vulnerabilities.high = 2; report.metadata.vulnerabilities.total = 2;
  assert.equal(evaluateNpmAudit(report, inv).blocked.length, 1);
  assert.equal(evaluateNpmAudit(report, inv, readExceptions(register([exception()]), now)).status, 'PASS');
});
test('exceptions are scoped to exact package/version/ecosystem/advisory/severity', () => {
  for (const field of ['package', 'version', 'ecosystem', 'advisoryId', 'severity']) {
    const item = exception(); item[field] = 'different';
    assert.equal(evaluateNpmAudit(vulnerable(), inventory(), [item]).status, 'FAIL');
  }
  assert.equal(evaluateNpmAudit(vulnerable('critical'), inventory(), [exception()]).status, 'FAIL');
});
test('exception expires at the next UTC midnight, never local time', () => {
  assert.equal(readExceptions(register([exception()]), new Date('2026-09-12T23:59:59.999Z')).length, 1);
  assert.throws(() => readExceptions(register([exception()]), new Date('2026-09-13T00:00:00.000Z')), /Expired/);
});
for (const [name, change] of [
  ['future approval', (e) => { e.approvedOn = '2026-09-13'; }],
  ['invalid calendar date', (e) => { e.expiresOn = '2026-02-30'; }],
  ['range version', (e) => { e.version = '>=1.0.0'; }],
  ['missing owner', (e) => { delete e.responsible; }],
  ['placeholder approval', (e) => { e.approvedBy = 'TBD'; }],
  ['missing CVE', (e) => { e.cve = ''; }],
  ['unknown field', (e) => { e.expires = '2099-01-01'; }],
]) {
  test(`rejects exception with ${name}`, () => {
    const item = exception(); change(item);
    assert.throws(() => readExceptions(register([item]), now));
  });
}
test('rejects missing/duplicate register and duplicate exceptions', () => {
  assert.deepEqual(readExceptions(register(), now), []);
  assert.throws(() => readExceptions('', now));
  assert.throws(() => readExceptions(register() + register(), now));
  assert.throws(() => readExceptions(register([exception(), exception()]), now));
  const reversed = '<!-- vulnerability-exceptions:end -->\n' + register().replace('<!-- vulnerability-exceptions:end -->', '');
  assert.throws(() => readExceptions(reversed, now));
});
test('unknown normalized finding severity blocks', () => {
  assert.throws(() => evaluateFindings([{ severity: 'unknown' }], []));
});

function runFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), 'autovision-audit-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lockFixture()));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/security-vulnerability-policy.md'), register());
  try { callback(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
test('runner pins npm and explicitly includes dev/optional/peer without fix/install/shell', () => {
  runFixture((root) => {
    const calls = [];
    const result = auditNpmDependencies({ repositoryRoot: root, npmCliPath: join(root, 'npm-cli.js'), run: (program, args, options) => {
      calls.push(args);
      assert.equal(program, process.execPath); assert.equal(options.shell, false); assert.equal(options.cwd, root);
      return { status: 0, stdout: args.includes('--version') ? '12.0.0\n' : JSON.stringify(clean()) };
    } });
    assert.equal(result.scope, 'C1'); assert.equal(result.status, 'PASS'); assert.match(result.rawReportSha256, /^[a-f0-9]{64}$/);
    for (const flag of ['--package-lock-only', '--ignore-scripts', '--audit=true', '--offline=false', '--prefer-online', '--include=prod', '--include=dev', '--include=optional', '--include=peer']) assert.ok(calls[1].includes(flag));
    assert.match(result.inputs['docs/security-vulnerability-policy.md'], /^[a-f0-9]{64}$/);
    assert.ok(!calls.flat().includes('fix')); assert.ok(!calls.flat().includes('install'));
  });
});
test('wrong npm version stops before the audit without fallback', () => {
  runFixture((root) => {
    let count = 0;
    assert.throws(() => auditNpmDependencies({ repositoryRoot: root, npmCliPath: join(root, 'npm-cli.js'), run: () => { count++; return { status: 0, stdout: '11.17.0' }; } }), /12\.0\.0/);
    assert.equal(count, 1);
  });
});
for (const [name, output] of [
  ['timeout', { error: new Error('timeout'), status: null, stdout: '' }],
  ['non-audit error', { status: 2, stdout: '{}' }],
  ['malformed output', { status: 0, stdout: '{' }],
  ['error disguised as clean', { status: 1, stdout: JSON.stringify(clean()) }],
  ['high disguised as success', { status: 0, stdout: JSON.stringify(vulnerable()) }],
]) {
  test(`runner rejects ${name}`, () => runFixture((root) => {
    assert.throws(() => auditNpmDependencies({ repositoryRoot: root, npmCliPath: join(root, 'npm-cli.js'), run: (_p, args) => args.includes('--version') ? { status: 0, stdout: '12.0.0' } : output }));
  }));
}
test('runner does not convert High to tool failure and retains exit code', () => runFixture((root) => {
  const result = auditNpmDependencies({ repositoryRoot: root, npmCliPath: join(root, 'npm-cli.js'), run: (_p, args) => args.includes('--version') ? { status: 0, stdout: '12.0.0' } : { status: 1, stdout: JSON.stringify(vulnerable()) } });
  assert.equal(result.status, 'FAIL'); assert.equal(result.tool.exitCode, 1);
}));
test('runner refuses a scan whose lock changed', () => runFixture((root) => {
  assert.throws(() => auditNpmDependencies({ repositoryRoot: root, npmCliPath: join(root, 'npm-cli.js'), run: (_p, args) => {
    if (args.includes('--version')) return { status: 0, stdout: '12.0.0' };
    writeFileSync(join(root, 'package-lock.json'), '{}');
    return { status: 0, stdout: JSON.stringify(clean()) };
  } }), /changed/);
}));
test('revoking an exception during the audit blocks publication of a PASS', () => runFixture((root) => {
  const policy = join(root, 'docs/security-vulnerability-policy.md');
  writeFileSync(policy, register([exception()]));
  assert.throws(() => auditNpmDependencies({ repositoryRoot: root, npmCliPath: join(root, 'npm-cli.js'), clock: () => now, run: (_p, args) => {
    if (args.includes('--version')) return { status: 0, stdout: '12.0.0' };
    writeFileSync(policy, register());
    return { status: 1, stdout: JSON.stringify(vulnerable()) };
  } }), /changed/);
}));
test('exception still valid at completion can waive a High, but expiring in flight cannot', () => runFixture((root) => {
  writeFileSync(join(root, 'docs/security-vulnerability-policy.md'), register([exception()]));
  const options = { repositoryRoot: root, npmCliPath: join(root, 'npm-cli.js'), run: (_p, args) => args.includes('--version') ? { status: 0, stdout: '12.0.0' } : { status: 1, stdout: JSON.stringify(vulnerable()) } };
  assert.equal(auditNpmDependencies({ ...options, clock: () => now }).waived.length, 1);
  const times = [now, new Date('2026-09-13T00:00:00Z')];
  assert.throws(() => auditNpmDependencies({ ...options, clock: () => times.shift() }), /Expired/);
}));
test('explicit audit flags override offline and disabled-audit environment configuration', () => runFixture((root) => {
  const result = auditNpmDependencies({ repositoryRoot: root, npmCliPath: join(root, 'npm-cli.js'), run: (_p, args) => {
    if (args.includes('--version')) return { status: 0, stdout: '12.0.0' };
    const effectiveOffline = !args.includes('--offline=false');
    const effectiveAudit = args.includes('--audit=true');
    return { status: effectiveOffline || !effectiveAudit ? 0 : 1, stdout: JSON.stringify(effectiveOffline || !effectiveAudit ? clean() : vulnerable()) };
  } });
  assert.equal(result.status, 'FAIL');
}));

const digest = (data) => createHash('sha256').update(data).digest('hex');
function withCollection(callback) {
  runFixture((root) => {
    mkdirSync(join(root, 'ml'));
    mkdirSync(join(root, 'scripts/security'), { recursive: true });
    for (const path of ['ml/pyproject.toml', 'ml/uv.lock', 'scripts/security/audit-dependencies.mjs', 'scripts/security/audit-python.py']) writeFileSync(join(root, path), 'fixture');
    const collection = {
      schemaVersion: 1, scope: 'C2', status: 'COLLECTED',
      tool: { name: 'pip-audit', version: '2.10.1', exitCode: 0, uv: '0.12.9' },
      dependencyCount: 1, inventory: [{ name: 'example', version: '1.0.0', auditVersion: '1.0.0' }],
      rawReport: { dependencies: [{ name: 'example', version: '1.0.0', vulns: [] }], fixes: [] },
      findings: [], severityEvidence: [], inputs: { 'ml/pyproject.toml': digest('fixture'), 'ml/uv.lock': digest('fixture') },
    };
    const run = (_program, args, options) => {
      if (args.includes('--version')) return { status: 0, stdout: '12.0.0' };
      if (args.includes('audit')) return { status: 0, stdout: JSON.stringify(clean()) };
      assert.deepEqual(args, ['-I', join(root, 'scripts/security/audit-python.py')]);
      assert.equal(options.cwd, join(root, 'ml'));
      assert.equal(options.shell, false);
      return { status: 0, stdout: JSON.stringify(collection) };
    };
    callback({ root, collection, run, options: { repositoryRoot: root, npmCliPath: join(root, 'npm-cli.js'), run, clock: () => now } });
  });
}
function highCollection(collection) {
  const id = advisory().url.split('/').at(-1);
  const aliases = ['CVE-2026-59890', id];
  const url = `https://api.github.com/advisories/${id}`;
  collection.tool.exitCode = 1;
  collection.rawReport.dependencies[0].vulns = [{ id, aliases: [aliases[0]], fix_versions: ['2.0.0'] }];
  collection.findings = [{ ecosystem: 'pypi', package: 'example', version: '1.0.0', auditVersion: '1.0.0', id, aliases, severity: 'high', fixVersions: ['2.0.0'], url }];
  collection.severityEvidence = [{ url, sha256: 'a'.repeat(64), advisory: { ghsa_id: id, type: 'reviewed', github_reviewed_at: '2026-09-01T00:00:00Z', withdrawn_at: null, severity: 'high', vulnerabilities: [{ package: { ecosystem: 'pip', name: 'example' } }] } }];
}
test('packages scope gates both ecosystems without claiming native/release readiness', () => withCollection(({ options }) => {
  const result = auditDependencies({ ...options, scope: 'packages' });
  assert.equal(result.status, 'PASS'); assert.equal(result.releaseReady, false);
  assert.deepEqual(Object.keys(result.scopes), ['C1', 'C2']);
}));
test('default release scope remains BLOCKED even when both package scopes pass', () => withCollection(({ options }) => {
  const result = auditDependencies(options);
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.scopes.C1.status, 'PASS'); assert.equal(result.scopes.C2.status, 'PASS');
  assert.equal(result.scopes.C3.reason, 'native-inventory-and-advisory-coverage-not-verified');
}));
test('Python High fails without a precise approved exception', () => withCollection(({ collection, options }) => {
  highCollection(collection);
  assert.equal(auditDependencies({ ...options, scope: 'packages' }).status, 'FAIL');
}));
test('Python uses the same exception register and keeps collector High exit evidence', () => withCollection(({ root, collection, options }) => {
  highCollection(collection);
  writeFileSync(join(root, 'docs/security-vulnerability-policy.md'), register([{ ...exception(), ecosystem: 'pypi' }]));
  const result = auditDependencies({ ...options, scope: 'packages' });
  assert.equal(result.status, 'PASS'); assert.equal(result.scopes.C2.waived.length, 1); assert.equal(result.scopes.C2.tool.exitCode, 1);
}));
for (const [name, mutate] of [
  ['wrong scope', (c) => { c.scope = 'C1'; }],
  ['partial collector', (c) => { c.status = 'BLOCKED'; }],
  ['unapproved tool', (c) => { c.tool.version = '3.0.0'; }],
  ['missing inventory', (c) => { c.inventory = []; }],
  ['duplicate inventory', (c) => { c.inventory.push(c.inventory[0]); c.dependencyCount++; }],
  ['missing dependency', (c) => { c.rawReport.dependencies = []; }],
  ['skipped dependency', (c) => { c.rawReport.dependencies[0].skip_reason = 'missing'; }],
  ['wrong audited version', (c) => { c.rawReport.dependencies[0].version = '2.0.0'; }],
  ['missing finding', (c) => { highCollection(c); c.findings = []; }],
  ['unknown severity', (c) => { highCollection(c); c.findings[0].severity = 'unknown'; }],
  ['input mismatch', (c) => { c.inputs['ml/uv.lock'] = '0'.repeat(64); }],
  ['wrong exit', (c) => { c.tool.exitCode = 1; }],
]) {
  test(`Python boundary rejects ${name}`, () => withCollection(({ root, collection, run }) => {
    mutate(collection);
    assert.throws(() => auditPythonDependencies({ repositoryRoot: root, run }));
  }));
}
test('failed Python process cannot publish a partial successful JSON', () => withCollection(({ root, collection }) => {
  assert.throws(() => auditPythonDependencies({ repositoryRoot: root, run: () => ({ status: 2, stdout: JSON.stringify(collection) }) }));
}));
for (const [name, mutate] of [
  ['severity downgrade', (c) => { c.findings[0].severity = 'low'; }],
  ['missing evidence', (c) => { c.severityEvidence = []; }],
  ['duplicate evidence', (c) => { c.severityEvidence.push(c.severityEvidence[0]); }],
  ['unreviewed evidence', (c) => { c.severityEvidence[0].advisory.type = 'unreviewed'; }],
  ['withdrawn evidence', (c) => { c.severityEvidence[0].advisory.withdrawn_at = '2026-09-12'; }],
  ['wrong evidence package', (c) => { c.severityEvidence[0].advisory.vulnerabilities[0].package.name = 'other'; }],
  ['wrong raw alias', (c) => { c.rawReport.dependencies[0].vulns[0].aliases = ['CVE-2026-99999']; }],
  ['missing fix evidence', (c) => { c.findings[0].fixVersions = []; }],
  ['switched target package', (c) => {
    c.inventory.push({ name: 'other', version: '1.0.0', auditVersion: '1.0.0' }); c.dependencyCount++;
    c.rawReport.dependencies.push({ name: 'other', version: '1.0.0', vulns: [] }); c.findings[0].package = 'other';
  }],
]) {
  test(`Python advisory binding rejects ${name}`, () => withCollection(({ collection, options }) => {
    highCollection(collection); mutate(collection);
    const result = auditDependencies({ ...options, scope: 'packages' });
    assert.equal(result.status, 'BLOCKED'); assert.equal(result.scopes.C2.status, 'BLOCKED');
  }));
}
test('multiplicity binding forbids replacing a High record with a duplicate Low', () => withCollection(({ root, collection, run }) => {
  highCollection(collection);
  const lowId = 'GHSA-2345-6789-cfgh';
  const lowUrl = `https://api.github.com/advisories/${lowId}`;
  collection.severityEvidence.push({ url: lowUrl, sha256: 'b'.repeat(64), advisory: { ...collection.severityEvidence[0].advisory, ghsa_id: lowId, severity: 'low' } });
  collection.rawReport.dependencies[0].vulns.push({ id: lowId, aliases: [], fix_versions: [] });
  const low = { ...collection.findings[0], id: lowId, aliases: [lowId], severity: 'low', fixVersions: [], url: lowUrl };
  collection.findings.push(low);
  assert.equal(auditPythonDependencies({ repositoryRoot: root, run }).status, 'FAIL');
  collection.findings = [low, low];
  assert.throws(() => auditPythonDependencies({ repositoryRoot: root, run }), /reviewed severity/);
}));
test('all aliases use the maximum reviewed severity and duplicate raw records are retained', () => withCollection(({ root, collection, run }) => {
  highCollection(collection);
  const lowId = 'GHSA-2345-6789-cfgh';
  const lowUrl = `https://api.github.com/advisories/${lowId}`;
  collection.severityEvidence.push({ url: lowUrl, sha256: 'b'.repeat(64), advisory: { ...collection.severityEvidence[0].advisory, ghsa_id: lowId, severity: 'low' } });
  collection.rawReport.dependencies[0].vulns[0].aliases.push(lowId);
  collection.findings[0].aliases.push(lowId); collection.findings[0].aliases.sort();
  assert.equal(auditPythonDependencies({ repositoryRoot: root, run }).status, 'FAIL');
  collection.rawReport.dependencies[0].vulns.push(structuredClone(collection.rawReport.dependencies[0].vulns[0]));
  collection.findings.push(structuredClone(collection.findings[0]));
  assert.equal(auditPythonDependencies({ repositoryRoot: root, run }).blocked.length, 2);
  collection.findings.forEach((f) => { f.id = lowId; f.severity = 'low'; f.url = lowUrl; });
  assert.throws(() => auditPythonDependencies({ repositoryRoot: root, run }), /reviewed severity/);
}));
for (const path of ['ml/uv.lock', 'docs/security-vulnerability-policy.md', 'scripts/security/audit-python.py', 'scripts/security/audit-dependencies.mjs']) {
  test(`whole audit refuses in-flight change to ${path}`, () => withCollection(({ root, options, run }) => {
    assert.throws(() => auditDependencies({ ...options, scope: 'packages', run: (p, args, opts) => {
      const result = run(p, args, opts);
      if (args[0] === '-I') writeFileSync(join(root, path), 'changed');
      return result;
    } }), /changed/);
  }));
}