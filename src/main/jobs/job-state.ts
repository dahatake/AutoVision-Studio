import { jobKindSchema, jobStatusSchema, type JobKind, type JobStatus } from '../../shared/contracts/job.js';

// Source: docs/requirement-definition.md FR-TRN-011/013 and §10 graph.
// Interrupted -> Running is a conditional resume edge in that graph, NOT an
// ordinary update. It stays closed here until JOB-06/TRN-13 implement checks
// of code version, checkpoint format and Dataset Revision hash. No resume flag.
const trainingTransitions: Record<JobStatus, readonly JobStatus[]> = {
  Queued: ['Preparing', 'Cancelled'],
  Preparing: ['Running', 'Failed', 'Cancelled'],
  Running: ['Exporting', 'Interrupted', 'Failed', 'Cancelled'],
  Exporting: ['Evaluating', 'Failed'],
  Evaluating: ['Succeeded', 'Failed'],
  Succeeded: [],
  Failed: [],
  Cancelled: [],
  Interrupted: ['Cancelled'],
};

// JOB-02 design choice, not a quoted training requirement: the scan-dataset
// and assist commands (implementation-plan.md DAT-01/AST-04, RD FR-AST-001/018)
// produce scan/suggestion results, not models. Keep preparation/failure/cancel/
// interruption edges, but finish directly from Running; no export/evaluation
// phases and no invented non-training checkpoint/resume contract.
const nonTrainingTransitions: Record<JobStatus, readonly JobStatus[]> = {
  Queued: ['Preparing', 'Cancelled'],
  Preparing: ['Running', 'Failed', 'Cancelled'],
  Running: ['Succeeded', 'Interrupted', 'Failed', 'Cancelled'],
  Exporting: [],
  Evaluating: [],
  Succeeded: [],
  Failed: [],
  Cancelled: [],
  Interrupted: ['Cancelled'],
};

/** Vocabulary validation is separate from permission; unknown values are false. */
export function isTerminalJobStatus(status: unknown): boolean {
  const parsed = jobStatusSchema.safeParse(status);
  return parsed.success && (parsed.data === 'Succeeded' || parsed.data === 'Failed' || parsed.data === 'Cancelled');
}

/** Ordinary lifecycle edges only; does not authorize worker execution/resume. */
export function canTransitionJob(kind: unknown, from: unknown, to: unknown): boolean {
  const parsedKind = jobKindSchema.safeParse(kind);
  const parsedFrom = jobStatusSchema.safeParse(from);
  const parsedTo = jobStatusSchema.safeParse(to);
  if (!parsedKind.success || !parsedFrom.success || !parsedTo.success) return false;
  const transitions = parsedKind.data === 'train' ? trainingTransitions : nonTrainingTransitions;
  return transitions[parsedFrom.data].includes(parsedTo.data);
}

export function assertJobTransition(kind: JobKind, from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(kind, from, to)) throw new Error('Job transition is not allowed.');
}