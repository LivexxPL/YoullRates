// Rate curves exactly as the flight controllers compute them.
//
// Betaflight: src/main/fc/rc.c, applyBetaflightRates / applyRaceFlightRates / applyKissRates /
// applyActualRates / applyQuickRates (identical in 4.4, 4.5, 2025.12 and 2026.6), followed by the
// per-axis `*_rate_limit` clamp in calculateSetpointRate().
// INAV: src/main/fc/rc_curves.c rcLookup() + flight/pid.c pidRcCommandToRate().
//
// Parameters are the raw integers stored in the flight controller (the values of the CLI
// `set` commands), so every curve drawn or fitted here is one the firmware can really produce.
import { clamp } from '../math';

export type RateModelId = 'ACTUAL' | 'BETAFLIGHT' | 'KISS' | 'RACEFLIGHT' | 'QUICK' | 'INAV';

/** Raw rate-profile integers. Betaflight CLI names: `<axis>_rc_rate`, `<axis>_srate`, `<axis>_expo`. */
export interface RawRateParams {
  rcRate: number;
  superRate: number;
  expo: number;
}

export interface RateParamSpec {
  key: keyof RawRateParams;
  /** Label used by the configurator for this rates type. */
  label: string;
  /** Raw bounds the fitter may use (CLI bounds, or the configurator's when narrower). */
  min: number;
  max: number;
  /** Raw integer → value as the configurator displays it. */
  display: (raw: number) => string;
}

export interface RateEvalOptions {
  /** `<axis>_rate_limit` (Betaflight 200…1998, default 1998). */
  rateLimit?: number;
  /** Betaflight `quickrates_rc_expo` (QUICK rates only). */
  quickRatesRcExpo?: boolean;
}

export interface RateModel {
  id: RateModelId;
  label: string;
  description: string;
  params: readonly RateParamSpec[];
  /** Setpoint rate in deg/s for a stick deflection in [-1, 1]. */
  rate(p: RawRateParams, stick: number, options?: RateEvalOptions): number;
}

/** Betaflight SETPOINT_RATE_LIMIT_MAX and the default `*_rate_limit`. */
export const BETAFLIGHT_RATE_LIMIT = 1998;
/** INAV GYRO_SATURATION_LIMIT. */
export const INAV_RATE_LIMIT = 1800;
const RC_RATE_INCREMENTAL = 14.54;

const power3 = (x: number) => x * x * x;
const power5 = (x: number) => x * x * x * x * x;
const fixed = (digits: number, scale: number) => (raw: number) => (raw / scale).toFixed(digits);
const degPerSec = (scale: number) => (raw: number) => `${raw * scale}°/s`;

const actual: RateModel = {
  id: 'ACTUAL',
  label: 'Actual',
  description: 'Center sensitivity, max rate and expo, each set directly (Betaflight default since 4.3).',
  params: [
    { key: 'rcRate', label: 'Center sensitivity', min: 1, max: 255, display: degPerSec(10) },
    { key: 'superRate', label: 'Max rate', min: 0, max: 255, display: degPerSec(10) },
    { key: 'expo', label: 'Expo', min: 0, max: 100, display: fixed(2, 100) },
  ],
  rate(p, stick) {
    const abs = Math.abs(stick);
    const expoF = p.expo / 100;
    const expoCurve = abs * (power5(stick) * expoF + stick * (1 - expoF));
    const centerSensitivity = p.rcRate * 10;
    const stickMovement = Math.max(0, p.superRate * 10 - centerSensitivity);
    return stick * centerSensitivity + stickMovement * expoCurve;
  },
};

const betaflight: RateModel = {
  id: 'BETAFLIGHT',
  label: 'Betaflight',
  description: 'Classic RC rate / super rate / expo (Betaflight default before 4.3).',
  params: [
    { key: 'rcRate', label: 'RC rate', min: 1, max: 255, display: fixed(2, 100) },
    // The configurator caps super rate at 1.00; the curve degenerates (×100) as it approaches 1.
    { key: 'superRate', label: 'Super rate', min: 0, max: 99, display: fixed(2, 100) },
    { key: 'expo', label: 'RC expo', min: 0, max: 100, display: fixed(2, 100) },
  ],
  rate(p, stick) {
    const abs = Math.abs(stick);
    let command = stick;
    if (p.expo) {
      const expoF = p.expo / 100;
      command = stick * power3(abs) * expoF + stick * (1 - expoF);
    }
    let rcRate = p.rcRate / 100;
    if (rcRate > 2) rcRate += RC_RATE_INCREMENTAL * (rcRate - 2);
    let angleRate = 200 * rcRate * command;
    if (p.superRate) {
      angleRate *= 1 / clamp(1 - abs * (p.superRate / 100), 0.01, 1);
    }
    return angleRate;
  },
};

const raceflight: RateModel = {
  id: 'RACEFLIGHT',
  label: 'RaceFlight',
  description: 'Rate (deg/s), acro+ and expo.',
  params: [
    { key: 'rcRate', label: 'Rate', min: 1, max: 255, display: degPerSec(10) },
    { key: 'superRate', label: 'Acro+', min: 0, max: 255, display: (raw) => String(raw) },
    { key: 'expo', label: 'Expo', min: 0, max: 100, display: (raw) => String(raw) },
  ],
  rate(p, stick) {
    const abs = Math.abs(stick);
    const command = (1 + 0.01 * p.expo * (stick * stick - 1)) * stick;
    const angleRate = 10 * p.rcRate * command;
    return angleRate * (1 + abs * p.superRate * 0.01);
  },
};

