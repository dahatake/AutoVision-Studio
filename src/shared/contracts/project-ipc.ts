import { z } from 'zod';

import { createProjectSchema, projectIdSchema, projectSchema, updateProjectSchema } from './project.js';

// CORE-07C: fixed operations only. Registration/transport belong to H/P;
// delete/preview must not be exposed before CORE-10/REL-04 and their wiring.
export const PROJECT_LIST_CHANNEL = 'project:list' as const;
export const PROJECT_GET_CHANNEL = 'project:get' as const;
export const PROJECT_CREATE_CHANNEL = 'project:create' as const;
export const PROJECT_UPDATE_CHANNEL = 'project:update' as const;
export const PROJECT_PICK_PARENT_CHANNEL = 'project:pick-parent' as const;
export const PROJECT_MOVE_CHANNEL = 'project:move' as const;
export const PROJECT_RECOVER_CHANNEL = 'project:recover' as const;

// Normalize before the existing UUID validator, including uppercase MAX UUID.
// Do not change the legacy DTO or duplicate its UUID rules in the IPC layer.
export const projectIpcIdSchema = z.string().toLowerCase().pipe(projectIdSchema);
export const projectParentTokenSchema = projectIpcIdSchema;

// list takes no argument; H must additionally reject extra IPC arguments.
export const projectListInputSchema = z.undefined();
export const projectGetInputSchema = z.strictObject({ projectId: projectIpcIdSchema }).readonly();
export const projectCreateInputSchema = createProjectSchema.omit({ workspacePath: true }).extend({
  parentToken: projectParentTokenSchema,
}).readonly();

// Keep the existing full metadata update (including its `id` field), not a
// partial patch. H parses this input, reads the current Project under the common
// write exclusion, and injects that DB workspacePath into updateProjectSchema.
// Renderer cannot rename the root, supply a snapshot, or bypass explicit move.
export const projectUpdateInputSchema = updateProjectSchema.omit({ workspacePath: true }).extend({
  id: projectIpcIdSchema,
}).readonly();
export const projectPickParentInputSchema = z.discriminatedUnion('purpose', [
  z.strictObject({ purpose: z.literal('create') }),
  z.strictObject({ purpose: z.literal('move'), projectId: projectIpcIdSchema }),
]).readonly();
export const projectMoveInputSchema = z.strictObject({
  projectId: projectIpcIdSchema, parentToken: projectParentTokenSchema,
}).readonly();
export const projectRecoverInputSchema = projectGetInputSchema;

// H owns ephemeral capabilities: bind each native selection to the requesting
// WebContents/main-frame document, purpose, and (for move) Project ID plus its
// Main-read snapshot. Keep the actual parent and directory identity in Main;
// displayPath is display-only, never authority or an input to create/move.
// Do not hold a lock/transaction while the native dialog is open. Revalidate
// sender, Project snapshot and selection after it closes AND before consuming
// the token. Missing/used/wrong-purpose/changed selections are STALE_SELECTION.
// Consume once, including failed/uncertain operations; invalidate on navigation
// or disposal. UUID syntax alone does not establish permission or freshness.
// receiptDirectory/protectedRoots also come exclusively from Main configuration.
export const projectParentSelectionSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('cancelled') }),
  z.strictObject({
    status: z.literal('selected'), token: projectParentTokenSchema,
    displayPath: createProjectSchema.shape.workspacePath,
  }),
]).readonly();

// The DTO keeps its existing fields/validation. Its path is the CURRENT DB
// root, not the selected parent or a receipt's proposed destination. Legacy
// metadata-only rows are not certified as owned directories by this schema.
// H must obtain task_type_locked from the Main repository/DB alongside Project;
// existing get/list DTOs do not contain it. Never default it or infer it from
// taskType/timestamps/jobs. No unprovided job/model/capacity fields are invented.
export const projectSnapshotSchema = z.strictObject({
  project: projectSchema.extend({ id: projectIpcIdSchema }).readonly(),
  taskTypeLocked: z.boolean(),
}).readonly();

export const projectIpcErrorCodeSchema = z.enum([
  'INVALID_REQUEST', 'NOT_FOUND', 'BUSY', 'OPERATION_FAILED', 'STALE_SELECTION',
]);
// Code-only failures: no native message, stack, paths, cause or old snapshot.
// OPERATION_FAILED includes an unacknowledged commit/response: it NEVER proves
// rollback or that the old root is intact. Call get (list after create) to learn
// current DB values before retrying; a failed read must remain uncertain.
export const projectIpcErrorSchema = z.strictObject({ code: projectIpcErrorCodeSchema }).readonly();

