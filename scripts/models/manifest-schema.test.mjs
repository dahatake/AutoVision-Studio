import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

// A-07: schema-only regression tests, not a production license/release verifier.
// All model entries below are UNPUBLISHED SYNTHETIC fixtures. Their approval
// status, permissions, hashes, byte sizes, paths and notices are fabricated test
// inputs, not real weights, license evidence, sign-offs or release-readiness
// claims. Fixture paths/URLs are never created, read or fetched. The actual
// manifest is read-only and remains separate from these in-memory fixtures.
function readModelJson(name) {
  const filePath = fileURLToPath(
    new URL(`../../resources/models/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const schema = readModelJson('manifest.schema.json');

// strict:false relaxes Ajv's extra schema-authoring checks, not JSON Schema
// validation. The existing, standards-permitted if/then and else/not/required
// branches refer to properties defined outside those branches.
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });

// Test-only formats for the two formats actually used by this schema. This is
// not a general format plugin. Every current URI property also has ^https://.
ajv.addFormat('date', {
  type: 'string',
  validate(value) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
    try {
      // ISO parsing avoids Date.UTC's special interpretation of years 0..99.
      // Round-tripping rejects normalization of impossible calendar dates.
      return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
    } catch {
      return false;
    }
  },
});
ajv.addFormat('uri', {
  type: 'string',
  validate(value) {
    // WHATWG URL parsing repairs raw spaces, controls and backslashes.
    if (/[\s\u0000-\u001f\u007f-\u009f\\]/u.test(value)) return false;
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  },
});

const validate = ajv.compile(schema);
const roles = [
  ['C6', 'classification'],
  ['C6', 'detection'],
  ['C7', 'classification'],
  ['C7', 'detection'],
];

function assertValid(manifest, context = 'Expected structurally valid fixture') {
  const valid = validate(manifest);
  assert.equal(valid, true, `${context}\n${JSON.stringify(validate.errors, null, 2)}`);
}

function assertInvalid(manifest, keyword, instancePath, context = '') {
  const valid = validate(manifest);
  const errors = validate.errors ?? [];
  const message = `${context || `${keyword} at ${instancePath || '/'}`}\n${JSON.stringify(errors, null, 2)}`;
  assert.equal(valid, false, message);
  // A negative case must fail at the intended rule, not an unrelated bad field.
  assert.ok(
    errors.some((error) => error.keyword === keyword && error.instancePath === instancePath),
    message,
  );
}

function createSyntheticModel(category, task) {
  const id = `synthetic-${category.toLowerCase()}-${task}`;
  const license = {
    spdx: 'MIT',
    commercialUseConfirmed: true,
    redistributionPermitted: true,
    noticeText: 'UNPUBLISHED SYNTHETIC fixture text; not a license grant.',
  };
  const model = {
    id,
    category,
    task,
    name: `UNPUBLISHED SYNTHETIC ${category} ${task}`,
    version: 'synthetic-test-v1',
    downloadUrl: `https://example.invalid/synthetic/${id}/weights.onnx`,
    retrievedDate: '2024-02-29',
    sourcePath: `vendor/models/${id}/weights.onnx`,
    payloadPath: `resources/models/${id}/weights.onnx`,
    sha256: 'a'.repeat(64),
    byteSize: 1,
    format: 'onnx',
    licenses: {
      code: { ...license },
      checkpoint: { ...license },
      trainingData: [{
        datasetName: 'UNPUBLISHED SYNTHETIC dataset; no real samples',
        termsUrl: 'https://example.invalid/synthetic/dataset-terms',
        termsRetrievedDate: '2024-02-29',
        commercialDerivativesPermitted: true,
        redistributionConditions: 'Synthetic fixture text; not redistribution authorization.',
        attributionText: 'Synthetic fixture only.',
      }],
    },
    evidence: [{
      kind: 'model-card',
      sourceUrl: 'https://example.invalid/synthetic/model-card',
      localPath: 'docs/model-governance/synthetic-test/evidence.txt',
      sha256: 'b'.repeat(64),
      retrievedDate: '2024-02-29',
    }],
    approval: {
      recordPath: 'docs/model-governance/synthetic-test-adoption.md',
      status: 'Approved',
      approver: 'SYNTHETIC test approver; not a real sign-off',
      date: '2024-02-29',
    },
    intendedUse: {
      productUseInScope: true,
      outOfScopeProductionUse: false,
    },
    support: [
      { os: 'windows-x64', executionProvider: 'cpu', verified: true },
      { os: 'windows-x64', executionProvider: 'directml', verified: true },
    ],
  };
  if (category === 'C7') {
    model.inferenceConfig = {
      scoreMeaning: 'Synthetic uncalibrated score, not probability of correctness.',
      scoreRange: { minimum: 0, maximum: 1 },
      confidenceThreshold: 0.5,
      thresholdPolicy: 'synthetic-test-policy-v1; not real PoC evidence',
      deterministicInference: true,
      seeds: { synthetic: 42 },
    };
  }
  return model;
}

function createSyntheticManifest() {
  const manifest = {
    schemaVersion: '1.0.0',
    productVersion: '0.0.0',
    releaseStatus: {
      ready: true,
      reason: 'UNPUBLISHED SYNTHETIC structural fixture; no real approvals.',
    },
    models: roles.map(([category, task]) => createSyntheticModel(category, task)),
  };
  // Positive control before each mutation prevents an invalid baseline from
  // making every rejection test pass for the wrong reason.
  assertValid(manifest, 'The complete unmodified synthetic baseline must validate');
  return manifest;
}

const dateFields = [
  ['/models/0/retrievedDate', (model, value) => { model.retrievedDate = value; }],
  ['/models/0/licenses/trainingData/0/termsRetrievedDate', (model, value) => {
    model.licenses.trainingData[0].termsRetrievedDate = value;
  }],
  ['/models/0/evidence/0/retrievedDate', (model, value) => {
    model.evidence[0].retrievedDate = value;
  }],
  ['/models/0/approval/date', (model, value) => { model.approval.date = value; }],
];
const uriFields = [
  ['/models/0/downloadUrl', (model, value) => { model.downloadUrl = value; }],
  ['/models/0/licenses/trainingData/0/termsUrl', (model, value) => {
    model.licenses.trainingData[0].termsUrl = value;
  }],
  ['/models/0/evidence/0/sourceUrl', (model, value) => {
    model.evidence[0].sourceUrl = value;
  }],
];

test('compiles the current manifest schema as JSON Schema draft 2020-12', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors));
  assert.equal(typeof validate, 'function');
});

