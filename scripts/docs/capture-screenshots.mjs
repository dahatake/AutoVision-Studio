// Captures the screenshots used by users-guide/.
// Prerequisite: the pre-packaging build (dist/). Usage: node scripts/docs/capture-screenshots.mjs
// Runs against an isolated, temporary profile and bundled public sample data (Beans, GWHD).
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { _electron as electron } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'users-guide', 'images');
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(root, 'dist/main/index.js'))) throw new Error('Build first (dist/ is missing).');

// A neutral location keeps the user name out of the captured folder paths.
const neutralBase = join(parse(tmpdir()).root, 'AutoVisionDemo');
mkdirSync(neutralBase, { recursive: true });
const work = mkdtempSync(join(neutralBase, 'run-'));
const parent = join(work, 'Projects');
const beans = join(work, 'beans');
const wheat = join(work, 'wheat');
const wheatAnnotations = join(wheat, 'annotations.coco.json');
mkdirSync(parent);
cpSync(join(root, 'resources/samples/beans/images'), beans, { recursive: true });
cpSync(join(root, 'resources/samples/gwhd-2021/images'), join(wheat, 'images'), { recursive: true });
cpSync(join(root, 'resources/samples/gwhd-2021/annotations.coco.json'), wheatAnnotations);

const app = await electron.launch({
  executablePath: require('electron'),
  args: [join(root, 'dist/main/index.js'), `--user-data-dir=${join(work, 'profile')}`],
  cwd: root,
  timeout: 60_000,
});
const page = await app.firstWindow({ timeout: 60_000 });
await page.waitForLoadState('domcontentloaded');
const windowHandle = await app.browserWindow(page);
await windowHandle.evaluate((window) => {
  window.setContentSize(1280, 1000);
  window.center();
});

const stubDialog = (responses) => app.evaluate(async ({ dialog }, queued) => {
  let call = 0;
  dialog.showOpenDialog = async () => {
    const paths = queued[Math.min(call, queued.length - 1)] ?? [];
    call += 1;
    return { canceled: paths.length === 0, filePaths: paths };
  };
}, responses);
const shot = async (name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('captured', name);
};
const imagesLoaded = () => page.waitForFunction(
  () => [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  undefined,
  { timeout: 30_000 },
).catch(() => {});
const tab = async (label) => {
  await page.getByRole('tab', { name: label }).click();
  await page.waitForTimeout(400);
};

try {
  await page.getByRole('button', { name: 'Project を作成' }).waitFor({ timeout: 30_000 });
  await page.getByText('取得済み', { exact: true }).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot('01-project-list-empty');

  await page.getByRole('button', { name: 'Project を作成' }).click();
  await stubDialog([[parent]]);
  await page.getByRole('button', { name: '親フォルダーを選択' }).click();
  await page.getByLabel('名前（必須）').fill('豆の葉の病気');
  await page.getByRole('radio', { name: '画像分類' }).check();
  await shot('02-project-create');
  await page.getByRole('button', { name: '作成', exact: true }).click();
  await page.getByRole('heading', { name: '豆の葉の病気', level: 1 }).waitFor();
  await shot('03-workspace');

  await tab('取り込む');
  await page.getByRole('radio', { name: 'クラス別フォルダー' }).check();
  await page.getByRole('radio', { name: 'コピー（推奨）' }).check();
  await shot('04-import-start');
  await stubDialog([[beans]]);
  await page.getByRole('button', { name: 'データを選択して検査' }).click();
  const rights = page.getByRole('checkbox', { name: /データの利用権利・条件と自分の責任を確認しました/u });
  await rights.waitFor({ timeout: 120_000 });
  await rights.scrollIntoViewIfNeeded();
  await shot('05-import-preview');
  await rights.check();
  await page.getByRole('button', { name: '取り込む', exact: true }).click();
  await page.getByRole('region', { name: '結果記録' }).waitFor({ timeout: 120_000 });
  await page.getByRole('region', { name: '結果記録' }).scrollIntoViewIfNeeded();
  await shot('06-import-result');

  await tab('教師データ');
  const gallery = page.getByRole('list', { name: '画像一覧' });
  await gallery.getByRole('listitem').first().waitFor({ timeout: 60_000 });
  await gallery.getByRole('listitem').first().click();
  await imagesLoaded();
  await shot('07a-annotations-top');
  await page.getByLabel('クラス', { exact: true }).scrollIntoViewIfNeeded();
  await shot('07-annotations-classification');

  for (const [label, name] of [['学習', '08-training'], ['結果', '09-reports'], ['カメラで試す', '10-camera']]) {
    await tab(label);
    await shot(name);
  }

  await page.getByRole('link', { name: '設定' }).click();
  await page.waitForTimeout(500);
  for (const [label, name] of [
    ['Project', '11-settings-project'], ['ラベル定義', '12-settings-labels'], ['推論', '13-settings-inference'],
    ['端末・容量', '14-settings-device'], ['ライセンス・情報', '15-settings-information'],
  ]) {
    await page.getByRole('navigation', { name: '設定カテゴリ' }).getByText(label, { exact: true }).click();
    // The device page lists this machine's hardware, so it is described in text instead.
    if (label !== '端末・容量') await shot(name);
  }

  await page.getByRole('link', { name: 'Project 一覧' }).click();
  if (!(await page.getByRole('heading', { name: 'Project 一覧' }).isVisible())) {
    await page.getByRole('link', { name: 'Project 一覧' }).click();
  }
  await page.getByRole('button', { name: 'Project を作成' }).click();
  await stubDialog([[parent]]);
  await page.getByRole('button', { name: '親フォルダーを選択' }).click();
  await page.locator('input[id$="-name"]').fill('小麦の穂の検出');
  await page.getByRole('radio', { name: '物体検出' }).check();
  await page.getByRole('button', { name: '作成', exact: true }).click();
  await page.getByRole('heading', { name: '小麦の穂の検出', level: 1 }).waitFor();
  await tab('取り込む');
  await page.getByRole('radio', { name: 'COCO アノテーション' }).check();
  await page.getByRole('radio', { name: 'コピー（推奨）' }).check();
  await stubDialog([[join(wheat, 'images')], [wheatAnnotations]]);
  await page.getByRole('button', { name: 'データを選択して検査' }).click();
  const wheatRights = page.getByRole('checkbox', { name: /データの利用権利・条件と自分の責任を確認しました/u });
  await wheatRights.waitFor({ timeout: 120_000 });
  await wheatRights.check();
  await page.getByRole('button', { name: '取り込む', exact: true }).click();
  await page.getByRole('region', { name: '結果記録' }).waitFor({ timeout: 120_000 });
  await tab('教師データ');
  const wheatGallery = page.getByRole('list', { name: '画像一覧' });
  await wheatGallery.getByRole('listitem').first().waitFor({ timeout: 60_000 });
  await wheatGallery.getByRole('listitem').first().click();
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ timeout: 30_000 });
  await imagesLoaded();
  await shot('17a-annotations-detection-top');
  await canvas.scrollIntoViewIfNeeded();
  await shot('17-annotations-detection');

  await page.getByRole('link', { name: 'Project 一覧' }).click();
  await shot('16-project-list');
} finally {
  await app.close();
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

