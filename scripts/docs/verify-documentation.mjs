import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

import { JSDOM } from 'jsdom';

export const REQUIRED_MARKDOWN_FILES = Object.freeze([
  'README.md',
  'CONTRIBUTING.md',
  'docs/users-guide.md',
  'docs/developer-guide.md',
  'docs/architecture.md',
  'docs/requirement-definition.md',
  'docs/implementation-plan.md',
  'work/20260904-DocumentationFactBaseline.md',
]);

export const REQUIRED_SVG_FILES = Object.freeze([
  'images/system-architecture.svg',
  'images/component-diagram.svg',
  'images/repository-structure.svg',
  'images/data-lifecycle.svg',
  'images/requirements-driven-customization-flow.svg',
]);

export const REQUIREMENT_REFERENCE_FILES = Object.freeze([
  'README.md',
  'docs/users-guide.md',
  'docs/developer-guide.md',
  'docs/architecture.md',
]);

export const README_REQUIRED_LINKS = Object.freeze([
  Object.freeze({
    label: 'インストール・設定・チュートリアル',
    destination: 'docs/users-guide.md',
  }),
  Object.freeze({
    label: '開発・カスタマイズガイド',
    destination: 'docs/developer-guide.md',
  }),
  Object.freeze({
    label: 'アーキテクチャ',
    destination: 'docs/architecture.md',
  }),
  Object.freeze({
    label: '要求定義',
    destination: 'docs/requirement-definition.md',
  }),
]);

export const ALLOWED_FEATURE_STATUSES = Object.freeze([
  '実装済み',
  '設計確定・未実装',
  '検証待ち',
  '対象外',
]);

export const ALLOWED_DOCUMENT_MATURITIES = Object.freeze([
  '構成のみ',
  '要求反映済み',
  '実測済み',
]);

const STATUS_LABEL_FILES = Object.freeze([
  'README.md',
  'docs/users-guide.md',
  'docs/developer-guide.md',
  'docs/architecture.md',
]);
const ARCHITECTURE_SOURCE_PREFIX_PATTERN = /^(?:src|ml|resources|scripts|tests)[\\/]/;

const REQUIRED_USER_GUIDE_CHAPTERS = Object.freeze(
  Array.from({ length: 16 }, (_, index) => index + 1),
);
const HASH_PATTERN = /\b[0-9a-f]{64}\b/i;
const REQUIREMENT_ID_PATTERN = /\b(?:FR|NFR)-[A-Z][A-Z0-9]*-\d{3}\b/g;
const REQUIREMENT_RANGE_PATTERN = /\b((?:FR|NFR)-[A-Z][A-Z0-9]*-)(\d{3})\s*(?:〜|～|–|—|\.\.)\s*(?:((?:FR|NFR)-[A-Z][A-Z0-9]*-))?(\d{3})\b/g;
const EXTERNAL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

function issue(check, file, line, reason) {
  return {
    check,
    file: file.replaceAll('\\', '/'),
    line: Number.isInteger(line) && line > 0 ? line : 1,
    reason,
  };
}

export function formatIssue(value) {
  return `${value.file}:${value.line}: [${value.check}] ${value.reason}`;
}

export class DocumentationVerificationError extends Error {
  constructor(issues) {
    super(issues.map(formatIssue).join('\n'));
    this.name = 'DocumentationVerificationError';
    this.issues = issues;
  }
}

export function lineNumberAt(text, offset) {
  if (!Number.isInteger(offset) || offset <= 0) {
    return 1;
  }

  return text.slice(0, offset).split('\n').length;
}

function lineNumberForNeedle(text, needle) {
  const offset = text.indexOf(needle);
  return offset < 0 ? 1 : lineNumberAt(text, offset);
}

function isInside(rootPath, candidatePath) {
  const pathFromRoot = relative(rootPath, candidatePath);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  );
}

function readRequiredFile(repositoryRoot, relativePath, issues) {
  const absolutePath = resolve(repositoryRoot, relativePath);

  try {
    const metadata = lstatSync(absolutePath);
    if (!metadata.isFile()) {
      issues.push(
        issue('required-file', relativePath, 1, 'required path must be a regular file'),
      );
      return undefined;
    }

    const realPath = realpathSync(absolutePath);
    if (!isInside(repositoryRoot, realPath)) {
      issues.push(
        issue('required-file', relativePath, 1, 'required file resolves outside the repository'),
      );
      return undefined;
    }

    return readFileSync(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(
      issue('required-file', relativePath, 1, `cannot inspect required file: ${message}`),
    );
    return undefined;
  }
}

function collectMarkdownFiles(directory, repositoryRoot, output, issues) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    const relativePath = relative(repositoryRoot, directory) || '.';
    const message = error instanceof Error ? error.message : String(error);
    issues.push(issue('markdown-discovery', relativePath, 1, `cannot inspect directory: ${message}`));
    return;
  }

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(entryPath, repositoryRoot, output, issues);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      output.push(relative(repositoryRoot, entryPath).replaceAll('\\', '/'));
    }
  }
}

