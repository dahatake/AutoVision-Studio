/** CORE-14 / FR-UI (長時間処理前の警告). This reports ONLY what the OS actually
 * exposes through Electron's powerMonitor. A value that cannot be read stays
 * `unknown`; it is never inferred from the platform, defaults or past readings.
 */
export type PowerThermalUnknownReason = 'unsupported-platform' | 'unavailable';
export type BatteryStatus = 'on-battery' | 'on-ac' | 'unknown';
export type ThermalStatus = 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';

export interface PowerThermalReading {
  readonly battery: { readonly status: BatteryStatus; readonly reason?: PowerThermalUnknownReason };
  readonly thermal: { readonly status: ThermalStatus; readonly reason?: PowerThermalUnknownReason };
}

/** The subset of Electron's powerMonitor this module uses. Main injects the real
 * module; nothing here imports electron, so the rules stay testable in Node.
 */
export interface PowerMonitorLike {
  isOnBatteryPower?: () => unknown;
  getCurrentThermalState?: () => unknown;
}

const thermalStates: readonly ThermalStatus[] = ['nominal', 'fair', 'serious', 'critical'];

function readBattery(monitor: PowerMonitorLike | undefined): PowerThermalReading['battery'] {
  if (typeof monitor?.isOnBatteryPower !== 'function') {
    return Object.freeze({ status: 'unknown' as const, reason: 'unavailable' as const });
  }
  let value: unknown;
  try {
    value = monitor.isOnBatteryPower();
  } catch {
    return Object.freeze({ status: 'unknown' as const, reason: 'unavailable' as const });
  }
  if (typeof value !== 'boolean') return Object.freeze({ status: 'unknown' as const, reason: 'unavailable' as const });
  return Object.freeze({ status: value ? 'on-battery' as const : 'on-ac' as const });
}

function readThermal(monitor: PowerMonitorLike | undefined, platform: NodeJS.Platform): PowerThermalReading['thermal'] {
  // Electron implements getCurrentThermalState on macOS only. Elsewhere its
  // reply carries no measurement, so reporting it as a state would be invented.
  if (platform !== 'darwin') {
    return Object.freeze({ status: 'unknown' as const, reason: 'unsupported-platform' as const });
  }
  if (typeof monitor?.getCurrentThermalState !== 'function') {
    return Object.freeze({ status: 'unknown' as const, reason: 'unavailable' as const });
  }
  let value: unknown;
  try {
    value = monitor.getCurrentThermalState();
  } catch {
    return Object.freeze({ status: 'unknown' as const, reason: 'unavailable' as const });
  }
  if (typeof value !== 'string' || !thermalStates.includes(value as ThermalStatus)) {
    return Object.freeze({ status: 'unknown' as const, reason: 'unavailable' as const });
  }
  return Object.freeze({ status: value as ThermalStatus });
}

export function readPowerThermal(
  monitor?: PowerMonitorLike, platform: NodeJS.Platform = process.platform,
): PowerThermalReading {
  return Object.freeze({ battery: readBattery(monitor), thermal: readThermal(monitor, platform) });
}
