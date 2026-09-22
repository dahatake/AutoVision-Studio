import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  createProjectViaUi, createSession, openWorkflowTab, stubOpenDialog,
  type HarnessSession, type LaunchedApp,
} from './harness';
import { detectionProject, seedWithSuffix } from '../fixtures/project';
import { createCocoDatasetWithNegative } from '../fixtures/coco';

test.describe.configure({ mode: 'serial' });

let session: HarnessSession;
let parentDirectory: string;
const fixtureRoots: string[] = [];

test.beforeAll(() => {
  session = createSession('annotation-detection');
  parentDirectory = mkdtempSync(join(tmpdir(), 'autovision-e2e-parent-'));
});

test.afterAll(() => {
  session.dispose();
  for (const root of [parentDirectory, ...fixtureRoots]) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

/** Imports a COCO dataset so the detection workspace has items to confirm. */
async function importDetectionDataset(launched: LaunchedApp): Promise<number> {
  const dataset = createCocoDatasetWithNegative();
  fixtureRoots.push(dataset.root);
  const seed = seedWithSuffix(detectionProject, 'annotate');
  await createProjectViaUi(launched, { ...seed, parentDirectory });
  await openWorkflowTab(launched.page, '取り込む');
  await launched.page.getByRole('radio', { name: 'COCO アノテーション' }).check();
  await launched.page.getByRole('radio', { name: 'コピー（推奨）' }).check();
  await stubOpenDialog(launched.app, [[dataset.root], [dataset.annotationPath]]);
  await launched.page.getByRole('button', { name: 'データを選択して検査' }).click();
  await launched.page.getByRole('checkbox', { name: /データの利用権利・条件と自分の責任を確認しました/u })
    .check({ timeout: 90_000 });
  await launched.page.getByRole('button', { name: '取り込む', exact: true }).click();
  await expect(launched.page.getByRole('region', { name: '結果記録' })).toBeVisible({ timeout: 90_000 });
  return dataset.imageCount;
}

test('draws rectangles, records 対象物なし, confirms and queues the Dataset Revision', async () => {
  const launched = await session.launch();
  const expected = await importDetectionDataset(launched);

  await openWorkflowTab(launched.page, '教師データ');

  // Wave 2D leaves are composed by AnnotationWorkspacePage and mounted here.
  await expect(
    launched.page.getByRole('heading', { name: '教師データ作成', level: 1 }),
    'AnnotationPage must be mounted in the workspace',
  ).toBeVisible({ timeout: 30_000 });

  const gallery = launched.page.getByRole('list', { name: '画像一覧' });
  await expect(gallery.getByRole('listitem')).toHaveCount(expected);
  const regions = launched.page.getByRole('region', { name: '領域一覧' }).getByRole('listitem');

  // Gallery order is not part of the contract: locate the imported-negative
  // item and the annotated one by their actual region counts.
  let negativeIndex = -1;
  let annotatedIndex = -1;
  for (let index = 0; index < expected; index += 1) {
    await gallery.getByRole('listitem').nth(index).click();
    await expect(launched.page.getByRole('region', { name: '領域一覧' })).toBeVisible({ timeout: 30_000 });
    const count = await regions.count();
    if (count === 0 && negativeIndex === -1) negativeIndex = index;
    if (count > 0 && annotatedIndex === -1) annotatedIndex = index;
  }
  expect(negativeIndex, 'one imported item must have no annotation').toBeGreaterThanOrEqual(0);
  expect(annotatedIndex, 'one imported item must carry a COCO box').toBeGreaterThanOrEqual(0);

  // Annotated image: draw an extra rectangle inside the image, then confirm.
  await gallery.getByRole('listitem').nth(annotatedIndex).click();
  const canvas = launched.page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  expect(bounds, 'detection canvas must be laid out').not.toBeNull();
  const box = bounds!;
  const before = await regions.count();
  // Stay inside the drawn image: the draw surface covers the image only, so a
  // release beyond its edge never reaches the rectangle handlers.
  await launched.page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.40);
  await launched.page.mouse.down();
  await launched.page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.60, { steps: 10 });
  await launched.page.mouse.up();
  await expect(regions).toHaveCount(before + 1);
  await launched.page.getByRole('button', { name: '確認済みにする' }).click();
  await expect(launched.page.getByText('この画像は確認済みです。')).toBeVisible({ timeout: 30_000 });

  // Negative image: 対象物なし is an explicit statement that differs from 未着手.
  await gallery.getByRole('listitem').nth(negativeIndex).click();
  await expect(regions).toHaveCount(0);
  await expect(launched.page.getByText('未着手（対象物なしの確認はされていません）')).toBeVisible();
  await launched.page.getByRole('button', { name: '対象物なしとして確定' }).click();
  await expect(launched.page.getByText('対象物なし（確認済み）')).toBeVisible({ timeout: 30_000 });
  await expect(launched.page.getByText(/未確認\s*0\s*件/u)).toBeVisible({ timeout: 30_000 });

  await launched.page.getByRole('button', { name: 'Dataset を確定する' }).click();
  const dialog = launched.page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '確定して学習 Queue へ渡す' }).click();
  await expect(launched.page.getByText(/学習ジョブ .* は Queued です。/u)).toBeVisible({ timeout: 60_000 });

  await session.close(launched);
});
