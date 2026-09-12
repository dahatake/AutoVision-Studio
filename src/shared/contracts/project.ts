import { z } from 'zod';

export const projectIdSchema = z.uuid().transform((id) => id.toLowerCase());
export const taskTypeSchema = z.enum(['classification', 'detection']);
const projectNameSchema = z.string().trim().min(1, 'Project名を入力してください。');

// Structural validation only. Main must verify the selected Windows directory,
// ownership and permissions before performing any filesystem operation.
const workspacePathSchema = z.string().min(1).refine(
  (path) => path.trim().length > 0 && !path.includes('\0'),
  '保存場所を指定してください。',
);
const editableFields = {
  name: projectNameSchema,
  description: z.string(),
  taskType: taskTypeSchema,
  workspacePath: workspacePathSchema,
};

// Create input selects an existing parent. Main creates an exclusive UUID child
// and returns/persists only that canonical root as Project.workspacePath.
export const createProjectSchema = z.strictObject({
  ...editableFields,
  description: z.string().default(''),
});
// A full editable snapshot, not a partial patch; lock checks belong to Main.
// workspacePath must stay unchanged until a validated mover is available.
export const updateProjectSchema = z.strictObject({
  id: projectIdSchema,
  ...editableFields,
});
// Legacy metadata-only paths are retained, not implicitly adopted or moved.
export const projectSchema = z.strictObject({
  id: projectIdSchema,
  ...editableFields,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
export type Project = z.infer<typeof projectSchema>;