import { z } from 'zod';

export const DIAGNOSTIC_EXPORT_CHANNEL = 'diagnostics:export' as const;

// A no-argument operation: Main collects its own report and asks for native
// confirmation. Renderer never supplies a report, filename, path or consent bit.
const exactResult = z.custom<Record<string, unknown>>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = Object.getOwnPropertyDescriptor(value, 'status');
  if (!status || !('value' in status)) return false;
  const keys = status.value === 'saved' ? ['status', 'path', 'byteLength', 'sha256']
    : status.value === 'cancelled' ? ['status'] : status.value === 'failed' ? ['status', 'code'] : [];
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => typeof key === 'string' && keys.includes(key)
    && 'value' in Object.getOwnPropertyDescriptor(value, key)!);
});

export const diagnosticExportResultSchema = exactResult.pipe(z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('saved'),
    // Display-only Main result, not a filesystem capability. Ownership is Main's responsibility.
    path: z.string().min(1).max(32767).refine((value) => /^[a-z]:[\\/]/i.test(value) && !/[\0-\x1f\x7f]/u.test(value)),
    byteLength: z.number().int().positive().max(8192), // SEC-07B fixed summary bound, not a raw-log policy.
    sha256: z.string().length(64).regex(/^[0-9a-f]+$/),
  }),
  z.strictObject({ status: z.literal('cancelled') }),
  z.strictObject({ status: z.literal('failed'), code: z.enum(['DIAGNOSTIC_EXPORT_FAILED', 'DIAGNOSTIC_EXPORT_BUSY']) }),
])).readonly();

export type DiagnosticExportResult = z.infer<typeof diagnosticExportResultSchema>;