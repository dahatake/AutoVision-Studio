-- Bundled migration 2. Transaction and user_version belong to migrateDatabase.
-- Main validates caller-supplied UUIDs and ISO timestamps with the Job contract.
-- This stores lifecycle metadata, not worker requests, progress or artifacts.
CREATE TABLE jobs (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE NO ACTION,
  kind TEXT NOT NULL CHECK (kind IN ('scan-dataset', 'assist', 'train')),
  status TEXT NOT NULL DEFAULT 'Queued' CHECK (status IN (
    'Queued', 'Preparing', 'Running', 'Exporting', 'Evaluating',
    'Succeeded', 'Failed', 'Cancelled', 'Interrupted'
  )),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
) STRICT;

-- Project history and the later single-training FIFO lookup (JOB-07).
CREATE INDEX jobs_project_created_at ON jobs(project_id, created_at, id);
CREATE INDEX jobs_kind_status_created_at ON jobs(kind, status, created_at, id);

-- No seeds or lifecycle triggers. JOB-02 owns legal transitions; the later
-- Training Run handoff locks projects.task_type_locked in the same transaction
-- as Run/job creation (FR-PRJ-006, ANN-22), not when scan/assist starts.