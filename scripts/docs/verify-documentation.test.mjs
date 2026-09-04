import assert from 'node:assert/strict';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  REQUIRED_MARKDOWN_FILES,
  REQUIRED_SVG_FILES,
  collectDocumentationIssues,
  normalizeLineEndings,
  sha256,
  verifyDocumentation,
} from './verify-documentation.mjs';

const REQUIREMENT_FILE = 'docs/requirement-definition.md';
const BASELINE_FILE = 'work/20260904-DocumentationFactBaseline.md';
const SVG_FILE = 'images/system-architecture.svg';

function writeFixtureFile(repositoryRoot, relativePath, contents) {
  const filePath = join(repositoryRoot, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

function validSvg(title = 'Fixture diagram') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">A documentation verifier fixture.</desc>
  <rect id="box" x="1" y="1" width="98" height="48" fill="#ffffff" stroke="#000000" />
</svg>
`;
}

function validUserGuide() {
  const chapters = Array.from({ length: 16 }, (_, index) => {
    const chapter = index + 1;
    return `## ${chapter}. Fixture chapter ${chapter}
> **機能状態:** 設計確定・未実装
> **文書成熟度:** 構成のみ
> **根拠:** Fixture evidence
> **最終化条件:** Fixture completion condition
`;
  });
  return `# Users guide fixture

${chapters.join('\n')}`;
}

function createRepositoryFixture(t) {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'autovision-docs-'));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));

  const requirementText = `# Requirement definitions

| ID | Requirement |
|---|---|
| FR-SYS-001 | Fixture requirement |
`;
  const requirementBytes = Buffer.from(requirementText, 'utf8');
  const rawHash = sha256(requirementBytes);
  const normalizedHash = sha256(normalizeLineEndings(requirementBytes));
  const hashDeclarations = `Raw working tree SHA-256: ${rawHash}
LF-normalized SHA-256: ${normalizedHash}
`;

  const markdownFiles = {
    'README.md': `# AutoVision Studio fixture

[インストール・設定・チュートリアル](docs/users-guide.md)
[開発・カスタマイズガイド](docs/developer-guide.md)
[アーキテクチャ](docs/architecture.md)
[要求定義](docs/requirement-definition.md)

${hashDeclarations}`,
    'CONTRIBUTING.md': '# Contributing fixture\n',
    'docs/users-guide.md': validUserGuide(),
    'docs/developer-guide.md': '# Developer guide fixture\n\nFR-SYS-001\n',
    'docs/architecture.md': '# Architecture fixture\n',
    [REQUIREMENT_FILE]: requirementText,
    'docs/implementation-plan.md': '# Implementation plan fixture\n',
    [BASELINE_FILE]: `# Fact baseline fixture\n\n${hashDeclarations}`,
  };

  for (const [relativePath, contents] of Object.entries(markdownFiles)) {
    writeFixtureFile(repositoryRoot, relativePath, contents);
  }
  for (const [index, relativePath] of REQUIRED_SVG_FILES.entries()) {
    writeFixtureFile(repositoryRoot, relativePath, validSvg(`Fixture diagram ${index + 1}`));
  }

  return repositoryRoot;
}

function findIssue(issues, check, reasonPattern) {
  return issues.find(
    (issue) => issue.check === check && reasonPattern.test(issue.reason),
  );
}

test('accepts a complete documentation repository', (t) => {
  const repositoryRoot = createRepositoryFixture(t);

  assert.deepEqual(verifyDocumentation(repositoryRoot), {
    markdownFiles: REQUIRED_MARKDOWN_FILES.length,
    svgFiles: REQUIRED_SVG_FILES.length,
  });
});

test('reports a broken relative Markdown link', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  appendFileSync(
    join(repositoryRoot, 'README.md'),
    '\n[Missing document](docs/missing.md)\n',
    'utf8',
  );

  const issues = collectDocumentationIssues(repositoryRoot);

  assert.ok(
    findIssue(issues, 'markdown-link', /link target does not exist: docs\/missing\.md/),
  );
});

test('reports a broken percent-encoded Markdown fragment', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  appendFileSync(
    join(repositoryRoot, 'README.md'),
    '\n[Missing section](docs/users-guide.md#%E5%AD%98%E5%9C%A8%E3%81%97%E3%81%AA%E3%81%84)\n',
    'utf8',
  );

  const issues = collectDocumentationIssues(repositoryRoot);

  assert.ok(
    findIssue(issues, 'markdown-fragment', /fragment does not match a heading: #存在しない/),
  );
});

test('reports a missing direct SVG title', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  const svgPath = join(repositoryRoot, SVG_FILE);
  const svg = readFileSync(svgPath, 'utf8').replace(
    '  <title id="title">Fixture diagram 1</title>\n',
    '',
  );
  writeFileSync(svgPath, svg, 'utf8');

  const issues = collectDocumentationIssues(repositoryRoot);

  assert.ok(
    findIssue(issues, 'svg', /root SVG requires exactly one direct <title>/),
  );
});

