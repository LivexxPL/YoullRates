// Curve fitting between rate models.
//
// The canonical rate description is a continuous Actual-rates curve (center, max, expo). A firmware
// stores integers in its own model, so compiling rates means: find the integer parameters of the
// target model whose curve is closest to the canonical one. The same fitter converts a pilot's
// existing rates (any type) into the canonical form and between Betaflight rates types.
import { clamp, goldenSectionMinimize } from '../math';
import type { RateCurve } from '../types';
import { centerSlope, evaluateRate, type RateModel, type RateModelId, type RawRateParams } from './models';

/** Continuous Actual-rates curve (same formula as the firmware, without integer storage). */
export function canonicalRate(curve: RateCurve, stick: number): number {
  const x = clamp(stick, -1, 1);
  const abs = Math.abs(x);
  const expoCurve = abs * (x ** 5 * curve.expo + x * (1 - curve.expo));
  const stickMovement = Math.max(0, curve.max - curve.center);
  return x * curve.center + stickMovement * expoCurve;
}

const SAMPLE_COUNT = 41;
const SAMPLES = Array.from({ length: SAMPLE_COUNT }, (_, i) => i / (SAMPLE_COUNT - 1));
// Feel is dominated by the center (fine corrections) and the full-stick rate (flip speed).
const WEIGHTS = SAMPLES.map((x) => 1 + (x <= 0.25 ? 2 : 0) + (x === 1 ? 6 : 0));
const WEIGHT_SUM = WEIGHTS.reduce((a, b) => a + b, 0);

function weightedRms(model: (x: number) => number, target: readonly number[]): number {
  let sum = 0;
  SAMPLES.forEach((x, i) => {
    const d = model(x) - (target[i] ?? 0);
    sum += (WEIGHTS[i] ?? 1) * d * d;
  });
  return Math.sqrt(sum / WEIGHT_SUM);
}

export interface FitResult {
  model: RateModelId;
  params: RawRateParams;
  /** Weighted RMS difference to the target curve, deg/s. */
  rmsError: number;
  /** Largest difference anywhere on the stick, deg/s. */
  maxError: number;
}

export interface FitOptions {
  rateLimit?: number;
  quickRatesRcExpo?: boolean;
}

/** Finds the integer parameters of `model` whose curve best matches `target` (deg/s for stick 0…1). */
export function fitRateModel(model: RateModel, target: (stick: number) => number, options: FitOptions = {}): FitResult {
  const targetValues = SAMPLES.map((x) => target(x));
  const keys = model.params.map((p) => p.key);
  const bounds = Object.fromEntries(model.params.map((p) => [p.key, [p.min, p.max] as const])) as Partial<Record<keyof RawRateParams, readonly [number, number]>>;
  const evalOptions = { rateLimit: options.rateLimit, quickRatesRcExpo: options.quickRatesRcExpo };
  const cost = (p: RawRateParams) => weightedRms((x) => evaluateRate(model, p, x, evalOptions), targetValues);
  const within = (p: RawRateParams) => keys.every((k) => {
    const b = bounds[k];
    return b !== undefined && p[k] >= b[0] && p[k] <= b[1];
  });

  // Seeds: a coarse grid over every used parameter plus the model-specific analytic guess.
  const seeds: RawRateParams[] = [];
  const levels = (k: keyof RawRateParams) => {
    const [lo, hi] = bounds[k] ?? [0, 0];
    return Array.from({ length: 7 }, (_, i) => Math.round(lo + ((hi - lo) * i) / 6));
  };
  const grid = (index: number, current: RawRateParams) => {
    const key = keys[index];
    if (key === undefined) {
      seeds.push({ ...current });
      return;
    }
    for (const v of levels(key)) grid(index + 1, { ...current, [key]: v });
  };
  grid(0, { rcRate: 0, superRate: 0, expo: 0 });
  const guess = analyticGuess(model, target);
  if (guess) seeds.push(guess);

  let best = seeds[0] ?? { rcRate: 1, superRate: 0, expo: 0 };
  let bestCost = Infinity;
  for (const seed of seeds) {
    if (!within(seed)) continue;
    const c = cost(seed);
    if (c < bestCost) {
      best = seed;
      bestCost = c;
    }
  }

  // Integer pattern search with shrinking steps.
  for (const step of [32, 16, 8, 4, 2, 1]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const key of keys) {
        for (const dir of [-1, 1]) {
          const candidate = { ...best, [key]: best[key] + dir * step };
          if (!within(candidate)) continue;
          const c = cost(candidate);
          if (c < bestCost - 1e-9) {
            best = candidate;
            bestCost = c;
            improved = true;
          }
        }
      }
    }
  }

  let maxError = 0;
  for (let i = 0; i <= 200; i++) {
    const x = i / 200;
    maxError = Math.max(maxError, Math.abs(evaluateRate(model, best, x, evalOptions) - target(x)));
  }
  return { model: model.id, params: best, rmsError: bestCost, maxError };
}

function analyticGuess(model: RateModel, target: (stick: number) => number): RawRateParams | undefined {
  const center = centerSlope(target);
  const max = target(1);
  if (model.id === 'ACTUAL') {
    const rcRate = clamp(Math.round(center / 10), 1, 255);
    const superRate = clamp(Math.round(max / 10), 0, 255);
    let bestExpo = 0;
    let bestCost = Infinity;
    const targetValues = SAMPLES.map((x) => target(x));
    for (let expo = 0; expo <= 100; expo++) {
      const p = { rcRate, superRate, expo };
      const c = weightedRms((x) => model.rate(p, x), targetValues);
      if (c < bestCost) {
        bestCost = c;
        bestExpo = expo;
      }
    }
    return { rcRate, superRate, expo: bestExpo };
  }
  if (model.id === 'INAV') {
    return { rcRate: clamp(Math.round(max / 10), 4, 180), superRate: 0, expo: clamp(Math.round((1 - center / Math.max(max, 1)) * 100), 0, 100) };
  }
  return undefined;
}

/** Converts any curve to the canonical continuous description (exact center and max, best expo). */
export function toCanonical(rate: (stick: number) => number): RateCurve {
  const center = Math.max(0, centerSlope(rate));
  const max = rate(1);
  const targetValues = SAMPLES.map((x) => rate(x));
  const expo = goldenSectionMinimize((e) => weightedRms((x) => canonicalRate({ center, max, expo: e }, x), targetValues), 0, 1);
  return { center, max, expo: Math.round(expo * 1000) / 1000 };
}

/** Canonical curve represented by raw Betaflight Actual integers. */
export function actualParamsToCurve(p: RawRateParams): RateCurve {
  const center = p.rcRate * 10;
  return { center, max: Math.max(center, p.superRate * 10), expo: p.expo / 100 };
}
