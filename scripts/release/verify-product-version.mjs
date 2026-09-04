import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRODUCT_VERSION_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;

function readJson(repositoryRoot, relativePath) {
  const filePath = resolve(repositoryRoot, relativePath);
  let value;

  try {
    value = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read valid JSON from ${relativePath}: ${message}`);
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${relativePath} must contain a JSON object.`);
  }

  return value;
}

function requireProductVersion(value, fieldName) {
  if (typeof value !== 'string' || !PRODUCT_VERSION_PATTERN.test(value)) {
    throw new Error(
      `${fieldName} must use MAJOR.MINOR.PATCH without leading zeroes.`,
    );
  }

  return value;
}

function requireMatchingVersion(value, productVersion, fieldName) {
  if (value !== productVersion) {
    throw new Error(
      `${fieldName} must equal product version ${productVersion}.`,
    );
  }
}

export function verifyProductVersion(repositoryRoot = process.cwd()) {
  const packageMetadata = readJson(repositoryRoot, 'package.json');
  const productVersion = requireProductVersion(
    packageMetadata.version,
    'package.json.version',
  );

  const packageLock = readJson(repositoryRoot, 'package-lock.json');
  requireMatchingVersion(
    packageLock.version,
    productVersion,
    'package-lock.json.version',
  );
  requireMatchingVersion(
    packageLock.packages?.['']?.version,
    productVersion,
    'package-lock.json.packages[""].version',
  );

  const modelManifest = readJson(
    repositoryRoot,
    'resources/models/manifest.json',
  );
  const releaseReady = modelManifest.releaseStatus?.ready;

  if (typeof releaseReady !== 'boolean') {
    throw new Error(
      'resources/models/manifest.json releaseStatus.ready must be boolean.',
    );
  }

  const hasManifestProductVersion = Object.hasOwn(
    modelManifest,
    'productVersion',
  );

  if (releaseReady && !hasManifestProductVersion) {
    throw new Error(
      'resources/models/manifest.json productVersion is required when releaseStatus.ready is true.',
    );
  }

  if (hasManifestProductVersion) {
    requireMatchingVersion(
      modelManifest.productVersion,
      productVersion,
      'resources/models/manifest.json productVersion',
    );
  }

  return productVersion;
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entryPath === import.meta.url) {
  try {
    const productVersion = verifyProductVersion();
    console.log(`Product version ${productVersion} verified.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}