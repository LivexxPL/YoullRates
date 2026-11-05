// The rates a flight controller will actually fly: the compiled integers (after any expert edits)
// through the firmware's own formula and per-axis rate limit. Shared by the live chart and the
// simulator, so both always show exactly what the CLI script writes.
import { canonicalRate } from '../core/rates/fit';
import { evaluateRate, RATE_MODELS } from '../core/rates/models';
import type { CanonicalTune } from '../core/tuning/engine';
import { AXES, type Axis, type PerAxis } from '../core/types';
import type { CompiledConfig, ParsedDump } from './types';

/** Setpoint in deg/s for a normalised RC command in [-1, 1] (Betaflight `rcCommandf`). */
export type AxisRate = (rcCommandf: number) => number;

const numberParam = (config: CompiledConfig | undefined, name: string): number | undefined => {
  const value = config?.params.find((p) => p.name === name)?.value;
  const n = typeof value === 'number' ? value : Number(value);
  return value === undefined || !Number.isFinite(n) ? undefined : n;
};

export function flownRate(axis: Axis, tune: CanonicalTune, config?: CompiledConfig): AxisRate {
  const fit = config?.rateFit[axis];
  if (!fit) return (x) => canonicalRate(tune.rates[axis], x);
  const model = RATE_MODELS[fit.model];
  const options = {
    // `<axis>_rate_limit` is only present after an expert edit; otherwise the firmware default applies.
    rateLimit: numberParam(config, `${axis}_rate_limit`),
    quickRatesRcExpo: String(config?.params.find((p) => p.name === 'quickrates_rc_expo')?.value ?? 'OFF').toUpperCase() === 'ON',
  };
  return (x) => evaluateRate(model, fit.raw, x, options);
}

export function flownRates(tune: CanonicalTune, config?: CompiledConfig): PerAxis<AxisRate> {
  return Object.fromEntries(AXES.map((axis) => [axis, flownRate(axis, tune, config)])) as PerAxis<AxisRate>;
}

/** Betaflight stick deadbands in µs (`deadband` for roll/pitch, `yaw_deadband`), default 0. */
export interface Deadbands {
  rollPitch: number;
  yaw: number;
}

/** Deadbands from an expert edit, else from an imported `diff all`, else the firmware default 0. */
export function deadbandsFor(config?: CompiledConfig, imported?: ParsedDump): Deadbands {
  const read = (name: string) => numberParam(config, name) ?? (imported?.master[name] !== undefined ? Number(imported.master[name]) : undefined);
  const safe = (v: number | undefined, max: number) => (v === undefined || !Number.isFinite(v) ? 0 : Math.min(max, Math.max(0, Math.round(v))));
  // Ranges from cli/settings.c: deadband 0…32, yaw_deadband 0…100.
  return { rollPitch: safe(read('deadband'), 32), yaw: safe(read('yaw_deadband'), 100) };
}
