import { describe, expect, it } from 'vitest';

import { createProjectSchema, projectIdSchema, projectSchema, updateProjectSchema } from './project';

const id = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const input = { name: ' Project 日本語 ', taskType: 'classification', workspacePath: 'C:\\Projects\\日本語' };
const saved = { ...input, description: '', id, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z' };

describe('Project contracts', () => {
  it.each(['classification', 'detection'])('accepts %s and preserves Unicode metadata', (taskType) => {
    expect(createProjectSchema.parse({ ...input, taskType })).toEqual({ ...input, taskType, name: 'Project 日本語', description: '' });
  });
  it('normalizes UUID case without generating an identity', () => {
    expect(projectIdSchema.parse(id.toUpperCase())).toBe(id);
    expect(projectIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
  it.each(['', ' ', '\t\n', '\u3000', '\u00a0'])('rejects whitespace-only name %j', (name) => {
    expect(createProjectSchema.safeParse({ ...input, name }).success).toBe(false);
  });
  it.each(['segmentation', '', null])('rejects unsupported task %j', (taskType) => {
    expect(createProjectSchema.safeParse({ ...input, taskType }).success).toBe(false);
  });
  it.each(['', '  ', 'C:\\bad\0folder'])('rejects missing/invalid path %j', (workspacePath) => {
    expect(createProjectSchema.safeParse({ ...input, workspacePath }).success).toBe(false);
  });
  it('preserves a selected path and description without trimming their contents', () => {
    const value = { ...input, workspacePath: 'C:\\ Projects 日本語 ', description: '  説明\n改行  ' };
    expect(createProjectSchema.parse(value)).toMatchObject({ workspacePath: value.workspacePath, description: value.description });
  });
  it.each(['id', 'createdAt', 'updatedAt', 'extra'])('rejects client-supplied creation field %s', (field) => {
    expect(createProjectSchema.safeParse({ ...input, [field]: id }).success).toBe(false);
  });
  it('requires a complete update and rejects immutable timestamps', () => {
    const value = { ...input, id, description: 'updated' };
    expect(updateProjectSchema.parse(value)).toMatchObject({ id, name: 'Project 日本語', description: 'updated' });
    expect(updateProjectSchema.safeParse({ id, name: 'partial' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ ...value, createdAt: saved.createdAt }).success).toBe(false);
  });
  it('validates persisted UUID, timestamp types, and exact fields', () => {
    expect(projectSchema.parse(saved).id).toBe(id);
    for (const value of [{ ...saved, id: 'x' }, { ...saved, createdAt: 'yesterday' }, { ...saved, updatedAt: 123 }, { ...saved, modelVersion: 'fake' }]) {
      expect(projectSchema.safeParse(value).success).toBe(false);
    }
  });
  it.each([null, undefined, [], 'Project'])('rejects non-object input %j', (value) => {
    expect(createProjectSchema.safeParse(value).success).toBe(false);
  });
});