function maskMarkdownCode(text) {
  const characters = text.split('');
  const ranges = [];
  const fencePattern = /^(?: {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)[\s\S]*?^(?: {0,3})\1[ \t]*(?=\r?$)/gm;
  let match;

  while ((match = fencePattern.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }

  const inlinePattern = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
  while ((match = inlinePattern.exec(text)) !== null) {
    if (!ranges.some(([start, end]) => match.index >= start && match.index < end)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }

  for (const [start, end] of ranges) {
    for (let index = start; index < end; index += 1) {
      if (characters[index] !== '\n' && characters[index] !== '\r') {
        characters[index] = ' ';
      }
    }
  }

  return characters.join('');
}

function unwrapDestination(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>');
    return close < 0 ? trimmed : trimmed.slice(1, close);
  }

  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (/\s/u.test(character)) {
      return trimmed.slice(0, index);
    }
  }
  return trimmed;
}

export function parseMarkdownLinks(text) {
  const masked = maskMarkdownCode(text);
  const definitions = new Map();
  const links = [];
  const definitionPattern = /^ {0,3}\[([^\]^][^\]]*)\]:\s*(\S.*)$/gm;
  let match;

  while ((match = definitionPattern.exec(masked)) !== null) {
    const identifier = match[1].trim().replaceAll(/\s+/g, ' ').toLowerCase();
    definitions.set(identifier, {
      destination: unwrapDestination(match[2]),
      line: lineNumberAt(masked, match.index),
    });
  }

  for (let index = 0; index < masked.length; index += 1) {
    const image = masked[index] === '!' && masked[index + 1] === '[';
    const open = image ? index + 1 : index;
    if (masked[open] !== '[' || (open > 0 && masked[open - 1] === '\\')) {
      continue;
    }

    const close = masked.indexOf(']', open + 1);
    if (close < 0) {
      continue;
    }

    const label = text.slice(open + 1, close);
    if (masked[close + 1] === '(') {
      let depth = 1;
      let cursor = close + 2;
      let escaped = false;
      for (; cursor < masked.length && depth > 0; cursor += 1) {
        const character = masked[cursor];
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '(') {
          depth += 1;
        } else if (character === ')') {
          depth -= 1;
        }
      }
      if (depth === 0) {
        links.push({
          label,
          destination: unwrapDestination(text.slice(close + 2, cursor - 1)),
          line: lineNumberAt(text, open),
          image,
          reference: false,
        });
        index = cursor - 1;
      }
      continue;
    }

    if (masked[close + 1] === '[') {
      const referenceClose = masked.indexOf(']', close + 2);
      if (referenceClose < 0) {
        continue;
      }
      const rawIdentifier = text.slice(close + 2, referenceClose);
      const identifier = (rawIdentifier || label)
        .trim()
        .replaceAll(/\s+/g, ' ')
        .toLowerCase();
      const definition = definitions.get(identifier);
      if (definition) {
        links.push({
          label,
          destination: definition.destination,
          line: lineNumberAt(text, open),
          image,
          reference: true,
        });
      } else if (!/^(?:rd\s+)?[sp]\d+$/i.test(identifier)) {
        links.push({
          label,
          destination: undefined,
          line: lineNumberAt(text, open),
          image,
          reference: true,
          identifier,
        });
      }
      index = referenceClose;
    }
  }

  return links;
}

function headingText(value) {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/!?(?:\[([^\]]*)\])(?:\([^)]*\)|\[[^\]]*\])/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim();
}

export function githubSlug(value) {
  return headingText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .trim()
    .replace(/\s/gu, '-');
}

