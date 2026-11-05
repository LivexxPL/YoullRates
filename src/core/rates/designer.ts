// Generates style-specific rate curves (independent of PIDs).
import { clamp, sliderFactor } from '../math';
import type { FlightStyle, RateCurve, RateFeel, RateSet, Reason } from '../types';

interface StyleRates {
  rollPitch: RateCurve;
  yaw: RateCurve;
  summary: string;
}

/**
 * Starting curves for a 5" quad (Actual rates: center deg/s, max deg/s, expo).
 * - Freestyle: high max rate for snappy flips and rolls, a soft center for precise lines.
 * - Cinematic: low center sensitivity, low max and little expo: lots of stick travel per degree
 *   per second everywhere (high resolution) and no sudden change of gain along the stick.
 * - Racing: center sensitivity high relative to max and almost no expo, so the stick→rate map is
 *   close to linear and predictable through gates.
 */
export const STYLE_RATES: Record<FlightStyle, StyleRates> = {
  freestyle: {
    rollPitch: { center: 100, max: 850, expo: 0.5 },
    yaw: { center: 90, max: 650, expo: 0.45 },
    summary: 'Freestyle: 850°/s flips with a soft center (expo 0.50).',
  },
  cinematic: {
    rollPitch: { center: 50, max: 450, expo: 0.15 },
    yaw: { center: 40, max: 350, expo: 0.15 },
    summary: 'Cinematic: 50°/s center, 450°/s max, low expo for buttery, high-resolution moves.',
  },
  racing: {
    rollPitch: { center: 250, max: 700, expo: 0.1 },
    yaw: { center: 200, max: 550, expo: 0.05 },
    summary: 'Racing: near-linear curve (center 250°/s, max 700°/s, expo 0.10) for predictable tracking.',
  },
};

/** Big props rotate slower and look/feel better with lower rates; up to 5.5" keeps the 5" numbers. */
export function sizeRateFactor(propInches: number): number {
  return propInches > 5.5 ? (5.5 / propInches) ** 0.3 : 1;
}

/** Firmware-representable limits for Actual rates (center ≥ 10, max ≤ the 1998 setpoint limit). */
const MIN_CENTER = 10;
const MAX_RATE = 1800;

export function shapeCurve(base: RateCurve, feel: RateFeel, sizeFactor: number): RateCurve {
  const speed = sliderFactor(feel.speed, 0.3);
  const max = clamp(base.max * sizeFactor * speed, 200, MAX_RATE);
  // "Curve": linear (-1) raises the center toward the max and drops expo; strong expo (+1) does the opposite.
  const expo = clamp(base.expo + 0.35 * clamp(feel.curve, -1, 1), 0, 0.95);
  const center = clamp(base.center * sizeFactor * sliderFactor(feel.speed, 0.15) * sliderFactor(feel.center, 0.6) * sliderFactor(feel.curve, -0.5), MIN_CENTER, max);
  return { center, max, expo };
}

export interface RateDesign {
  rates: RateSet;
  reasons: Reason[];
}

export function designRates(style: FlightStyle, propInches: number, feel: RateFeel): RateDesign {
  const base = STYLE_RATES[style];
  const size = sizeRateFactor(propInches);
  const rollPitch = shapeCurve(base.rollPitch, feel, size);
  const yaw = shapeCurve(base.yaw, feel, size);
  const reasons: Reason[] = [{ topic: 'Rates', text: base.summary }];
  if (size < 0.995) {
    reasons.push({ topic: 'Rates', factor: size, text: `${propInches}" props: rates scaled down so big props stay smooth and connected.` });
  }
  if (Math.abs(feel.speed) > 0.05 || Math.abs(feel.center) > 0.05 || Math.abs(feel.curve) > 0.05) {
    reasons.push({ topic: 'Rates', text: 'Adjusted with your rate feel sliders (speed, center, curve).' });
  }
  return { rates: { roll: rollPitch, pitch: { ...rollPitch }, yaw }, reasons };
}
