import { z } from 'zod';

import { projectIdSchema } from './project.js';

// Structural validation only: Main supplies the identity; parsing creates none.
export const jobIdSchema = z.uuid().transform((id) => id.toLowerCase());
// Planned command names: DAT-01, AST-04 and TRN-14. Camera is a separate session.
export const jobKindSchema = z.enum(['scan-dataset', 'assist', 'train']);
// FR-TRN-011 / RD §10. Membership is not permission to transition or resume;
// JOB-02 and JOB-06 own those checks, including terminal Cancelled handling.
export const jobStatusSchema = z.enum([
  'Queued', 'Preparing', 'Running', 'Exporting', 'Evaluating',
  'Succeeded', 'Failed', 'Cancelled', 'Interrupted',
]);

// Persisted snapshot, not a creation request or a worker envelope. Request
// payloads belong to JOB-03 / DAT-01 / AST-04 / TRN-14; stdout and artifacts to
// JOB-04. No guessed progress, model/config fields or generated timestamps.
export const jobSchema = z.strictObject({
  id: jobIdSchema,
  projectId: projectIdSchema,
  kind: jobKindSchema,
  status: jobStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type JobKind = z.infer<typeof jobKindSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type Job = z.infer<typeof jobSchema>;