export function parseMarkdownHeadings(text) {
  const masked = maskMarkdownCode(text);
  const headings = [];
  const slugCounts = new Map();
  const headingPattern = /^( {0,3})(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r)?$/gm;
  let match;

  while ((match = headingPattern.exec(masked)) !== null) {
    const title = text.slice(
      match.index + match[1].length + match[2].length,
      match.index + match[0].length,
    ).trim().replace(/[ \t]+#+[ \t]*$/, '');
    const baseSlug = githubSlug(title);
    const count = slugCounts.get(baseSlug) ?? 0;
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
    slugCounts.set(baseSlug, count + 1);
    headings.push({
      level: match[2].length,
      title,
      slug,
      line: lineNumberAt(masked, match.index),
    });
  }

  return headings;
}

function decodeLinkComponent(value, file, line, issues) {
  try {
    return decodeURIComponent(value);
  } catch {
    issues.push(issue('markdown-link', file, line, `link contains invalid percent encoding: ${value}`));
    return undefined;
  }
}

function exactCasePath(repositoryRoot, absolutePath) {
  const pathFromRoot = relative(repositoryRoot, absolutePath);
  if (!pathFromRoot || isAbsolute(pathFromRoot) || pathFromRoot.startsWith('..')) {
    return pathFromRoot === '';
  }

  let current = repositoryRoot;
  for (const segment of pathFromRoot.split(sep)) {
    const names = readdirSync(current);
    if (!names.includes(segment)) {
      return false;
    }
    current = resolve(current, segment);
  }
  return true;
}

function inspectLink(repositoryRoot, sourceFile, link, markdownCache, issues) {
  if (link.destination === undefined) {
    issues.push(
      issue('markdown-link', sourceFile, link.line, `undefined reference link: ${link.identifier}`),
    );
    return;
  }

  const destination = link.destination.trim();
  if (!destination) {
    issues.push(issue('markdown-link', sourceFile, link.line, 'link destination is empty'));
    return;
  }
  if (destination.startsWith('//') || EXTERNAL_SCHEME_PATTERN.test(destination)) {
    return;
  }
  if (destination.startsWith('/')) {
    issues.push(
      issue('markdown-link', sourceFile, link.line, `repository-local link must be relative: ${destination}`),
    );
    return;
  }

  const hashIndex = destination.indexOf('#');
  const beforeFragment = hashIndex < 0 ? destination : destination.slice(0, hashIndex);
  const rawFragment = hashIndex < 0 ? '' : destination.slice(hashIndex + 1);
  const queryIndex = beforeFragment.indexOf('?');
  const rawPath = queryIndex < 0 ? beforeFragment : beforeFragment.slice(0, queryIndex);
  const decodedPath = decodeLinkComponent(rawPath, sourceFile, link.line, issues);
  const decodedFragment = decodeLinkComponent(rawFragment, sourceFile, link.line, issues);
  if (decodedPath === undefined || decodedFragment === undefined) {
    return;
  }

  const targetFile = decodedPath
    ? resolve(repositoryRoot, dirname(sourceFile), decodedPath)
    : resolve(repositoryRoot, sourceFile);
  if (!isInside(repositoryRoot, targetFile)) {
    issues.push(
      issue('markdown-link', sourceFile, link.line, `link escapes the repository: ${destination}`),
    );
    return;
  }

  let metadata;
  try {
    metadata = lstatSync(targetFile);
    if (!exactCasePath(repositoryRoot, targetFile)) {
      issues.push(
        issue('markdown-link', sourceFile, link.line, `link path has incorrect casing: ${decodedPath}`),
      );
      return;
    }
    const realTarget = realpathSync(targetFile);
    if (!isInside(repositoryRoot, realTarget)) {
      issues.push(
        issue('markdown-link', sourceFile, link.line, `link resolves outside the repository: ${destination}`),
      );
      return;
    }
  } catch {
    issues.push(
      issue('markdown-link', sourceFile, link.line, `link target does not exist: ${decodedPath || sourceFile}`),
    );
    return;
  }

  if (link.image && extname(targetFile).toLowerCase() !== '.svg') {
    issues.push(
      issue('markdown-image', sourceFile, link.line, `local diagram must use SVG: ${destination}`),
    );
  }
  if (link.image && relative(resolve(repositoryRoot, 'images'), targetFile).startsWith('..')) {
    issues.push(
      issue('markdown-image', sourceFile, link.line, `local diagram must be stored in images/: ${destination}`),
    );
  }

  if (!decodedFragment) {
    return;
  }
  if (!metadata.isFile() || extname(targetFile).toLowerCase() !== '.md') {
    issues.push(
      issue('markdown-fragment', sourceFile, link.line, `fragment target must be a Markdown file: ${destination}`),
    );
    return;
  }

  const targetRelative = relative(repositoryRoot, targetFile).replaceAll('\\', '/');
  let targetText = markdownCache.get(targetRelative);
  if (targetText === undefined) {
    try {
      targetText = readFileSync(targetFile, 'utf8');
      markdownCache.set(targetRelative, targetText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(
        issue('markdown-fragment', sourceFile, link.line, `cannot inspect fragment target: ${message}`),
      );
      return;
    }
  }

  const slugs = new Set(parseMarkdownHeadings(targetText).map((heading) => heading.slug));
  if (!slugs.has(githubSlug(decodedFragment))) {
    issues.push(
      issue('markdown-fragment', sourceFile, link.line, `fragment does not match a heading: #${decodedFragment}`),
    );
  }
}

export function validateMarkdownLinks(repositoryRoot, markdownFiles, markdownCache = new Map()) {
  const root = realpathSync(resolve(repositoryRoot));
  const issues = [];

  for (const sourceFile of markdownFiles) {
    let text = markdownCache.get(sourceFile);
    if (text === undefined) {
      try {
        text = readFileSync(resolve(root, sourceFile), 'utf8');
        markdownCache.set(sourceFile, text);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.push(issue('markdown-link', sourceFile, 1, `cannot inspect Markdown file: ${message}`));
        continue;
      }
    }
    for (const link of parseMarkdownLinks(text)) {
      inspectLink(root, sourceFile, link, markdownCache, issues);
    }
  }

  return issues;
}

export function validateReadmeRequiredLinks(text, file = 'README.md') {
  const issues = [];
  const links = parseMarkdownLinks(text).filter((link) => !link.image);

  for (const required of README_REQUIRED_LINKS) {
    const found = links.some(
      (link) => link.label === required.label && link.destination === required.destination,
    );
    if (!found) {
      issues.push(
        issue(
          'readme-required-link',
          file,
          1,
          `missing exact link [${required.label}](${required.destination})`,
        ),
      );
    }
  }

  return issues;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeLineEndings(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  return Buffer.from(text.replace(/\r\n?/g, '\n'), 'utf8');
}

function declaredHash(text, kind) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let relevant = false;
    let searchFrom = 0;
    if (kind === 'raw') {
      relevant = /raw/i.test(line) && /(作業ツリー|working tree|CRLF)/i.test(line);
      searchFrom = Math.max(0, line.search(/raw/i));
    } else {
      relevant = /LF-normalized/i.test(line);
      searchFrom = Math.max(0, line.search(/LF-normalized/i));
    }
    if (!relevant) {
      continue;
    }
    const match = line.slice(searchFrom).match(HASH_PATTERN);
    if (match) {
      return { hash: match[0].toLowerCase(), line: index + 1 };
    }
  }
  return undefined;
}

export function validateRequirementHashes(
  requirementBytes,
  declarations,
) {
  const issues = [];
  const actual = {
    raw: sha256(requirementBytes),
    normalized: sha256(normalizeLineEndings(requirementBytes)),
  };

  for (const declaration of declarations) {
    for (const kind of ['raw', 'normalized']) {
      const found = declaredHash(declaration.text, kind);
      if (!found) {
        issues.push(
          issue(
            'requirement-hash',
            declaration.file,
            1,
            `missing ${kind === 'raw' ? 'raw working-tree' : 'LF-normalized'} SHA-256 declaration`,
          ),
        );
      } else if (found.hash !== actual[kind]) {
        issues.push(
          issue(
            'requirement-hash',
            declaration.file,
            found.line,
            `${kind === 'raw' ? 'raw working-tree' : 'LF-normalized'} SHA-256 ${found.hash} does not match ${actual[kind]}`,
          ),
        );
      }
    }
  }

  return { actual, issues };
}

export function validateUserGuideStatuses(
  text,
  file = 'docs/users-guide.md',
  expectedChapters = REQUIRED_USER_GUIDE_CHAPTERS,
) {
  const issues = [];
  const lines = text.split(/\r?\n/);
  const chapterPattern = /^##\s+(\d+)\.\s+(.+)$/;
  const chapters = [];
  const fields = [
    { name: '機能状態', allowed: new Set(ALLOWED_FEATURE_STATUSES) },
    { name: '文書成熟度', allowed: new Set(ALLOWED_DOCUMENT_MATURITIES) },
    { name: '根拠' },
    { name: '最終化条件' },
  ];

  for (let index = 0; index < lines.length; index += 1) {
    const chapter = lines[index].match(chapterPattern);
    if (!chapter) {
      continue;
    }
    const number = Number(chapter[1]);
    chapters.push(number);
    let cursor = index + 1;

    for (const field of fields) {
      while (cursor < lines.length && (/^\s*$/.test(lines[cursor]) || /^\s*>\s*$/.test(lines[cursor]))) {
        cursor += 1;
      }
      const fieldPattern = new RegExp(`^\\s*>\\s*\\*\\*${field.name}:\\*\\*\\s*(.+?)\\s*$`);
      const fieldMatch = cursor < lines.length ? lines[cursor].match(fieldPattern) : undefined;
      if (!fieldMatch) {
        issues.push(
          issue(
            'users-guide-status',
            file,
            cursor < lines.length ? cursor + 1 : index + 1,
            `chapter ${number} must immediately provide > **${field.name}:**`,
          ),
        );
        continue;
      }
      const value = fieldMatch[1].trim();
      if (!value) {
        issues.push(
          issue('users-guide-status', file, cursor + 1, `${field.name} must not be empty`),
        );
      } else if (field.allowed && !field.allowed.has(value)) {
        issues.push(
          issue(
            'users-guide-status',
            file,
            cursor + 1,
            `${field.name} has disallowed value: ${value}`,
          ),
        );
      }
      cursor += 1;
    }
  }

  if (chapters.length === 0) {
    issues.push(issue('users-guide-status', file, 1, 'no numbered level-2 chapters were found'));
  }
  if (expectedChapters) {
    const actual = chapters.join(',');
    const expected = [...expectedChapters].join(',');
    if (actual !== expected) {
      issues.push(
        issue(
          'users-guide-status',
          file,
          1,
          `numbered level-2 chapters must be exactly ${expected}; found ${actual || 'none'}`,
        ),
      );
    }
  }

  return issues;
}

function unwrapStatusValue(value) {
  const trimmed = value.trim();
  for (const delimiter of ['`', '**']) {
    if (trimmed.startsWith(delimiter) && trimmed.endsWith(delimiter)) {
      return trimmed.slice(delimiter.length, -delimiter.length).trim();
    }
  }
  return trimmed;
}

export function validateExplicitStatusLabels(text, file) {
  const issues = [];
  const allowedValues = new Map([
    ['機能状態', new Set(ALLOWED_FEATURE_STATUSES)],
    ['文書成熟度', new Set(ALLOWED_DOCUMENT_MATURITIES)],
  ]);
  const lines = text.split(/\r?\n/);
  const maskedLines = maskMarkdownCode(text).split(/\r?\n/);
  const labelPattern = /^\s*(?:>\s*)?(?:[-*]\s+)?(?:\|\s*)?(?:\*\*)?(機能状態|文書成熟度):(?:\*\*)?\s*(.*)$/;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() && !maskedLines[index].trim()) {
      continue;
    }
    const match = lines[index].match(labelPattern);
    if (!match) {
      continue;
    }

    const rawValue = match[2].split('|', 1)[0].trim();
    const value = unwrapStatusValue(rawValue);
    if (!allowedValues.get(match[1]).has(value)) {
      issues.push(
        issue(
          'document-status',
          file,
          index + 1,
          `${match[1]} has disallowed value: ${value || '(empty)'}`,
        ),
      );
    }
  }

  return issues;
}

