import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { verifyProductVersion } from './verify-product-version.mjs';

const fixtureDirectories = [];
const scriptPath = fileURLToPath(
  new URL('./verify-product-version.mjs', import.meta.url),
);

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createRepositoryFixture({
  packageVersion = '0.1.0',
  lockVersion = packageVersion,
  lockPackageVersion = packageVersion,
  manifest = {
    schemaVersion: '1.0.0',
    releaseStatus: { ready: false, reason: 'Fixture is not release-ready.' },
    models: [],
  },
} = {}) {
  const repositoryRoot = mkdtempSync(
    join(tmpdir(), 'autovision-product-version-'),
  );
  fixtureDirectories.push(repositoryRoot);

  writeJson(join(repositoryRoot, 'package.json'), {
    name: 'autovision-studio',
    version: packageVersion,
  });
  writeJson(join(repositoryRoot, 'package-lock.json'), {
    name: 'autovision-studio',
    version: lockVersion,
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'autovision-studio',
        version: lockPackageVersion,
      },
    },
  });
  writeJson(
    join(repositoryRoot, 'resources/models/manifest.json'),
    manifest,
  );

  return repositoryRoot;
}

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('verifyProductVersion', () => {
  it('accepts a non-ready manifest without a product version', () => {
    const repositoryRoot = createRepositoryFixture();

    assert.equal(verifyProductVersion(repositoryRoot), '0.1.0');
  });

  it('accepts matching product versions in non-ready and ready manifests', () => {
    const nonReadyRepository = createRepositoryFixture({
      manifest: {
        schemaVersion: '1.0.0',
        productVersion: '0.1.0',
        releaseStatus: { ready: false, reason: 'Fixture is not release-ready.' },
        models: [],
      },
    });
    const readyRepository = createRepositoryFixture({
      manifest: {
        schemaVersion: '1.0.0',
        productVersion: '0.1.0',
        releaseStatus: { ready: true, reason: 'Fixture approvals completed.' },
        models: [],
      },
    });

    assert.equal(verifyProductVersion(nonReadyRepository), '0.1.0');
    assert.equal(verifyProductVersion(readyRepository), '0.1.0');
  });

  for (const packageVersion of [
    '1.2',
    '1.2.3.4',
    '01.2.3',
    'v1.2.3',
    '1.2.3-rc.1',
    '1.2.3+build.1',
    ' 1.2.3',
  ]) {
    it(`rejects unsupported product version ${JSON.stringify(packageVersion)}`, () => {
      const repositoryRoot = createRepositoryFixture({ packageVersion });

      assert.throws(
        () => verifyProductVersion(repositoryRoot),
        /package\.json\.version must use MAJOR\.MINOR\.PATCH without leading zeroes\./,
      );
    });
  }

  it('rejects each mismatched root package-lock version', () => {
    const topLevelMismatch = createRepositoryFixture({
      lockVersion: '0.1.1',
    });
    const rootPackageMismatch = createRepositoryFixture({
      lockPackageVersion: '0.1.1',
    });

    assert.throws(
      () => verifyProductVersion(topLevelMismatch),
      /package-lock\.json\.version must equal product version 0\.1\.0\./,
    );
    assert.throws(
      () => verifyProductVersion(rootPackageMismatch),
      /package-lock\.json\.packages\[""\]\.version must equal product version 0\.1\.0\./,
    );
  });

  it('requires a matching manifest product version when release-ready', () => {
    const missingVersion = createRepositoryFixture({
      manifest: {
        schemaVersion: '1.0.0',
        releaseStatus: { ready: true, reason: 'Fixture approvals completed.' },
        models: [],
      },
    });
    const mismatchedVersion = createRepositoryFixture({
      manifest: {
        schemaVersion: '1.0.0',
        productVersion: '0.2.0',
        releaseStatus: { ready: true, reason: 'Fixture approvals completed.' },
        models: [],
      },
    });

    assert.throws(
      () => verifyProductVersion(missingVersion),
      /productVersion is required when releaseStatus\.ready is true\./,
    );
    assert.throws(
      () => verifyProductVersion(mismatchedVersion),
      /productVersion must equal product version 0\.1\.0\./,
    );
  });

  it('rejects a mismatched product version even before release readiness', () => {
    const repositoryRoot = createRepositoryFixture({
      manifest: {
        schemaVersion: '1.0.0',
        productVersion: '0.2.0',
        releaseStatus: { ready: false, reason: 'Fixture is not release-ready.' },
        models: [],
      },
    });

    assert.throws(
      () => verifyProductVersion(repositoryRoot),
      /productVersion must equal product version 0\.1\.0\./,
    );
  });

  it('rejects a manifest whose readiness cannot be interpreted', () => {
    const repositoryRoot = createRepositoryFixture({
      manifest: {
        schemaVersion: '1.0.0',
        releaseStatus: { ready: 'false', reason: 'Invalid fixture.' },
        models: [],
      },
    });

    assert.throws(
      () => verifyProductVersion(repositoryRoot),
      /releaseStatus\.ready must be boolean\./,
    );
  });

  it('rejects a manifest without a release readiness state', () => {
    const repositoryRoot = createRepositoryFixture({
      manifest: {
        schemaVersion: '1.0.0',
        models: [],
      },
    });

    assert.throws(
      () => verifyProductVersion(repositoryRoot),
      /releaseStatus\.ready must be boolean\./,
    );
  });

  it('rejects a package without a product version', () => {
    const repositoryRoot = createRepositoryFixture();
    writeJson(join(repositoryRoot, 'package.json'), {
      name: 'autovision-studio',
    });

    assert.throws(
      () => verifyProductVersion(repositoryRoot),
      /package\.json\.version must use MAJOR\.MINOR\.PATCH without leading zeroes\./,
    );
  });

  it('rejects a package lock whose packages collection is not an object', () => {
    const repositoryRoot = createRepositoryFixture();
    writeJson(join(repositoryRoot, 'package-lock.json'), {
      name: 'autovision-studio',
      version: '0.1.0',
      lockfileVersion: 3,
      packages: [],
    });

    assert.throws(
      () => verifyProductVersion(repositoryRoot),
      /package-lock\.json\.packages\[""\]\.version must equal product version 0\.1\.0\./,
    );
  });

  for (const [description, value] of [
    ['null', null],
    ['array', []],
  ]) {
    for (const relativePath of [
      'package.json',
      'package-lock.json',
      'resources/models/manifest.json',
    ]) {
      it(`rejects a ${description} top level in ${relativePath}`, () => {
        const repositoryRoot = createRepositoryFixture();
        writeJson(join(repositoryRoot, relativePath), value);

        assert.throws(
          () => verifyProductVersion(repositoryRoot),
          new RegExp(`${relativePath.replaceAll('.', '\\.')} must contain a JSON object\\.`),
        );
      });
    }
  }

  it('reports malformed JSON with its repository-relative path', () => {
    const repositoryRoot = createRepositoryFixture();
    writeFileSync(join(repositoryRoot, 'package.json'), '{', 'utf8');

    assert.throws(
      () => verifyProductVersion(repositoryRoot),
      /Cannot read valid JSON from package\.json:/,
    );
  });

  it('reports one concise success line from the command', () => {
    const repositoryRoot = createRepositoryFixture();
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'Product version 0.1.0 verified.\n');
    assert.equal(result.stderr, '');
  });

  it('returns a nonzero status and concise error from the command', () => {
    const repositoryRoot = createRepositoryFixture({
      lockVersion: '0.2.0',
    });
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      'package-lock.json.version must equal product version 0.1.0.\n',
    );
  });
});