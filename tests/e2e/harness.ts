import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
export const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Built artifacts the E2E run exercises. `npm run build` must precede the run. */
const builtArtifacts = ['dist/main/index.js', 'dist/preload/index.cjs', 'dist/renderer/index.html'];

export interface LaunchedApp {
  readonly app: ElectronApplication;
  readonly page: Page;
  /** Isolated Electron profile. Reused to prove restart persistence. */
  readonly userDataDirectory: string;
}

export interface HarnessSession {
  readonly userDataDirectory: string;
  /** Launches the built app against this session's profile. */
  launch(): Promise<LaunchedApp>;
  /** Closes the app and fails if any process of this session survives. */
  close(launched: LaunchedApp): Promise<void>;
  /** Removes the isolated profile. Safe to call when nothing is running. */
  dispose(): void;
}

function assertBuilt(): string {
  const missing = builtArtifacts.filter((relative) => !existsSync(join(repositoryRoot, relative)));
  if (missing.length > 0) {
    throw new Error(
      `E2E requires the pre-packaging build. Run "npm run build" first. Missing: ${missing.join(', ')}`,
    );
  }
  return join(repositoryRoot, 'dist/main/index.js');
}

function electronExecutablePath(): string {
  // Outside Electron the package entry resolves to the binary path string.
  const resolved: unknown = require('electron');
  if (typeof resolved !== 'string' || resolved.length === 0) {
    throw new Error('Unable to resolve the Electron executable from node_modules.');
  }
  return resolved;
}

/**
 * Lists still-running Electron processes whose command line carries this
 * session's unique profile path. Child processes (GPU, renderer, utility)
 * inherit `--user-data-dir`, so a non-empty result means a leak.
 */
export function residualProcessIds(userDataDirectory: string): readonly number[] {
  const script = [
    '$ErrorActionPreference = "Stop";',
    // Match the Electron binary only: the query process itself carries the
    // profile path on its own command line and must not count as a leak.
    "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" |",
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains(${JSON.stringify(userDataDirectory)}) } |`,
    'ForEach-Object { $_.ProcessId }',
  ].join(' ');
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true },
  );
  return output
    .split(/\r?\n/u)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
}

/**
 * Creates an isolated session. `--user-data-dir` is a stock Electron switch,
 * so no product code carries a test-only branch.
 */
export function createSession(label: string): HarnessSession {
  const mainEntry = assertBuilt();
  const executablePath = electronExecutablePath();
  const root = join(tmpdir(), 'autovision-e2e');
  mkdirSync(root, { recursive: true });
  const userDataDirectory = mkdtempSync(join(root, `${label}-`));

  return {
    userDataDirectory,
    async launch(): Promise<LaunchedApp> {
      const app = await electron.launch({
        executablePath,
        args: [mainEntry, `--user-data-dir=${userDataDirectory}`],
        cwd: repositoryRoot,
        timeout: 60_000,
      });
      const page = await app.firstWindow({ timeout: 60_000 });
      // Surface Renderer faults: a swallowed exception would otherwise look
      // like an ordinary assertion failure.
      page.on('pageerror', (error) => { console.error(`[renderer] ${error.message}`); });
      page.on('console', (message) => {
        if (message.type() === 'error') console.error(`[renderer console] ${message.text()}`);
      });
      await page.waitForLoadState('domcontentloaded');
      return { app, page, userDataDirectory };
    },
    async close(launched: LaunchedApp): Promise<void> {
      await launched.app.close();
      // Chromium tears children down asynchronously; poll briefly before failing.
      let remaining = residualProcessIds(userDataDirectory);
      for (let attempt = 0; attempt < 20 && remaining.length > 0; attempt += 1) {
        await new Promise((settle) => { setTimeout(settle, 500); });
        remaining = residualProcessIds(userDataDirectory);
      }
      expect(remaining, `Residual processes after close: ${remaining.join(', ')}`).toEqual([]);
    },
    dispose(): void {
      // A failed test may leave the app running; never mask that as a pass.
      try {
        rmSync(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        console.warn(`E2E profile retained for inspection: ${userDataDirectory}`);
      }
    },
  };
}

/** Confirms the context-isolated bridge is present before any UI assertion. */
export async function bridgeContractVersion(page: Page): Promise<number> {
  return page.evaluate(() => window.autoVision.contractVersion);
}

export interface ProjectCreationRequest {
  readonly name: string;
  /** Visible radio label in the creation form. */
  readonly taskLabel: '画像分類' | '物体検出';
  /** Directory the stubbed picker returns as the workspace parent. */
  readonly parentDirectory: string;
}

/**
 * Drives the real creation form. A successful create navigates straight into
 * the new Project's workspace, which is where the import tab lives.
 */
export async function createProjectViaUi(
  launched: LaunchedApp,
  request: ProjectCreationRequest,
): Promise<void> {
  const { app, page } = launched;
  await page.getByRole('button', { name: 'Project を作成' }).click();
  await stubOpenDialog(app, [[request.parentDirectory]]);
  await page.getByRole('button', { name: '親フォルダーを選択' }).click();
  await expect(page.getByText(request.parentDirectory, { exact: false })).toBeVisible();
  await page.getByLabel('名前（必須）').fill(request.name);
  await page.getByRole('radio', { name: request.taskLabel }).check();
  await page.getByRole('button', { name: '作成', exact: true }).click();
  await expect(page.getByRole('heading', { name: request.name, level: 1 })).toBeVisible();
}

export async function returnToProjectList(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Project 一覧に戻る' }).click();
  await expect(page.getByRole('heading', { name: 'Project 一覧' })).toBeVisible();
}

export function projectListEntry(page: Page, name: string) {
  return page.getByRole('list', { name: 'Project' }).getByRole('listitem').filter({ hasText: name });
}

/** Opens a Project from the list into its workspace. */
export async function openProjectWorkspace(page: Page, name: string): Promise<void> {
  await projectListEntry(page, name).getByRole('button', { name: new RegExp(`${name}.*を開く`, 'u') }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

export async function openWorkflowTab(page: Page, label: string): Promise<void> {
  await page.getByRole('tab', { name: label }).click();
  await expect(page.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
}

/**
 * Replaces the main-process open dialog for one launch. Each entry answers one
 * `showOpenDialog` call in order, so folder-then-annotation flows are covered.
 * This instruments the harness only; the product keeps its single native
 * `dialog` call path.
 */
export async function stubOpenDialog(
  app: ElectronApplication,
  responses: ReadonlyArray<readonly string[]>,
): Promise<void> {
  await app.evaluate(async ({ dialog }, queued: string[][]) => {
    let call = 0;
    const stub = async () => {
      const paths = queued[Math.min(call, queued.length - 1)] ?? [];
      call += 1;
      return { canceled: paths.length === 0, filePaths: paths };
    };
    (dialog as unknown as Record<string, unknown>).showOpenDialog = stub;
  }, responses.map((paths) => [...paths]));
}

/** Answers every `showOpenDialog` call with a user cancellation. */
export async function stubCancelledDialog(app: ElectronApplication): Promise<void> {
  await stubOpenDialog(app, [[]]);
}