// Exact public warning already emitted by CORE-06F, not an arbitrary exception.
export const PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE =
  '旧保存場所の回収を確認できませんでした。現在の保存先を保持しています。移動をやり直さず、明示的な復旧で確認してください。' as const;
export const projectCleanupErrorSchema = z.strictObject({
  code: z.literal('PROJECT_SOURCE_CLEANUP_FAILED'),
  message: z.literal(PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE).optional(),
}).readonly();

// Preserve F's actual result: none means no receipt, NOT cleanup completed.
// source-retained may mean partial/unconfirmed cleanup, with or without a
// warning. A post-commit E2 failure stays ok:true with the current DB Project;
// never replace it with ok:false or a pre-move snapshot. Only E2 can complete.
export const projectMoveValueSchema = z.discriminatedUnion('cleanupStatus', [
  projectSnapshotSchema.unwrap().extend({ cleanupStatus: z.literal('none') }),
  projectSnapshotSchema.unwrap().extend({
    cleanupStatus: z.literal('source-retained'), cleanupError: projectCleanupErrorSchema.optional(),
  }),
  projectSnapshotSchema.unwrap().extend({ cleanupStatus: z.literal('completed') }),
]).readonly();

// Local schema composition only, not a channel registry or dynamic RPC API.
function projectResponse<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: projectIpcErrorSchema }),
  ]).readonly();
}

// H validates outbound values; P uses the same per-operation validators on the
// received clone. Serialization does not preserve Object.freeze by itself.
export const projectListResponseSchema = projectResponse(z.array(projectSnapshotSchema).readonly());
export const projectGetResponseSchema = projectResponse(projectSnapshotSchema);
export const projectCreateResponseSchema = projectResponse(projectSnapshotSchema);
export const projectUpdateResponseSchema = projectResponse(projectSnapshotSchema);
export const projectPickParentResponseSchema = projectResponse(projectParentSelectionSchema);
export const projectMoveResponseSchema = projectResponse(projectMoveValueSchema);
export const projectRecoverResponseSchema = projectResponse(projectMoveValueSchema);

export type ProjectListInput = z.infer<typeof projectListInputSchema>;
export type ProjectGetInput = z.infer<typeof projectGetInputSchema>;
// The legacy create description default is retained; parsed input has a string.
export type ProjectCreateInput = Readonly<z.input<typeof projectCreateInputSchema>>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateInputSchema>;
export type ProjectPickParentInput = z.infer<typeof projectPickParentInputSchema>;
export type ProjectMoveInput = z.infer<typeof projectMoveInputSchema>;
export type ProjectRecoverInput = z.infer<typeof projectRecoverInputSchema>;
export type ProjectParentSelection = z.infer<typeof projectParentSelectionSchema>;
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;
export type ProjectIpcErrorCode = z.infer<typeof projectIpcErrorCodeSchema>;
export type ProjectIpcError = z.infer<typeof projectIpcErrorSchema>;
export type ProjectMoveValue = z.infer<typeof projectMoveValueSchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
export type ProjectGetResponse = z.infer<typeof projectGetResponseSchema>;
export type ProjectCreateResponse = z.infer<typeof projectCreateResponseSchema>;
export type ProjectUpdateResponse = z.infer<typeof projectUpdateResponseSchema>;
export type ProjectPickParentResponse = z.infer<typeof projectPickParentResponseSchema>;
export type ProjectMoveResponse = z.infer<typeof projectMoveResponseSchema>;
export type ProjectRecoverResponse = z.infer<typeof projectRecoverResponseSchema>;

export interface ProjectApi {
  readonly list: () => Promise<ProjectListResponse>;
  readonly get: (input: ProjectGetInput) => Promise<ProjectGetResponse>;
  readonly create: (input: ProjectCreateInput) => Promise<ProjectCreateResponse>;
  readonly update: (input: ProjectUpdateInput) => Promise<ProjectUpdateResponse>;
  readonly pickParent: (input: ProjectPickParentInput) => Promise<ProjectPickParentResponse>;
  readonly move: (input: ProjectMoveInput) => Promise<ProjectMoveResponse>;
  readonly recover: (input: ProjectRecoverInput) => Promise<ProjectRecoverResponse>;
}