// The shipped manifest may only list entries whose adoption record reached the
// Approved verdict; changing it has to be a deliberate edit here as well.
const EXPECTED_APPROVED_ENTRIES = 2;

test('accepts the actual non-ready manifest with its current approved set', () => {
  const manifest = readModelJson('manifest.json');
  assert.equal(manifest.releaseStatus.ready, false);
  assert.equal(manifest.models.length, EXPECTED_APPROVED_ENTRIES);
  assertValid(manifest, 'Actual manifest, without synthetic entries');
});

test('the actual manifest references evidence and approval files that exist with the recorded SHA-256', () => {
  const manifest = readModelJson('manifest.json');
  const repositoryFile = (relativePath) =>
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
  for (const entry of manifest.models) {
    assert.ok(
      existsSync(repositoryFile(entry.approval.recordPath)),
      `missing adoption record: ${entry.approval.recordPath}`,
    );
    for (const evidence of entry.evidence) {
      const localPath = repositoryFile(evidence.localPath);
      assert.ok(existsSync(localPath), `missing evidence copy: ${evidence.localPath}`);
      const digest = createHash('sha256').update(readFileSync(localPath)).digest('hex');
      assert.equal(
        digest,
        evidence.sha256,
        `evidence SHA-256 mismatch for ${evidence.localPath}`,
      );
    }
  }
});

test('each actual manifest entry matches the values written in its adoption record', () => {
  const manifest = readModelJson('manifest.json');
  for (const entry of manifest.models) {
    const record = readFileSync(
      fileURLToPath(new URL(`../../${entry.approval.recordPath}`, import.meta.url)),
      'utf8',
    );
    const expected = [
      entry.id,
      entry.sha256,
      entry.byteSize.toLocaleString('en-US'),
      entry.downloadUrl,
      entry.sourcePath,
      entry.payloadPath,
      entry.licenses.code.spdx,
      entry.licenses.checkpoint.spdx,
      entry.approval.approver,
      entry.approval.date,
      ...entry.evidence.flatMap((item) => [item.localPath, item.sourceUrl, item.sha256, item.retrievedDate]),
      ...entry.licenses.trainingData.flatMap((item) => [item.datasetName, item.termsUrl, item.termsRetrievedDate]),
      entry.category,
    ];
    if (entry.inferenceConfig) {
      expected.push(String(entry.inferenceConfig.confidenceThreshold));
    }
    for (const value of expected) {
      assert.ok(record.includes(value), `${entry.approval.recordPath} does not state ${value}`);
    }
    assert.match(record, /\| 最終判定 \| \*\*承認\*\* \|/u, `${entry.approval.recordPath} is not Approved`);
  }
});