function extractInlineCodeSpans(text) {
  const spans = [];
  const lines = text.split(/\r?\n/);
  let fence;

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index];
    const fenceMatch = lineText.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (marker[0] === fence.character && marker.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (fence) {
      continue;
    }

    let cursor = 0;
    while (cursor < lineText.length) {
      const open = lineText.indexOf('`', cursor);
      if (open < 0) {
        break;
      }
      let delimiterLength = 1;
      while (lineText[open + delimiterLength] === '`') {
        delimiterLength += 1;
      }
      const delimiter = '`'.repeat(delimiterLength);
      const close = lineText.indexOf(delimiter, open + delimiterLength);
      if (close < 0) {
        break;
      }
      const afterClose = close + delimiterLength;
      if (lineText[afterClose] === '`') {
        cursor = afterClose;
        continue;
      }
      spans.push({
        value: lineText.slice(open + delimiterLength, close),
        line: index + 1,
        lineText,
      });
      cursor = afterClose;
    }
  }
  return spans;
}

function splitTopLevelCommas(value) {
  const parts = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth -= 1;
    else if (character === '[') bracketDepth += 1;
    else if (character === ']') bracketDepth -= 1;
    else if (character === ',' && braceDepth === 0 && bracketDepth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function expandConcreteBracePath(value, limit = 64) {
  if (/[*?\[\]]/.test(value) || /\s/.test(value)) {
    return undefined;
  }
  const open = value.indexOf('{');
  if (open < 0) {
    return value.includes('}') ? undefined : [value];
  }
  const close = value.indexOf('}', open + 1);
  if (close < 0 || value.slice(open + 1, close).includes('{')) {
    return undefined;
  }
  const alternatives = value.slice(open + 1, close).split(',');
  if (alternatives.length < 2 || alternatives.some((part) => !part || /[{}*?\[\]\s]/.test(part))) {
    return undefined;
  }

  const expanded = [];
  for (const alternative of alternatives) {
    const nested = expandConcreteBracePath(
      `${value.slice(0, open)}${alternative}${value.slice(close + 1)}`,
      limit - expanded.length,
    );
    if (!nested || expanded.length + nested.length > limit) {
      return undefined;
    }
    expanded.push(...nested);
  }
  return expanded;
}

export function validateArchitectureSourcePaths(
  repositoryRoot,
  text,
  file = 'docs/architecture.md',
) {
  const root = realpathSync(resolve(repositoryRoot));
  const issues = [];

  for (const span of extractInlineCodeSpans(text)) {
    const planned = /\bplanned\b/i.test(span.value) || /\bplanned\b/i.test(span.lineText);
    const spanValue = span.value.replace(/^\s*planned\s*:\s*/i, '');
    for (const part of splitTopLevelCommas(spanValue)) {
      const sourcePath = part.trim();
      if (!ARCHITECTURE_SOURCE_PREFIX_PATTERN.test(sourcePath)) {
        continue;
      }

      const repositoryPath = sourcePath.replaceAll('\\', '/');

      const concretePaths = expandConcreteBracePath(repositoryPath);
      if (!concretePaths) {
        if (!planned) {
          issues.push(
            issue(
              'architecture-source-path',
              file,
              span.line,
              `non-concrete source path must be explicitly marked planned: ${sourcePath}`,
            ),
          );
        }
        continue;
      }

      for (const concretePath of concretePaths) {
        const absolutePath = resolve(root, concretePath);
        if (!isInside(root, absolutePath)) {
          issues.push(
            issue(
              'architecture-source-path',
              file,
              span.line,
              `source path escapes the repository: ${concretePath}`,
            ),
          );
          continue;
        }

        try {
          lstatSync(absolutePath);
          const realPath = realpathSync(absolutePath);
          if (!isInside(root, realPath)) {
            issues.push(
              issue(
                'architecture-source-path',
                file,
                span.line,
                `source path resolves outside the repository: ${concretePath}`,
              ),
            );
          }
        } catch {
          if (!planned) {
            issues.push(
              issue(
                'architecture-source-path',
                file,
                span.line,
                `source path does not exist: ${concretePath}`,
              ),
            );
          }
        }
      }
    }
  }

  return issues;
}

function elementLine(text, element) {
  const id = element.getAttribute?.('id');
  if (id) {
    const idOffset = text.indexOf(`id="${id}"`);
    if (idOffset >= 0) {
      return lineNumberAt(text, idOffset);
    }
  }
  return lineNumberForNeedle(text, `<${element.localName}`);
}

export function validateSvg(text, file = 'image.svg') {
  const issues = [];
  if (!/^\uFEFF?\s*<\?xml\s+version=["']1\.0["'][^?]*\?>/i.test(text)) {
    issues.push(issue('svg', file, 1, 'SVG must begin with an XML declaration'));
  }
  if (/<\?xml-stylesheet\b/i.test(text)) {
    issues.push(
      issue('svg', file, lineNumberForNeedle(text, '<?xml-stylesheet'), 'external XML stylesheet is forbidden'),
    );
  }
  if (/<!DOCTYPE\b/i.test(text)) {
    issues.push(issue('svg', file, lineNumberForNeedle(text, '<!DOCTYPE'), 'DOCTYPE is forbidden'));
  }

  let document;
  try {
    document = new JSDOM(text, { contentType: 'image/svg+xml' }).window.document;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(issue('svg', file, 1, `SVG is not well-formed XML: ${message}`));
    return issues;
  }

  const root = document.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
    issues.push(issue('svg', file, 1, 'root element must be SVG in the SVG namespace'));
    return issues;
  }
  if (!root.getAttribute('viewBox')?.trim()) {
    issues.push(issue('svg', file, elementLine(text, root), 'root SVG requires a non-empty viewBox'));
  }
  if (root.getAttribute('role') !== 'img') {
    issues.push(issue('svg', file, elementLine(text, root), 'root SVG requires role="img"'));
  }

  const titleElements = [...root.children].filter((element) => element.localName === 'title');
  const descriptionElements = [...root.children].filter((element) => element.localName === 'desc');
  for (const [name, elements] of [['title', titleElements], ['desc', descriptionElements]]) {
    if (elements.length !== 1) {
      issues.push(issue('svg', file, elementLine(text, root), `root SVG requires exactly one direct <${name}>`));
    } else if (!elements[0].textContent?.trim()) {
      issues.push(issue('svg', file, elementLine(text, elements[0]), `<${name}> must not be empty`));
    }
  }

  const ariaLabelledBy = root.getAttribute('aria-labelledby')?.trim();
  if (!ariaLabelledBy) {
    issues.push(issue('svg', file, elementLine(text, root), 'root SVG requires aria-labelledby'));
  } else {
    const referenced = ariaLabelledBy.split(/\s+/);
    for (const [name, elements] of [['title', titleElements], ['desc', descriptionElements]]) {
      if (elements.length === 1) {
        const id = elements[0].getAttribute('id');
        if (!id || !referenced.includes(id) || document.getElementById(id) !== elements[0]) {
          issues.push(
            issue('svg', file, elementLine(text, elements[0]), `aria-labelledby must reference the <${name}> id`),
          );
        }
      }
    }
  }

  const allElements = [...document.querySelectorAll('*')];
  const forbidden = new Set(['script', 'style', 'font', 'font-face', 'foreignObject']);
  for (const element of allElements) {
    if (forbidden.has(element.localName)) {
      issues.push(
        issue('svg', file, elementLine(text, element), `<${element.localName}> is forbidden`),
      );
    }
    if (element.hasAttribute('style')) {
      issues.push(issue('svg', file, elementLine(text, element), 'style attributes are forbidden'));
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) {
        issues.push(
          issue('svg', file, elementLine(text, element), `external href is forbidden: ${value || '(empty)'}`),
        );
      }
      for (const urlMatch of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
        if (!urlMatch[2].trim().startsWith('#')) {
          issues.push(
            issue('svg', file, elementLine(text, element), `external resource URL is forbidden: ${urlMatch[2].trim()}`),
          );
        }
      }
    }
  }

  return issues;
}

export function extractRequirementDefinitions(text) {
  const definitions = new Set();
  const definitionPattern = /^\s*\|\s*((?:FR|NFR)-[A-Z][A-Z0-9]*-\d{3})\s*\|/gm;
  let match;
  while ((match = definitionPattern.exec(text)) !== null) {
    definitions.add(match[1]);
  }
  return definitions;
}

export function extractRequirementReferences(text) {
  const references = [];
  const rangeOffsets = [];
  const masked = maskMarkdownCode(text);
  let match;

  REQUIREMENT_RANGE_PATTERN.lastIndex = 0;
  while ((match = REQUIREMENT_RANGE_PATTERN.exec(masked)) !== null) {
    const startPrefix = match[1];
    const endPrefix = match[3] || startPrefix;
    const start = Number(match[2]);
    const end = Number(match[4]);
    const line = lineNumberAt(text, match.index);
    rangeOffsets.push([match.index, match.index + match[0].length]);

    if (startPrefix !== endPrefix || end < start || end - start > 999) {
      references.push({ id: match[0], line, invalidRange: true });
      continue;
    }
    for (let value = start; value <= end; value += 1) {
      references.push({ id: `${startPrefix}${String(value).padStart(3, '0')}`, line });
    }
  }

  REQUIREMENT_ID_PATTERN.lastIndex = 0;
  while ((match = REQUIREMENT_ID_PATTERN.exec(masked)) !== null) {
    if (!rangeOffsets.some(([start, end]) => match.index >= start && match.index < end)) {
      references.push({ id: match[0], line: lineNumberAt(text, match.index) });
    }
  }
  return references;
}

export function validateRequirementReferences(text, definitions, file) {
  const issues = [];
  const seen = new Set();
  for (const reference of extractRequirementReferences(text)) {
    const key = `${reference.line}:${reference.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (reference.invalidRange) {
      issues.push(issue('requirement-id', file, reference.line, `invalid requirement range: ${reference.id}`));
    } else if (!definitions.has(reference.id)) {
      issues.push(issue('requirement-id', file, reference.line, `unknown requirement ID: ${reference.id}`));
    }
  }
  return issues;
}

export function collectDocumentationIssues(repositoryRoot = process.cwd()) {
  const issues = [];
  let root;
  try {
    root = realpathSync(resolve(repositoryRoot));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [issue('repository', '.', 1, `cannot inspect repository root: ${message}`)];
  }

  const requiredContents = new Map();
  for (const file of [...REQUIRED_MARKDOWN_FILES, ...REQUIRED_SVG_FILES]) {
    const bytes = readRequiredFile(root, file, issues);
    if (bytes) {
      requiredContents.set(file, bytes);
    }
  }

  try {
    const rootNames = readdirSync(root);
    const typo = rootNames.find((name) => name.toLowerCase() === 'reamde.md');
    if (typo) {
      issues.push(issue('filename', typo, 1, 'REAMDE.md typo file must not exist'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(issue('filename', '.', 1, `cannot inspect repository root entries: ${message}`));
  }

  const markdownFiles = [];
  for (const rootMarkdown of ['README.md', 'CONTRIBUTING.md']) {
    if (requiredContents.has(rootMarkdown)) {
      markdownFiles.push(rootMarkdown);
    }
  }
  collectMarkdownFiles(resolve(root, 'docs'), root, markdownFiles, issues);
  if (requiredContents.has('work/20260904-DocumentationFactBaseline.md')) {
    markdownFiles.push('work/20260904-DocumentationFactBaseline.md');
  }
  const uniqueMarkdownFiles = [...new Set(markdownFiles)].sort();
  const markdownCache = new Map();
  for (const file of uniqueMarkdownFiles) {
    try {
      markdownCache.set(file, readFileSync(resolve(root, file), 'utf8'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(issue('markdown-discovery', file, 1, `cannot inspect Markdown file: ${message}`));
    }
  }
  issues.push(...validateMarkdownLinks(root, uniqueMarkdownFiles, markdownCache));

  const readme = requiredContents.get('README.md')?.toString('utf8');
  if (readme !== undefined) {
    issues.push(...validateReadmeRequiredLinks(readme));
  }

  const requirementBytes = requiredContents.get('docs/requirement-definition.md');
  const baseline = requiredContents
    .get('work/20260904-DocumentationFactBaseline.md')
    ?.toString('utf8');
  if (requirementBytes && readme !== undefined && baseline !== undefined) {
    const hashResult = validateRequirementHashes(requirementBytes, [
      { file: 'README.md', text: readme },
      { file: 'work/20260904-DocumentationFactBaseline.md', text: baseline },
    ]);
    issues.push(...hashResult.issues);
  }

  const usersGuide = requiredContents.get('docs/users-guide.md')?.toString('utf8');
  if (usersGuide !== undefined) {
    issues.push(...validateUserGuideStatuses(usersGuide));
  }

  for (const file of STATUS_LABEL_FILES) {
    const text = requiredContents.get(file)?.toString('utf8');
    if (text !== undefined) {
      issues.push(...validateExplicitStatusLabels(text, file));
    }
  }

  const architecture = requiredContents.get('docs/architecture.md')?.toString('utf8');
  if (architecture !== undefined) {
    issues.push(...validateArchitectureSourcePaths(root, architecture));
  }

  for (const svgFile of REQUIRED_SVG_FILES) {
    const svg = requiredContents.get(svgFile)?.toString('utf8');
    if (svg !== undefined) {
      issues.push(...validateSvg(svg, svgFile));
    }
  }

  if (requirementBytes) {
    const definitions = extractRequirementDefinitions(requirementBytes.toString('utf8'));
    if (definitions.size === 0) {
      issues.push(
        issue('requirement-id', 'docs/requirement-definition.md', 1, 'no requirement definitions were found'),
      );
    } else {
      for (const file of REQUIREMENT_REFERENCE_FILES) {
        const text = requiredContents.get(file)?.toString('utf8');
        if (text !== undefined) {
          issues.push(...validateRequirementReferences(text, definitions, file));
        }
      }
    }
  }

  return issues.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.check.localeCompare(right.check) ||
      left.reason.localeCompare(right.reason),
  );
}

export function verifyDocumentation(repositoryRoot = process.cwd()) {
  const issues = collectDocumentationIssues(repositoryRoot);
  if (issues.length > 0) {
    throw new DocumentationVerificationError(issues);
  }
  return {
    markdownFiles: REQUIRED_MARKDOWN_FILES.length,
    svgFiles: REQUIRED_SVG_FILES.length,
  };
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entryPath === import.meta.url) {
  try {
    const result = verifyDocumentation();
    console.log(
      `Documentation verified (${result.markdownFiles} required Markdown files, ${result.svgFiles} SVG files).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
