import { projectIdSchema } from '../../shared/contracts/project.js';
import type { DatabaseConnection } from '../db/database.js';

interface ProjectActivity { imports: boolean; moves: number }

// Main-only, per connection/normalized ID. No row lookup or filesystem authority:
// callers validate the Project. Existing move/service gates own move exclusion.
const activities = new WeakMap<DatabaseConnection, Map<string, ProjectActivity>>();

function activityFor(database: DatabaseConnection, id: string): ProjectActivity {
  let projects = activities.get(database);
  if (!projects) { projects = new Map(); activities.set(database, projects); }
  let activity = projects.get(id);
  if (!activity) { activity = { imports: false, moves: 0 }; projects.set(id, activity); }
  return activity;
}

function discardIdle(database: DatabaseConnection, id: string, activity: ProjectActivity): void {
  const projects = activities.get(database);
  if (activity.imports || activity.moves !== 0 || projects?.get(id) !== activity) return;
  projects.delete(id);
  if (projects.size === 0) activities.delete(database);
}

export function assertProjectNotImporting(database: DatabaseConnection, id: unknown): void {
  const projectId = projectIdSchema.parse(id);
  if (activities.get(database)?.get(projectId)?.imports) {
    throw new Error('Projectは取り込み中です。完了後に再試行してください。');
  }
}

/** Hold for the complete import operation; never adopt a caller transaction. */
export function beginProjectImport(database: DatabaseConnection, id: unknown): () => void {
  if (database.inTransaction) throw new Error('Project取り込みは既存のtransaction内では実行できません。');
  const projectId = projectIdSchema.parse(id);
  const activity = activityFor(database, projectId);
  if (activity.imports || activity.moves > 0) {
    throw new Error('Projectは移動中または取り込み中です。完了後に再試行してください。');
  }
  activity.imports = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activity.imports = false;
    discardIdle(database, projectId, activity);
  };
}

/** Reference counting permits legitimate service + low-level nesting. */
export function beginProjectMoveActivity(database: DatabaseConnection, id: unknown): () => void {
  const projectId = projectIdSchema.parse(id);
  assertProjectNotImporting(database, projectId);
  const activity = activityFor(database, projectId);
  activity.moves += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activity.moves -= 1;
    discardIdle(database, projectId, activity);
  };
}