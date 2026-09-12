import { isAbsolute, join, resolve } from 'node:path';

export interface AppPaths {
  readonly userData: string;
  /** Default location only; user-selected project workspaces may be elsewhere. */
  readonly projects: string;
  readonly cache: string;
  readonly logs: string;
}

/**
 * Computes locations without filesystem access or directory creation.
 * The caller in UIR-019 supplies Electron's app.getPath('userData').
 */
export function getAppPaths(userDataPath: string): Readonly<AppPaths> {
  if (
    typeof userDataPath !== 'string' ||
    userDataPath.length === 0 ||
    userDataPath.includes('\0') ||
    !isAbsolute(userDataPath)
  ) {
    throw new TypeError(
      'userDataPath must be a non-empty absolute path without NUL characters.',
    );
  }

  const userData = resolve(userDataPath);

  return Object.freeze({
    userData,
    projects: join(userData, 'projects'),
    cache: join(userData, 'cache'),
    logs: join(userData, 'logs'),
  });
}