import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  createProjectViaUi, createSession, openWorkflowTab, stubOpenDialog,
  type HarnessSession, type LaunchedApp,
} from './harness';
import { classificationProject, seedWithSuffix } from '../fixtures/project';
import { createClassFolderDataset } from '../fixtures/classification-images';

test.describe.configure({ mode: 'serial' });

let session: HarnessSession;
let parentDirectory: string;
const fixtureRoots: string[] = [];

test.beforeAll(() => {
  session = createSession('annotation-classification');
  parentDirectory = mkdtempSync(join(tmpdir(), 'autovision-e2e-parent-'));
});

test.afterAll(() => {
  session.dispose();
  for (const root of [parentDirectory, ...fixtureRoots]) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

/** Imports a labelled folder so the annotation workspace has items to confirm. */
async function importClassificationDataset(launched: LaunchedApp): Promise<number> {
  const dataset = createClassFolderDataset();
  fixtureRoots.push(dataset.root);
  const seed = seedWithSuffix(classificationProject, 'annotate');
  await createProjectViaUi(launched, { ...seed, parentDirectory });
  await openWorkflowTab(launched.page, '取り込む');
  await launched.page.getByRole('radio', { name: 'クラス別フォルダー' }).check();
  await launched.page.getByRole('radio', { name: 'コピー（推奨）' }).check();
  await stubOpenDialog(launched.app, [[dataset.root]]);
  await launched.page.getByRole('button', { name: 'データを選択して検査' }).click();
  await launched.page.getByRole('checkbox', { name: /データの利用権利・条件と自分の責任を確認しました/u })
    .check({ timeout: 90_000 });
  await launched.page.getByRole('button', { name: '取り込む', exact: true }).click();
  await expect(launched.page.getByRole('region', { name: '結果記録' })).toBeVisible({ timeout: 90_000 });
  return dataset.imageCount;
}

test('labels every imported image, confirms it and queues the Dataset Revision', async () => {
  const launched = await session.launch();
  const expected = await importClassificationDataset(launched);

  await openWorkflowTab(launched.page, '教師データ');

  // Wave 2A-2F leaves are composed by AnnotationWorkspacePage and mounted here.
  await expect(
    launched.page.getByRole('heading', { name: '教師データ作成', level: 1 }),
    'AnnotationPage must be mounted in the workspace',
  ).toBeVisible({ timeout: 30_000 });

  const gallery = launched.page.getByRole('list', { name: '画像一覧' });
  await expect(gallery.getByRole('listitem')).toHaveCount(expected);

  // Assign exactly one class per image, then confirm each as Ground Truth.
  const classSelect = launched.page.getByLabel('クラス', { exact: true });
  for (let index = 0; index < expected; index += 1) {
    await gallery.getByRole('listitem').nth(index).click();
    await expect(classSelect).toBeEnabled();
    const options = await classSelect.locator('option:not([disabled])').all();
    const chosen = await options[index % options.length]!.getAttribute('value');
    await classSelect.selectOption(chosen!);
    await launched.page.getByRole('button', { name: '確認済みにする' }).click();
    await expect(launched.page.getByText('この画像は確認済みです。')).toBeVisible({ timeout: 30_000 });
  }
  await expect(launched.page.getByText(/未確認\s*0\s*件/u)).toBeVisible({ timeout: 30_000 });

  // Confirm dialog -> Revision commit -> Training Run reaches Queued.
  await launched.page.getByRole('button', { name: 'Dataset を確定する' }).click();
  const dialog = launched.page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The breakdown under 由来 must be provenance kinds, never validation codes.
  const provenance = dialog.getByRole('region', { name: 'provenance 内訳' });
  await expect(provenance).toHaveText(/(manual|import-unmodified|import-edited|model-accepted|model-edited): [0-9]/u);
  await expect(provenance).not.toContainText('unconfirmed');
  await expect(provenance).not.toContainText('記録なし');
  await dialog.getByRole('button', { name: '確定して学習 Queue へ渡す' }).click();
  await expect(launched.page.getByText(/学習ジョブ .* は Queued です。/u)).toBeVisible({ timeout: 60_000 });

  await session.close(launched);
});
