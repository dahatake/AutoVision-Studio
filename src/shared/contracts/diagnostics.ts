import { z } from 'zod';

// CORE-12-C: the probe-hardware observations, not a support decision or an
// execution guarantee. No I/O, defaults, coercion, or fabricated observations.
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1);
const causeType = z.enum([
  'ImportError', 'OSError', 'ValueError', 'TypeError', 'RuntimeError', 'Exception',
]).nullable();
const groupNames = ['os', 'cpu', 'memory', 'disk', 'gpu', 'onnxRuntime', 'cuda'] as const;

function observation<Data extends z.ZodType, const Codes extends readonly [string, ...string[]]>(
  data: Data, codes: Codes,
) {
  return z.union([
    z.strictObject({ status: z.literal('ok'), data, error: z.null() }),
    z.strictObject({
      status: z.literal('error'), data: z.null(),
      error: z.strictObject({ code: z.enum(codes), causeType }),
    }),
    z.strictObject({ status: z.literal('not_checked'), data: z.null(), error: z.null() }),
  ]);
}

const cpuUnavailableData = z.strictObject({
  logicalCount: count.nullable(), name: text.nullable(),
}).refine((data) => data.logicalCount === null || data.logicalCount === 0 || data.name === null);

export const hardwareDiagnosticsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  command: z.literal('probe-hardware'),
  status: z.enum(['ok', 'partial', 'error']),
  os: observation(z.strictObject({
    name: z.literal('Windows'),
    major: count, minor: count, build: count,
    productType: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    // platform.machine() can return an empty or unfamiliar architecture.
    architecture: z.string(),
  }), ['unsupported-os', 'os-probe-failed']),
  cpu: z.union([
    observation(z.strictObject({ logicalCount: count.positive(), name: text }), ['cpu-probe-failed']),
    z.strictObject({
      status: z.literal('error'), data: cpuUnavailableData.nullable(),
      error: z.strictObject({ code: z.literal('cpu-data-unavailable'), causeType }),
    }),
  ]),
  memory: observation(z.strictObject({
    totalBytes: count, availableBytes: count, loadPercent: count.max(100),
  }).refine((data) => data.availableBytes <= data.totalBytes), ['memory-probe-failed']),
  disk: observation(z.strictObject({
    totalBytes: count, usedBytes: count, freeBytes: count,
  }).refine((data) => data.usedBytes <= data.totalBytes
    && data.freeBytes === data.totalBytes - data.usedBytes), ['invalid-disk-path', 'disk-probe-failed']),
  gpu: observation(z.strictObject({
    // The producer fails after 256 successful enumeration calls. An ok result
    // needs an end-of-enumeration call and can therefore contain at most 255.
    adapters: z.array(z.strictObject({
      DeviceName: z.string(), DeviceString: z.string(), StateFlags: count.max(0xffff_ffff),
    })).max(255),
    scope: z.literal('current-session-display-adapters'),
    computeStatus: z.literal('not_checked'),
  }), ['gpu-probe-failed', 'display-adapter-limit-exceeded']),
  onnxRuntime: observation(z.strictObject({
    version: text, providers: z.array(text), executionStatus: z.literal('not_checked'),
  }), ['onnxRuntime-probe-failed']),
  cuda: observation(z.strictObject({
    torchVersion: text, runtimeVersion: text.nullable(), available: z.boolean(),
    scope: z.literal('torch-runtime-only'), executionStatus: z.literal('not_checked'),
    physicalGpuPresence: z.null(),
  }), ['cuda-probe-failed']),
  camera: z.strictObject({
    status: z.literal('deferred'), streamOpened: z.literal(false),
    reasonCode: z.literal('check-on-inference-start'),
  }),
}).refine((report) => {
  const okCount = groupNames.filter((name) => report[name].status === 'ok').length;
  return report.status === (okCount === 7 ? 'ok' : okCount > 0 ? 'partial' : 'error');
}, { message: 'Inconsistent observation summary', path: ['status'] }).refine((report) => {
  if (report.os.status === 'error' && report.os.error.code === 'unsupported-os') {
    return groupNames.every((name) => name === 'os' || report[name].status === 'not_checked');
  }
  if (report.disk.status === 'error' && report.disk.error.code === 'invalid-disk-path') {
    return groupNames.every((name) => name === 'disk' || report[name].status === 'not_checked');
  }
  return true;
}, { message: 'Inconsistent early-exit observations' });

export type HardwareDiagnostics = z.infer<typeof hardwareDiagnosticsSchema>;