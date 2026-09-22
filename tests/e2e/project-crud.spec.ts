import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  bridgeContractVersion, createProjectViaUi, createSession, projectListEntry, returnToProjectList,
  type HarnessSession,
} from './harness';
import { classificationProject, detectionProject } from '../fixtures/project';

test.describe.configure({ mode: 'serial' });

let session: HarnessSession;
let parentDirectory: string;

test.beforeAll(() => {
  session = createSession('project-crud');
  parentDirectory = mkdtempSync(join(tmpdir(), 'autovision-e2e-parent-'));
});

test.afterAll(() => {
  session.dispose();
  rmSync(parentDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('creates two Projects and keeps both across a full restart', async () => {
  let launched = await session.launch();

  // The context-isolated bridge is the only Renderer entry point.
  expect(await bridgeContractVersion(launched.page)).toBe(1);

  await createProjectViaUi(launched, { ...classificationProject, parentDirectory });
  await returnToProjectList(launched.page);
  await createProjectViaUi(launched, { ...detectionProject, parentDirectory });
  await returnToProjectList(launched.page);

  await expect(projectListEntry(launched.page, classificationProject.name)).toHaveCount(1);
  await expect(projectListEntry(launched.page, detectionProject.name)).toHaveCount(1);
  await expect(projectListEntry(launched.page, classificationProject.name)).toContainText('画像分類');
  await expect(projectListEntry(launched.page, detectionProject.name)).toContainText('物体検出');

  // Restart against the same profile: persistence must survive a full quit.
  await session.close(launched);
  launched = await session.launch();
  await expect(projectListEntry(launched.page, classificationProject.name)).toHaveCount(1);
  await expect(projectListEntry(launched.page, detectionProject.name)).toHaveCount(1);
  // Non-interference: neither Project adopted the other's task type.
  await expect(projectListEntry(launched.page, classificationProject.name)).toContainText('画像分類');
  await expect(projectListEntry(launched.page, detectionProject.name)).toContainText('物体検出');
  await session.close(launched);
});

test('deletes one Project through the preview dialog without touching the other', async () => {
  let launched = await session.launch();

  await projectListEntry(launched.page, detectionProject.name)
    .getByRole('button', { name: new RegExp(`${detectionProject.name}.*削除対象を確認`, 'u') })
    .click();
  const dialog = launched.page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The preview separates owned data from Reference originals, which are kept.
  await expect(dialog.getByRole('region', { name: '削除される所有データ' })).toBeVisible();
  await expect(dialog.getByRole('region', { name: '削除されない参照データ' })).toBeVisible();

  // Deletion requires an explicit acknowledgement; the button stays disabled until then.
  const remove = dialog.getByRole('button', { name: '削除する' });
  await expect(remove).toBeDisabled();
  await dialog.getByLabel('上記の所有データを削除することを確認しました。').check();
  await expect(remove).toBeEnabled();
  await remove.click();

  await expect(launched.page.getByText('参照元ファイルは削除していません', { exact: false }))
    .toBeVisible({ timeout: 60_000 });
  await expect(projectListEntry(launched.page, detectionProject.name)).toHaveCount(0);
  await expect(projectListEntry(launched.page, classificationProject.name)).toHaveCount(1);

  await session.close(launched);
  launched = await session.launch();
  await expect(projectListEntry(launched.page, detectionProject.name)).toHaveCount(0);
  await expect(projectListEntry(launched.page, classificationProject.name)).toHaveCount(1);
  await session.close(launched);
});
