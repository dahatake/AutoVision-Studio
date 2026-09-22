import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  createProjectViaUi, createSession, openProjectWorkspace, openWorkflowTab,
  stubOpenDialog, type HarnessSession, type LaunchedApp,
} from './harness';
import { detectionProject, seedWithSuffix } from '../fixtures/project';
import { writePng } from '../fixtures/classification-images';
import { createCocoDataset, createCocoDatasetWithInvalidItems, type CocoDataset } from '../fixtures/coco';

test.describe.configure({ mode: 'serial' });

let session: HarnessSession;
let parentDirectory: string;
const fixtureRoots: string[] = [];

test.beforeAll(() => {
  session = createSession('import-detection');
  parentDirectory = mkdtempSync(join(tmpdir(), 'autovision-e2e-parent-'));
});

test.afterAll(() => {
  session.dispose();
  for (const root of [parentDirectory, ...fixtureRoots]) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

const referenceProjectName = seedWithSuffix(detectionProject, 'reference').name;
let referenceDataset: CocoDataset | null = null;

async function openImportTab(launched: LaunchedApp, suffix: string): Promise<string> {
  const seed = seedWithSuffix(detectionProject, suffix);
  await createProjectViaUi(launched, { ...seed, parentDirectory });
  await openWorkflowTab(launched.page, '取り込む');
  await expect(launched.page.getByRole('heading', { name: '画像を取り込む' })).toBeVisible();
  return seed.name;
}

async function scanCoco(
  launched: LaunchedApp,
  dataset: { root: string; annotationPath: string },
  mode: 'コピー（推奨）' | '参照',
): Promise<void> {
  await launched.page.getByRole('radio', { name: 'COCO アノテーション' }).check();
  await launched.page.getByRole('radio', { name: mode }).check();
  // Folder first, then the COCO JSON: two sequential native dialogs.
  await stubOpenDialog(launched.app, [[dataset.root], [dataset.annotationPath]]);
  await launched.page.getByRole('button', { name: 'データを選択して検査' }).click();
}

async function awaitPreview(page: Page): Promise<void> {
  await expect(page.getByRole('checkbox', { name: /データの利用権利・条件と自分の責任を確認しました/u }))
    .toBeVisible({ timeout: 90_000 });
}

async function confirmAndCommit(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /データの利用権利・条件と自分の責任を確認しました/u }).check();
  await page.getByRole('button', { name: '取り込む', exact: true }).click();
}

test('imports a COCO dataset and records its classes', async () => {
  const launched = await session.launch();
  const dataset = createCocoDataset();
  fixtureRoots.push(dataset.root);

  await openImportTab(launched, 'coco');
  await scanCoco(launched, dataset, 'コピー（推奨）');
  await awaitPreview(launched.page);

  // Categories from the annotation file appear as editable class names.
  const classNames = launched.page.getByRole('region', { name: 'クラス一覧' }).getByRole('textbox');
  await expect(classNames).toHaveCount(dataset.categoryNames.length);
  for (const [index, name] of dataset.categoryNames.entries()) {
    await expect(classNames.nth(index)).toHaveValue(name);
  }
  // A clean dataset must report no scan problems.
  await expect(launched.page.getByRole('region', { name: '問題一覧' }).getByRole('listitem')).toHaveCount(0);

  await confirmAndCommit(launched.page);
  const receipt = launched.page.getByRole('region', { name: '結果記録' });
  await expect(receipt).toBeVisible({ timeout: 90_000 });
  await expect(receipt).toContainText(`${dataset.imageCount}件を取り込みました。`);

  await session.close(launched);
});

test('reports invalid COCO items instead of dropping them', async () => {
  const launched = await session.launch();
  const dataset = createCocoDatasetWithInvalidItems();
  fixtureRoots.push(dataset.root);

  await openImportTab(launched, 'coco-invalid');
  await scanCoco(launched, dataset, 'コピー（推奨）');

  // Unknown image id, unknown category id and an out-of-bounds bbox must each
  // surface in the problem list. Silent acceptance is the failure mode.
  const problems = launched.page.getByRole('region', { name: '問題一覧' }).getByRole('listitem');
  await expect(problems.first()).toBeVisible({ timeout: 90_000 });
  const reported = await problems.count();
  expect(reported, 'every invalid COCO annotation must be reported').toBeGreaterThanOrEqual(
    dataset.invalidAnnotationIds.length,
  );

  await session.close(launched);
});