const kiss: RateModel = {
  id: 'KISS',
  label: 'KISS',
  description: 'RC rate, rate and RC curve as in KISS firmware.',
  params: [
    { key: 'rcRate', label: 'RC rate', min: 1, max: 255, display: fixed(2, 100) },
    { key: 'superRate', label: 'Rate', min: 0, max: 99, display: fixed(2, 100) },
    { key: 'expo', label: 'RC curve', min: 0, max: 100, display: fixed(2, 100) },
  ],
  rate(p, stick) {
    const abs = Math.abs(stick);
    const rcCurve = p.expo / 100;
    const useRates = 1 / clamp(1 - abs * (p.superRate / 100), 0.01, 1);
    const command = (power3(stick) * rcCurve + stick * (1 - rcCurve)) * (p.rcRate / 1000);
    return clamp(2000 * useRates * command, -BETAFLIGHT_RATE_LIMIT, BETAFLIGHT_RATE_LIMIT);
  },
};

const quick: RateModel = {
  id: 'QUICK',
  label: 'Quick',
  description: 'Center rate, max rate and expo with a super-rate shaped transition.',
  params: [
    { key: 'rcRate', label: 'RC rate', min: 1, max: 255, display: fixed(2, 100) },
    { key: 'superRate', label: 'Max rate', min: 0, max: 255, display: degPerSec(10) },
    { key: 'expo', label: 'Expo', min: 0, max: 100, display: fixed(2, 100) },
  ],
  rate(p, stick, options) {
    const abs = Math.abs(stick);
    const rcRate = p.rcRate * 2; // uint16_t in the firmware
    const maxDps = Math.max(p.superRate * 10, rcRate);
    const expoF = p.expo / 100;
    const superFactorConfig = (maxDps / rcRate - 1) / (maxDps / rcRate);
    if (options?.quickRatesRcExpo) {
      const curve = power3(stick) * expoF + stick * (1 - expoF);
      const superFactor = 1 / clamp(1 - abs * superFactorConfig, 0.01, 1);
      return clamp(curve * rcRate * superFactor, -BETAFLIGHT_RATE_LIMIT, BETAFLIGHT_RATE_LIMIT);
    }
    const curve = power3(abs) * expoF + abs * (1 - expoF);
    const superFactor = 1 / clamp(1 - curve * superFactorConfig, 0.01, 1);
    return clamp(stick * rcRate * superFactor, -BETAFLIGHT_RATE_LIMIT, BETAFLIGHT_RATE_LIMIT);
  },
};

const inav: RateModel = {
  id: 'INAV',
  label: 'INAV',
  description: 'Linear max rate (deg/s ÷ 10) shaped by a cubic expo.',
  params: [
    // roll_rate / pitch_rate: ROLL_PITCH_RATE_MIN 4 … ROLL_PITCH_RATE_MAX 180 (yaw_rate 1 … 180).
    { key: 'rcRate', label: 'Rate', min: 4, max: 180, display: degPerSec(10) },
    { key: 'expo', label: 'Expo', min: 0, max: 100, display: (raw) => String(raw) },
  ],
  rate(p, stick) {
    // rcLookup() works on the integer stick deflection (±500) and returns an integer rcCommand.
    const deflection = Math.round(clamp(stick, -1, 1) * 500);
    const t = deflection / 100;
    const rcCommand = Math.round(((2500 + p.expo * (t * t - 25)) * t) / 25);
    return clamp((rcCommand / 500) * p.rcRate * 10, -INAV_RATE_LIMIT, INAV_RATE_LIMIT);
  },
};

export const RATE_MODELS: Record<RateModelId, RateModel> = {
  ACTUAL: actual,
  BETAFLIGHT: betaflight,
  KISS: kiss,
  RACEFLIGHT: raceflight,
  QUICK: quick,
  INAV: inav,
};

/** Firmware-exact rate including the per-axis rate limit. */
export function evaluateRate(model: RateModel, params: RawRateParams, stick: number, options: RateEvalOptions = {}): number {
  const limit = options.rateLimit ?? (model.id === 'INAV' ? INAV_RATE_LIMIT : BETAFLIGHT_RATE_LIMIT);
  return clamp(model.rate(params, clamp(stick, -1, 1), options), -limit, limit);
}

export interface CurveStats {
  /** Rate at full stick (deg/s). */
  max: number;
  /** Slope at stick center (deg/s per full stick), i.e. Actual "center sensitivity". */
  center: number;
  /** Rate at half stick (deg/s). */
  half: number;
}

/**
 * Slope at stick center (deg/s per full stick). Curves are c·x + a·x·|x| + … near zero, so a
 * Richardson step cancels the quadratic term; h = 0.004 is two steps of INAV's integer stick (±500).
 */
export function centerSlope(rate: (stick: number) => number): number {
  const h = 0.004;
  return 2 * (rate(h) / h) - rate(2 * h) / (2 * h);
}

export function curveStats(rate: (stick: number) => number): CurveStats {
  return { max: rate(1), center: centerSlope(rate), half: rate(0.5) };
}

/** Points (stick 0…1) for drawing a curve. Curves are odd functions, so one half is enough. */
export function sampleCurve(rate: (stick: number) => number, count = 61): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const x = i / (count - 1);
    return { x, y: rate(x) };
  });
}