// FR-LIC-016(3): a repository-local LicenseRef must say it is not a publisher grant
// and that the const-true permission fields come from the owner decision.
test('each actual LicenseRef checkpoint notice discloses the FR-LIC-016 risk acceptance', () => {
  const manifest = readModelJson('manifest.json');
  for (const entry of manifest.models.filter((item) => item.licenses.checkpoint.spdx.startsWith('LicenseRef-'))) {
    const notice = entry.licenses.checkpoint.noticeText;
    const record = readFileSync(
      fileURLToPath(new URL(`../../${entry.approval.recordPath}`, import.meta.url)),
      'utf8',
    ).replace(/\s+/gu, ' ');
    for (const phrase of [
      'does not assert any grant by the publisher',
      'not from a publisher confirmation (FR-LIC-016)',
      'Unconfirmed at the time of the decision:',
    ]) {
      assert.ok(notice.includes(phrase), `${entry.id} manifest notice lacks: ${phrase}`);
      assert.ok(record.includes(phrase), `${entry.approval.recordPath} NOTICE lacks: ${phrase}`);
    }
  }
});

test('accepts a partial synthetic approved set when not ready and unversioned', () => {
  const manifest = createSyntheticManifest();
  manifest.releaseStatus.ready = false;
  manifest.models = manifest.models.slice(0, 1);
  delete manifest.productVersion;
  assertValid(manifest);
});

test('rejects ready=true with an empty models array even with productVersion', () => {
  const manifest = createSyntheticManifest();
  manifest.models = [];
  assertInvalid(manifest, 'minItems', '/models');
});

test('requires productVersion when ready=true', () => {
  const manifest = createSyntheticManifest();
  delete manifest.productVersion;
  assertInvalid(manifest, 'required', '');
});

test('accepts all four synthetic roles with verified Windows CPU and DirectML', () => {
  assertValid(createSyntheticManifest());
});

test('accepts reversed model-role and Windows-provider order', () => {
  const manifest = createSyntheticManifest();
  manifest.models.reverse();
  for (const model of manifest.models) model.support.reverse();
  assertValid(manifest);
});

test('requires at least four model entries when ready=true', () => {
  const manifest = createSyntheticManifest();
  manifest.models.pop();
  assertInvalid(manifest, 'minItems', '/models');
});

for (const [index, [category, task]] of roles.entries()) {
  test(`requires ready role ${category}/${task} even when four entries remain`, () => {
    const manifest = createSyntheticManifest();
    const replacement = structuredClone(manifest.models[(index + 1) % roles.length]);
    replacement.id = `synthetic-replacement-${index}`;
    manifest.models[index] = replacement;
    assert.equal(manifest.models.length, 4);
    assert.equal(new Set(manifest.models.map((model) => model.id)).size, 4);
    assertInvalid(manifest, 'contains', '/models');
  });
}

test('rejects either missing Windows provider or a missing support array', () => {
  for (const index of [0, 1]) {
    const manifest = createSyntheticManifest();
    manifest.models[0].support.splice(index, 1);
    assertInvalid(manifest, 'minItems', '/models/0/support');
  }
  const manifest = createSyntheticManifest();
  delete manifest.models[0].support;
  assertInvalid(manifest, 'required', '/models/0');
});

test('rejects duplicate CPU or duplicate DirectML support entries', () => {
  for (const index of [0, 1]) {
    const manifest = createSyntheticManifest();
    const entry = manifest.models[0].support[index];
    manifest.models[0].support = [{ ...entry }, { ...entry }];
    assertInvalid(manifest, 'uniqueItems', '/models/0/support');
  }
});

test('rejects verified=false for either Windows provider', () => {
  for (const index of [0, 1]) {
    const manifest = createSyntheticManifest();
    manifest.models[0].support[index].verified = false;
    assertInvalid(manifest, 'const', `/models/0/support/${index}/verified`);
  }
});

test('rejects unsupported OS values and the legacy four-entry Windows/macOS matrix', () => {
  for (const os of ['macos-arm64', 'macos-x64', 'linux-x64', 'windows-arm64', 'unknown']) {
    const manifest = createSyntheticManifest();
    manifest.models[0].support[0].os = os;
    assertInvalid(manifest, 'const', '/models/0/support/0/os', os);
  }
  const manifest = createSyntheticManifest();
  manifest.models[0].support.push(
    { os: 'macos-arm64', executionProvider: 'cpu', verified: true },
    { os: 'macos-arm64', executionProvider: 'coreml', verified: true },
  );
  assertInvalid(manifest, 'maxItems', '/models/0/support');
});

