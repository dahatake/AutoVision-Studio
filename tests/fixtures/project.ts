/**
 * Deterministic Project seeds for E2E runs. Names are unique per process so a
 * leftover profile from an aborted run cannot make an assertion pass by chance.
 */
export interface ProjectSeed {
  readonly name: string;
  readonly taskType: 'classification' | 'detection';
  /** Visible radio label in the creation form. */
  readonly taskLabel: '画像分類' | '物体検出';
}

const runId = `${process.pid}-${Date.now().toString(36)}`;

export const classificationProject: ProjectSeed = {
  name: `E2E 分類 ${runId}`,
  taskType: 'classification',
  taskLabel: '画像分類',
};

export const detectionProject: ProjectSeed = {
  name: `E2E 検出 ${runId}`,
  taskType: 'detection',
  taskLabel: '物体検出',
};

export function seedWithSuffix(seed: ProjectSeed, suffix: string): ProjectSeed {
  return { ...seed, name: `${seed.name} ${suffix}` };
}