test('reports external SVG href and resource URLs including a data URI', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  const svgPath = join(repositoryRoot, SVG_FILE);
  const svg = validSvg('External resource fixture').replace(
    '</svg>',
    `  <a href="https://example.invalid/diagram.svg"><rect width="1" height="1" /></a>
  <rect width="1" height="1" fill="url(data:image/svg+xml;base64,PHN2Zy8+)" />
</svg>`,
  );
  writeFileSync(svgPath, svg, 'utf8');

  const issues = collectDocumentationIssues(repositoryRoot);

  assert.ok(findIssue(issues, 'svg', /external href is forbidden: https:\/\/example\.invalid/));
  assert.ok(
    findIssue(issues, 'svg', /external resource URL is forbidden: data:image\/svg\+xml;base64,PHN2Zy8\+/),
  );
});

test('reports an unknown requirement ID', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  appendFileSync(join(repositoryRoot, 'README.md'), '\nFR-UNKNOWN-999\n', 'utf8');

  const issues = collectDocumentationIssues(repositoryRoot);

  assert.ok(
    findIssue(issues, 'requirement-id', /unknown requirement ID: FR-UNKNOWN-999/),
  );
});

test('reports mismatched raw and LF-normalized requirement hashes', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  const requirementPath = join(repositoryRoot, REQUIREMENT_FILE);
  writeFileSync(requirementPath, `${readFileSync(requirementPath, 'utf8')}Changed bytes.\r\n`, 'utf8');

  const issues = collectDocumentationIssues(repositoryRoot);

  assert.ok(findIssue(issues, 'requirement-hash', /raw working-tree SHA-256 .* does not match/));
  assert.ok(findIssue(issues, 'requirement-hash', /LF-normalized SHA-256 .* does not match/));
});

test('ignores a fake requirement ID inside a fenced code block', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  appendFileSync(
    join(repositoryRoot, 'README.md'),
    '\n```text\nFR-UNKNOWN-999\n```\n',
    'utf8',
  );

  assert.deepEqual(collectDocumentationIssues(repositoryRoot), []);
});

test('reports a missing required file', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  unlinkSync(join(repositoryRoot, 'docs/implementation-plan.md'));

  const issues = collectDocumentationIssues(repositoryRoot);

  assert.ok(
    findIssue(issues, 'required-file', /cannot inspect required file:/),
  );
  assert.ok(issues.some((issue) => issue.file === 'docs/implementation-plan.md'));
});

test('reports a root REAMDE.md typo file', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  writeFixtureFile(repositoryRoot, 'REAMDE.md', '# Typo fixture\n');

  const issues = collectDocumentationIssues(repositoryRoot);

  assert.ok(
    findIssue(issues, 'filename', /REAMDE\.md typo file must not exist/),
  );
});

test('reports a nonexistent unmarked architecture source path', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  appendFileSync(
    join(repositoryRoot, 'docs/architecture.md'),
    '\nCurrent source: `src/main/does-not-exist.ts`\n',
    'utf8',
  );

  const issues = collectDocumentationIssues(repositoryRoot);

  const sourceIssue = findIssue(
    issues,
    'architecture-source-path',
    /source path does not exist: src\/main\/does-not-exist\.ts/,
  );
  assert.ok(sourceIssue);
  assert.equal(sourceIssue.file, 'docs/architecture.md');
  assert.equal(sourceIssue.line, 3);
});

test('accepts an absent architecture source path explicitly marked planned', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  appendFileSync(
    join(repositoryRoot, 'docs/architecture.md'),
    '\nplanned: `src/main/future/*.ts`\n',
    'utf8',
  );

  assert.deepEqual(collectDocumentationIssues(repositoryRoot), []);
});

test('reports an invalid explicit status value in every governed document', async (t) => {
  for (const file of [
    'README.md',
    'docs/users-guide.md',
    'docs/developer-guide.md',
    'docs/architecture.md',
  ]) {
    await t.test(file, (subtest) => {
      const repositoryRoot = createRepositoryFixture(subtest);
      const filePath = join(repositoryRoot, file);
      const original = readFileSync(filePath, 'utf8');
      const addition = '\n> **機能状態:** 完成\n';
      writeFileSync(filePath, original + addition, 'utf8');

      const issues = collectDocumentationIssues(repositoryRoot);
      const statusIssue = findIssue(
        issues,
        'document-status',
        /機能状態 has disallowed value: 完成/,
      );
      const offset = (original + addition).indexOf('> **機能状態:** 完成', original.length);
      const expectedLine = (original + addition).slice(0, offset).split('\n').length;

      assert.ok(statusIssue);
      assert.equal(statusIssue.file, file);
      assert.equal(statusIssue.line, expectedLine);
    });
  }
});

test('ignores an invalid explicit status inside a fenced code block', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  appendFileSync(
    join(repositoryRoot, 'README.md'),
    '\n```text\n> **機能状態:** 完成\n```\n',
    'utf8',
  );

  assert.deepEqual(collectDocumentationIssues(repositoryRoot), []);
});

test('validates Windows-style architecture source paths', (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  appendFileSync(
    join(repositoryRoot, 'docs/architecture.md'),
    '\nCurrent source: `src\\main\\does-not-exist.ts`\n',
    'utf8',
  );

  const issues = collectDocumentationIssues(repositoryRoot);

  assert.ok(
    findIssue(
      issues,
      'architecture-source-path',
      /source path does not exist: src\/main\/does-not-exist\.ts/,
    ),
  );
});