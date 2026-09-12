import { projectSchema, type Project } from '../../shared/contracts/project.js';
import type { DatabaseConnection } from '../db/database.js';

const columns = 'id, name, description, task_type AS taskType, workspace_path AS workspacePath, created_at AS createdAt, updated_at AS updatedAt';

export function findProject(database: DatabaseConnection, id: string): Project | undefined {
  const row = database.prepare(`SELECT ${columns} FROM projects WHERE id=?`).get(id);
  return row === undefined ? undefined : projectSchema.parse(row);
}

export function listProjects(database: DatabaseConnection): Project[] {
  return database.prepare(`SELECT ${columns} FROM projects ORDER BY updated_at DESC, id`).all()
    .map((row) => projectSchema.parse(row));
}

export function insertProject(database: DatabaseConnection, project: Project): void {
  database.prepare('INSERT INTO projects(id,name,description,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(project.id, project.name, project.description, project.taskType, project.workspacePath, project.createdAt, project.updatedAt);
}

export function replaceProject(database: DatabaseConnection, project: Project): boolean {
  // The predicate enforces the lock in the same write, not a separate read/check.
  return database.prepare(`UPDATE projects SET name=?,description=?,task_type=?,workspace_path=?,updated_at=?
    WHERE id=? AND (task_type_locked=0 OR task_type=?)`)
    .run(project.name, project.description, project.taskType, project.workspacePath, project.updatedAt, project.id, project.taskType).changes === 1;
}

/** Called inside the first Run creation transaction; never silently unlocked. */
export function lockProjectTaskType(database: DatabaseConnection, id: string): void {
  if (!database.inTransaction) throw new Error('Task type locking requires the Run creation transaction.');
  if (database.prepare('UPDATE projects SET task_type_locked=1 WHERE id=?').run(id).changes !== 1) {
    throw new Error('Project was not found.');
  }
}