test('rejects CoreML and unrecognized Windows execution providers', () => {
  for (const provider of ['coreml', 'cuda', 'dml', 'unknown']) {
    const manifest = createSyntheticManifest();
    manifest.models[0].support[1].executionProvider = provider;
    assertInvalid(manifest, 'enum', '/models/0/support/1/executionProvider', provider);
  }
});

test('rejects every tested approval status other than exact Approved', () => {
  for (const status of ['Pending', 'Candidate', 'Rejected', 'approved', 'Approved ', '', false]) {
    const manifest = createSyntheticManifest();
    manifest.models[0].approval.status = status;
    assertInvalid(manifest, 'const', '/models/0/approval/status', String(status));
  }
});

for (const layer of ['code', 'checkpoint']) {
  test(`rejects unconfirmed commercial use or redistribution in the ${layer} license layer`, () => {
    for (const field of ['commercialUseConfirmed', 'redistributionPermitted']) {
      const manifest = createSyntheticManifest();
      manifest.models[0].licenses[layer][field] = false;
      assertInvalid(manifest, 'const', `/models/0/licenses/${layer}/${field}`);
    }
  });
}

test('rejects unconfirmed commercial derivative permission for training data', () => {
  const manifest = createSyntheticManifest();
  manifest.models[0].licenses.trainingData[0].commercialDerivativesPermitted = false;
  assertInvalid(manifest, 'const', '/models/0/licenses/trainingData/0/commercialDerivativesPermitted');
});

test('rejects either intended-use flag that excludes product production use', () => {
  for (const [field, value] of [['productUseInScope', false], ['outOfScopeProductionUse', true]]) {
    const manifest = createSyntheticManifest();
    manifest.models[0].intendedUse[field] = value;
    assertInvalid(manifest, 'const', `/models/0/intendedUse/${field}`);
  }
});

test('rejects unresolved or blank license assertions without claiming SPDX validation', () => {
  const invalidAssertions = [
    ['unknown', 'not'], ['UNKNOWN', 'not'], ['NOASSERTION', 'not'], ['none', 'not'],
    ['Pending', 'not'], ['unconfirmed', 'not'], ['N/A', 'not'],
    ['', 'minLength'], ['   ', 'pattern'], [' MIT ', 'pattern'],
  ];
  for (const layer of ['code', 'checkpoint']) {
    for (const [value, keyword] of invalidAssertions) {
      const manifest = createSyntheticManifest();
      manifest.models[0].licenses[layer].spdx = value;
      assertInvalid(manifest, keyword, `/models/0/licenses/${layer}/spdx`, JSON.stringify(value));
    }
  }
});

test('requires inferenceConfig for both C7 task roles', () => {
  for (const index of [2, 3]) {
    const manifest = createSyntheticManifest();
    delete manifest.models[index].inferenceConfig;
    assertInvalid(manifest, 'required', `/models/${index}`);
  }
});

test('enforces conditional nondeterministic-operation declarations for C7', () => {
  for (const index of [2, 3]) {
    const manifest = createSyntheticManifest();
    const config = manifest.models[index].inferenceConfig;
    const path = `/models/${index}/inferenceConfig`;
    config.deterministicInference = false;
    assertInvalid(manifest, 'required', path);
    config.nonDeterministicOperations = [];
    assertInvalid(manifest, 'minItems', `${path}/nonDeterministicOperations`);
    config.nonDeterministicOperations = ['synthetic-test-operation'];
    assertValid(manifest);
    config.deterministicInference = true;
    assertInvalid(manifest, 'not', path);
  }
});

test('rejects traversal in source, payload, evidence and adoption paths', () => {
  const cases = [
    ['/models/0/sourcePath', (model) => { model.sourcePath = 'vendor/models/../escape.onnx'; }],
    ['/models/0/sourcePath', (model) => { model.sourcePath = 'vendor/models/test\\..\\escape.onnx'; }],
    ['/models/0/payloadPath', (model) => { model.payloadPath = 'resources/models/test/../../escape.onnx'; }],
    ['/models/0/evidence/0/localPath', (model) => {
      model.evidence[0].localPath = 'docs/model-governance/test/../../evidence.txt';
    }],
    ['/models/0/approval/recordPath', (model) => {
      model.approval.recordPath = 'docs/model-governance/../test-adoption.md';
    }],
  ];
  for (const [path, mutate] of cases) {
    const manifest = createSyntheticManifest();
    mutate(manifest.models[0]);
    assertInvalid(manifest, 'pattern', path);
  }
});

