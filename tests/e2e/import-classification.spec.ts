import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  createProjectViaUi, createSession, openWorkflowTab, stubCancelledDialog, stubOpenDialog,
  type HarnessSession, type LaunchedApp,
} from './harness';
import { classificationProject, seedWithSuffix } from '../fixtures/project';
import {
  createClassFolderDataset, createCsvDataset, createDatasetWithCorruptFile, createUnlabeledDataset,
} from '../fixtures/classification-images';

test.describe.configure({ mode: 'serial' });

let session: HarnessSession;
let parentDirectory: string;
const fixtureRoots: string[] = [];

test.beforeAll(() => {
  session = createSession('import-classification');
  parentDirectory = mkdtempSync(join(tmpdir(), 'autovision-e2e-parent-'));
});

test.afterAll(() => {
  session.dispose();
  for (const root of [parentDirectory, ...fixtureRoots]) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

function track<T extends { root: string }>(dataset: T): T {
  fixtureRoots.push(dataset.root);
  return dataset;
}

async function openImportTab(launched: LaunchedApp, suffix: string): Promise<void> {
  const seed = seedWithSuffix(classificationProject, suffix);
  await createProjectViaUi(launched, { ...seed, parentDirectory });
  await openWorkflowTab(launched.page, '取り込む');
  await expect(launched.page.getByRole('heading', { name: '画像を取り込む' })).toBeVisible();
}

async function selectFormat(page: Page, format: string, mode: 'コピー（推奨）' | '参照'): Promise<void> {
  await page.getByRole('radio', { name: format }).check();
  await page.getByRole('radio', { name: mode }).check();
}

/** Scanning runs the real Python worker, so preview needs a generous wait. */
async function scanAndAwaitPreview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'データを選択して検査' }).click();
  await expect(page.getByRole('checkbox', { name: /データの利用権利・条件と自分の責任を確認しました/u }))
    .toBeVisible({ timeout: 90_000 });
}

test('imports a class-folder dataset only after rights are confirmed', async () => {
  const launched = await session.launch();
  const dataset = track(createClassFolderDataset());

  await openImportTab(launched, 'folder');
  await selectFormat(launched.page, 'クラス別フォルダー', 'コピー（推奨）');
  await stubOpenDialog(launched.app, [[dataset.root]]);
  await scanAndAwaitPreview(launched.page);

  // The rights gate blocks the commit until it is explicitly confirmed.
  const commit = launched.page.getByRole('button', { name: '取り込む', exact: true });
  await expect(commit).toBeDisabled();
  await launched.page.getByRole('checkbox', { name: /データの利用権利・条件と自分の責任を確認しました/u }).check();
  await expect(commit).toBeEnabled();
  await commit.click();

  const receipt = launched.page.getByRole('region', { name: '結果記録' });
  await expect(receipt).toBeVisible({ timeout: 90_000 });
  await expect(receipt).toContainText(`${dataset.imageCount}件を取り込みました。`);
  // Imported items are explicitly unconfirmed; import never creates Ground Truth.
  await expect(receipt).toContainText('画像は未確認です');

  await session.close(launched);
});

test('imports a CSV-labelled dataset through the folder-then-annotation picker', async () => {
  const launched = await session.launch();
  const dataset = track(createCsvDataset());

  await openImportTab(launched, 'csv');
  await selectFormat(launched.page, 'CSV ラベル', 'コピー（推奨）');
  // The first dialog picks the image root, the second the `path,label` CSV.
  await stubOpenDialog(launched.app, [[dataset.root], [dataset.csvPath]]);
  await scanAndAwaitPreview(launched.page);

  await launched.page.getByRole('checkbox', { name: /データの利用権利・条件と自分の責任を確認しました/u }).check();
  await launched.page.getByRole('button', { name: '取り込む', exact: true }).click();

  const receipt = launched.page.getByRole('region', { name: '結果記録' });
  await expect(receipt).toBeVisible({ timeout: 90_000 });
  await expect(receipt).toContainText(`${dataset.imageCount}件を取り込みました。`);

  await session.close(launched);
});

test('imports an unlabeled folder and cancelling the picker changes nothing', async () => {
  const launched = await session.launch();
  const dataset = track(createUnlabeledDataset());

  await openImportTab(launched, 'unlabeled');
  await selectFormat(launched.page, 'ラベルなし・フォルダー', 'コピー（推奨）');

  // Cancelling must return to the idle state without starting a scan.
  await stubCancelledDialog(launched.app);
  await launched.page.getByRole('button', { name: 'データを選択して検査' }).click();
  await expect(launched.page.getByRole('status').filter({ hasText: '選択をキャンセルしました。' }))
    .toBeVisible({ timeout: 60_000 });
  await expect(launched.page.getByRole('region', { name: '結果記録' })).toHaveCount(0);

  await stubOpenDialog(launched.app, [[dataset.root]]);
  await scanAndAwaitPreview(launched.page);
  await launched.page.getByRole('checkbox', { name: /データの利用権利・条件と自分の責任を確認しました/u }).check();
  await launched.page.getByRole('button', { name: '取り込む', exact: true }).click();

  const receipt = launched.page.getByRole('region', { name: '結果記録' });
  await expect(receipt).toBeVisible({ timeout: 90_000 });
  await expect(receipt).toContainText(`${dataset.imageCount}件を取り込みました。`);

  await session.close(launched);
});

test('reports a broken image instead of silently dropping it', async () => {
  const launched = await session.launch();
  const dataset = track(createDatasetWithCorruptFile());
  await openImportTab(launched, 'corrupt');
  await selectFormat(launched.page, 'クラス別フォルダー', 'コピー（推奨）');
  await stubOpenDialog(launched.app, [[dataset.root]]);
  await launched.page.getByRole('button', { name: 'データを選択して検査' }).click();

  // Either an inline scan issue or a blocking error is acceptable; silence is not.
  const alert = launched.page.getByRole('alert');
  const issues = launched.page.getByText('broken.png', { exact: false });
  await expect(alert.or(issues).first()).toBeVisible({ timeout: 90_000 });

  await session.close(launched);
});

test('refuses the import when the destination volume lacks capacity', () => {
  // `preflightImportCapacity` reads the real volume with `fs.statfs`, so an
  // E2E run cannot induce a shortage without falsifying disk state. Recorded
  // as NOT EXECUTED; `src/main/data/import-capacity.test.ts` covers the
  // calculation and the `IMPORT_CAPACITY` message. Never count this as a pass.
  test.skip(true, 'Not reproducible in E2E: needs a genuinely full destination volume (see src/main/data/import-capacity.test.ts).');
});
