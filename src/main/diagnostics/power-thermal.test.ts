// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { readPowerThermal, type PowerMonitorLike } from './power-thermal.js';

const monitor = (overrides: PowerMonitorLike): PowerMonitorLike => overrides;

describe('CORE-14 power and thermal reading', () => {
  it('reports the battery state the OS actually returns', () => {
    expect(readPowerThermal(monitor({ isOnBatteryPower: () => true }), 'win32').battery)
      .toEqual({ status: 'on-battery' });
    expect(readPowerThermal(monitor({ isOnBatteryPower: () => false }), 'win32').battery)
      .toEqual({ status: 'on-ac' });
  });

  it('returns unknown instead of guessing when the battery cannot be read', () => {
    expect(readPowerThermal(undefined, 'win32').battery).toEqual({ status: 'unknown', reason: 'unavailable' });
    expect(readPowerThermal(monitor({}), 'win32').battery).toEqual({ status: 'unknown', reason: 'unavailable' });
    expect(readPowerThermal(monitor({ isOnBatteryPower: () => { throw new Error('denied'); } }), 'win32').battery)
      .toEqual({ status: 'unknown', reason: 'unavailable' });
    // A non-boolean reply is not evidence of AC power.
    expect(readPowerThermal(monitor({ isOnBatteryPower: () => 'false' }), 'win32').battery)
      .toEqual({ status: 'unknown', reason: 'unavailable' });
  });

  it('never claims a thermal state on platforms that do not provide one', () => {
    const claimsNominal = monitor({ isOnBatteryPower: () => false, getCurrentThermalState: () => 'nominal' });
    expect(readPowerThermal(claimsNominal, 'win32').thermal)
      .toEqual({ status: 'unknown', reason: 'unsupported-platform' });
    expect(readPowerThermal(claimsNominal, 'linux').thermal)
      .toEqual({ status: 'unknown', reason: 'unsupported-platform' });
  });

  it('reports the thermal state where the OS supplies it', () => {
    for (const state of ['nominal', 'fair', 'serious', 'critical'] as const) {
      expect(readPowerThermal(monitor({ getCurrentThermalState: () => state }), 'darwin').thermal)
        .toEqual({ status: state });
    }
    expect(readPowerThermal(monitor({ getCurrentThermalState: () => 'unknown' }), 'darwin').thermal)
      .toEqual({ status: 'unknown', reason: 'unavailable' });
    expect(readPowerThermal(monitor({ getCurrentThermalState: () => { throw new Error('denied'); } }), 'darwin').thermal)
      .toEqual({ status: 'unknown', reason: 'unavailable' });
    expect(readPowerThermal(monitor({}), 'darwin').thermal).toEqual({ status: 'unknown', reason: 'unavailable' });
  });

  it('reads both values independently and returns a frozen reading', () => {
    const reading = readPowerThermal(monitor({
      isOnBatteryPower: () => true, getCurrentThermalState: () => 'serious',
    }), 'darwin');

    expect(reading).toEqual({ battery: { status: 'on-battery' }, thermal: { status: 'serious' } });
    expect(Object.isFrozen(reading)).toBe(true);
    expect(Object.isFrozen(reading.battery)).toBe(true);
  });
});