test('keeps Reference-imported images reachable after an application restart', async () => {
  let launched = await session.launch();
  const dataset = createCocoDataset();
  fixtureRoots.push(dataset.root);
  referenceDataset = dataset;

  const seed = seedWithSuffix(detectionProject, 'reference');
  expect(seed.name).toBe(referenceProjectName);
  await createProjectViaUi(launched, { ...seed, parentDirectory });
  await openWorkflowTab(launched.page, '取り込む');
  await scanCoco(launched, dataset, '参照');
  await awaitPreview(launched.page);
  await confirmAndCommit(launched.page);
  await expect(launched.page.getByRole('region', { name: '結果記録' })).toBeVisible({ timeout: 90_000 });

  // Restart and re-read through the product's own context-isolated bridge.
  // The annotation surface is not mounted in the shell (see ProjectWorkspace's
  // "未実装です" panel), so the bridge is the only reachable product path.
  await session.close(launched);
  launched = await session.launch();

  const reloaded = await launched.page.evaluate(async (projectName: string) => {
    const projects = await window.autoVision.projects.list();
    if (!projects.ok) return { stage: 'projects', ok: false as const };
    const match = projects.value.find((entry) => entry.project.name === projectName);
    if (!match) return { stage: 'project-missing', ok: false as const };
    const projectId = match.project.id;
    const workspaces = await window.autoVision.annotations.workspaces({ projectId });
    if (!workspaces.ok || workspaces.value.length === 0) return { stage: 'workspaces', ok: false as const };
    const latest = workspaces.value.reduce((best, candidate) =>
      candidate.createdAt > best.createdAt ? candidate : best);
    const listed = await window.autoVision.annotations.list({
      projectId, workspaceId: latest.id, offset: 0, limit: 200,
    });
    if (!listed.ok) return { stage: 'list', ok: false as const };
    return { stage: 'list', ok: true as const, total: listed.value.total };
  }, seed.name);

  expect(reloaded, `Reference workspace unreachable at stage ${reloaded.stage}`).toMatchObject({ ok: true });
  expect(reloaded.ok && reloaded.total).toBe(dataset.imageCount);

  await session.close(launched);
});

test('re-reads Reference original bytes after restart from the product UI', async () => {
  const launched = await session.launch();

  // The gallery resolves `av-image://` through Main, which re-verifies the
  // Reference original's size and SHA-256 before serving any byte.
  await openProjectWorkspace(launched.page, referenceProjectName);
  await openWorkflowTab(launched.page, '教師データ');
  const thumbnails = launched.page.getByRole('list', { name: '画像一覧' }).locator('img');
  await expect(thumbnails.first()).toBeVisible({ timeout: 60_000 });

  const decoded = await thumbnails.first().evaluate(async (element) => {
    const image = element as HTMLImageElement;
    if (!image.complete) {
      await new Promise((settle) => {
        image.addEventListener('load', settle, { once: true });
        image.addEventListener('error', settle, { once: true });
      });
    }
    return { complete: image.complete, naturalWidth: image.naturalWidth };
  });
  expect(decoded.complete, 'Reference thumbnail must finish loading').toBe(true);
  expect(decoded.naturalWidth, 'Reference original must decode after restart').toBeGreaterThan(0);

  await session.close(launched);
});

test('relinks a moved Reference source from the UI', async () => {
  expect(referenceDataset, 'this spec is serial: the Reference import test must run first')
    .not.toBeNull();
  const launched = await session.launch();

  await openProjectWorkspace(launched.page, referenceProjectName);
  await openWorkflowTab(launched.page, '教師データ');

  // Healthy first: every saved original must verify before anything is moved.
  const check = launched.page.getByRole('button', { name: '参照元を確認' });
  await expect(check).toBeVisible({ timeout: 30_000 });
  await check.click();
  await expect(launched.page.getByText(/参照元 \d+ 件すべてを確認できました。/u)).toBeVisible({ timeout: 60_000 });

  // Move the originals away: the Project must report them, not fail silently.
  const dataset = referenceDataset!;
  const moved = `${dataset.root}-moved`;
  renameSync(dataset.root, moved);
  fixtureRoots.push(moved);
  await check.click();
  await expect(launched.page.getByText(/参照元 \d+ 件を確認できません。/u)).toBeVisible({ timeout: 60_000 });
  const broken = launched.page.getByRole('list', { name: '確認できない参照元' }).getByRole('listitem');
  const brokenCount = await broken.count();
  expect(brokenCount).toBeGreaterThan(0);

  // A different file must be refused: relink only accepts identical bytes.
  const decoy = join(moved, 'decoy.png');
  writePng(decoy, 8, 8, { red: 1, green: 2, blue: 3 });
  await stubOpenDialog(launched.app, [[decoy]]);
  await broken.first().getByRole('button', { name: '参照元を選び直す' }).click();
  await expect(launched.page.getByText('選んだファイルは元の内容と一致しません', { exact: false }))
    .toBeVisible({ timeout: 60_000 });

  // The real original, at its new path, is accepted. The imageKey is an opaque
  // scan key, so try the moved originals until the matching bytes are found.
  const notice = launched.page.getByText('参照元を選び直しました。');
  for (let index = 0; index < dataset.imageCount; index += 1) {
    await stubOpenDialog(launched.app, [[join(moved, 'images', `frame-${index}.png`)]]);
    await broken.first().getByRole('button', { name: '参照元を選び直す' }).click();
    await expect(launched.page.getByRole('status').filter({ hasText: /参照元|選んだファイル/u }).first())
      .toBeVisible({ timeout: 60_000 });
    if (await notice.count() > 0) break;
  }
  await expect(notice).toBeVisible({ timeout: 60_000 });

  await session.close(launched);
});