test('rejects the adoption template as either an approval record or evidence', () => {
  for (const kind of ['approval', 'evidence']) {
    const manifest = createSyntheticManifest();
    const path = kind === 'approval' ? '/models/0/approval/recordPath' : '/models/0/evidence/0/localPath';
    if (kind === 'approval') {
      manifest.models[0].approval.recordPath = 'docs/model-governance/adoption-template.md';
    } else {
      manifest.models[0].evidence[0].localPath = 'docs/model-governance/adoption-template.md';
    }
    assertInvalid(manifest, 'not', path);
  }
});

test('rejects empty and malformed hashes for model payloads and evidence', () => {
  for (const kind of ['payload', 'evidence']) {
    for (const hash of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'A'.repeat(64)]) {
      const manifest = createSyntheticManifest();
      const target = kind === 'payload' ? manifest.models[0] : manifest.models[0].evidence[0];
      const path = kind === 'payload' ? '/models/0/sha256' : '/models/0/evidence/0/sha256';
      target.sha256 = hash;
      assertInvalid(manifest, 'pattern', path, `${kind} hash: ${JSON.stringify(hash)}`);
    }
  }
});

test('accepts exact calendar dates including leap days and years 0000 through 0099', () => {
  for (const value of ['0000-02-29', '0004-02-29', '0096-02-29', '0099-12-31', '1900-02-28', '2000-02-29', '2024-02-29']) {
    for (const [path, setDate] of dateFields) {
      const manifest = createSyntheticManifest();
      setDate(manifest.models[0], value);
      assertValid(manifest, `${path}: ${value}`);
    }
  }
});

test('rejects impossible calendar dates at every date-formatted property', () => {
  for (const value of [
    '0001-02-29', '0099-02-29', '1900-02-29', '2100-02-29', '2023-02-29',
    '2024-02-30', '2024-04-31', '2024-00-10', '2024-13-01', '2024-01-00', '2024-01-32',
  ]) {
    for (const [path, setDate] of dateFields) {
      const manifest = createSyntheticManifest();
      setDate(manifest.models[0], value);
      // These strings satisfy the schema's date pattern: format must reject them.
      assertInvalid(manifest, 'format', path, `${path}: ${value}`);
    }
  }
});

test('rejects empty, noncanonical and timestamp values at every date property', () => {
  for (const value of ['', 'not-a-date', '2024-2-29', '2024-02-29T00:00:00Z', ' 2024-02-29', '2024-02-29 ', '2024-02-29\n']) {
    for (const [path, setDate] of dateFields) {
      const manifest = createSyntheticManifest();
      setDate(manifest.models[0], value);
      assertInvalid(manifest, 'format', path, `${path}: ${JSON.stringify(value)}`);
    }
  }
});

test('accepts syntactically valid HTTPS URLs at every URI-formatted property', () => {
  for (const value of [
    'https://example.invalid/synthetic/model.onnx',
    'https://example.invalid:8443/synthetic/terms?revision=1#license',
  ]) {
    for (const [path, setUri] of uriFields) {
      const manifest = createSyntheticManifest();
      setUri(manifest.models[0], value);
      assertValid(manifest, `${path}: ${value}`);
    }
  }
});

test('rejects malformed HTTPS URLs even when the schema prefix pattern matches', () => {
  for (const value of ['https://', 'https://[broken', 'https://exa mple.invalid/model.onnx',
    'https://example.invalid/a b', String.raw`https://example.invalid\model.onnx`,
    'https://example.invalid/a\tb', 'https://example.invalid/a\nb', 'https://example.invalid/\u0000']) {
    for (const [path, setUri] of uriFields) {
      const manifest = createSyntheticManifest();
      setUri(manifest.models[0], value);
      assertInvalid(manifest, 'format', path, `${path}: ${value}`);
    }
  }
});

test('rejects non-HTTPS schemes and relative URLs at every URI property', () => {
  for (const value of ['http://example.invalid/test', 'ftp://example.invalid/test', '//example.invalid/test', 'relative/file']) {
    for (const [path, setUri] of uriFields) {
      const manifest = createSyntheticManifest();
      setUri(manifest.models[0], value);
      assertInvalid(manifest, 'format', path, `${path}: ${value}`);
    }
  }
});

test('rejects unsafe or unrecognized serialization formats', () => {
  for (const format of ['pickle', 'pt', 'unknown']) {
    const manifest = createSyntheticManifest();
    manifest.models[0].format = format;
    assertInvalid(manifest, 'enum', '/models/0/format', format);
  }
});