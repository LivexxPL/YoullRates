// Betaflight "simplified tuning" (the PID sliders), ported from config/simplified_tuning.c.
//
// The firmware recomputes P/I/D/F from the slider values only on `simplified_tuning apply` and
// `defaults`, and the Betaflight App re-applies sliders when the PID tab is saved. So a script
// must either switch the sliders off (raw mode) or write slider values together with exactly the
// gains the firmware formula produces from them (slider mode, done here).
import type { PidGains } from '../../core/tuning/pid';
import type { Axis, PerAxis } from '../../core/types';

export interface SliderValues {
  masterMultiplier: number;
  piGain: number;
  iGain: number;
  dGain: number;
  /** "Dynamic damping": simplified_dmax_gain (4.4/4.5) / simplified_d_max_gain (2025.12+). */
  dMaxGain: number;
  feedforwardGain: number;
  pitchDGain: number;
  pitchPiGain: number;
}

export const DEFAULT_SLIDERS: SliderValues = { masterMultiplier: 100, piGain: 100, iGain: 100, dGain: 100, dMaxGain: 100, feedforwardGain: 100, pitchDGain: 100, pitchPiGain: 100 };

/** Gains with the firmware's integer storage (the formula's float result is truncated by constrain()). */
export interface IntegerGains {
  p: number;
  i: number;
  dMin: number;
  dMax: number;
  ff: number;
}

// PID_*_DEFAULT { P, I, D, F } and D_MIN_DEFAULT (4.4/4.5) / D_MAX_DEFAULT (2025.12+), flight/pid.h.
const DEFAULTS_D_IS_MAX = {
  roll: { p: 45, i: 80, d: 40, f: 120, dMin: 30 },
  pitch: { p: 47, i: 84, d: 46, f: 125, dMin: 34 },
  yaw: { p: 45, i: 80, d: 0, f: 120, dMin: 0 },
};
const DEFAULTS_D_IS_BASE = {
  roll: { p: 45, i: 80, d: 30, f: 120, dMax: 40 },
  pitch: { p: 47, i: 84, d: 34, f: 125, dMax: 46 },
  yaw: { p: 45, i: 80, d: 0, f: 120, dMax: 0 },
};

const PID_GAIN_MAX = 250;
const F_GAIN_MAX = 1000;
const constrainInt = (v: number, max: number) => Math.min(max, Math.max(0, Math.trunc(v)));

/** Firmware result of the sliders for one axis (axes outside the slider mode keep their gains). */
export function slidersToGains(s: SliderValues, axis: Axis, naming: 'd-is-max' | 'd-is-base'): IntegerGains {
  const mm = s.masterMultiplier / 100;
  const pi = s.piGain / 100;
  const dGain = s.dGain / 100;
  const ff = s.feedforwardGain / 100;
  const iGain = s.iGain / 100;
  const pitchD = axis === 'pitch' ? s.pitchDGain / 100 : 1;
  const pitchPi = axis === 'pitch' ? s.pitchPiGain / 100 : 1;
  const dMaxSlider = s.dMaxGain / 100;

  if (naming === 'd-is-max') {
    const def = DEFAULTS_D_IS_MAX[axis];
    const dMinRatio = def.dMin > 0 ? 1 + ((def.d - def.dMin) / def.dMin) * dMaxSlider : 1;
    return {
      p: constrainInt(def.p * mm * pi * pitchPi, PID_GAIN_MAX),
      i: constrainInt(def.i * mm * pi * iGain * pitchPi, PID_GAIN_MAX),
      dMax: constrainInt(def.dMin * mm * dGain * pitchD * dMinRatio, PID_GAIN_MAX),
      dMin: constrainInt(def.dMin * mm * dGain * pitchD, PID_GAIN_MAX),
      ff: constrainInt(def.f * mm * pitchPi * ff, F_GAIN_MAX),
    };
  }
  const def = DEFAULTS_D_IS_BASE[axis];
  const dMaxFactor = def.dMax > 0 ? dMaxSlider + (1 - dMaxSlider) * (def.d / def.dMax) : 1;
  return {
    p: constrainInt(def.p * mm * pi * pitchPi, PID_GAIN_MAX),
    i: constrainInt(def.i * mm * pi * iGain * pitchPi, PID_GAIN_MAX),
    dMin: constrainInt(def.d * mm * dGain * pitchD, PID_GAIN_MAX),
    dMax: constrainInt(def.dMax * mm * dGain * pitchD * dMaxFactor, PID_GAIN_MAX),
    ff: constrainInt(def.f * mm * pitchPi * ff, F_GAIN_MAX),
  };
}

const SLIDER_KEYS: readonly (keyof SliderValues)[] = ['masterMultiplier', 'piGain', 'iGain', 'dGain', 'dMaxGain', 'feedforwardGain', 'pitchDGain', 'pitchPiGain'];
const SLIDER_MAX = 200;

/** Relative error between the slider result and the target gains (roll, pitch, yaw P/I/D/F). */
function sliderCost(s: SliderValues, target: PerAxis<PidGains>, naming: 'd-is-max' | 'd-is-base'): number {
  let cost = 0;
  for (const axis of ['roll', 'pitch', 'yaw'] as const) {
    const g = slidersToGains(s, axis, naming);
    const t = target[axis];
    const rel = (a: number, b: number) => (b <= 0 ? a / 10 : (a - b) / b);
    cost += rel(g.p, t.p) ** 2 + rel(g.i, t.i) ** 2 + rel(g.ff, t.ff) ** 2;
    if (axis !== 'yaw') cost += 1.5 * rel(g.dMin, t.dMin) ** 2 + rel(g.dMax, t.dMax) ** 2;
  }
  return cost;
}

/**
 * Finds the integer slider positions (0…200 %) whose firmware result is closest to the target
 * gains. The engine's gains are "reference × multipliers", i.e. the same structure as the sliders,
 * so the fit is usually within one or two units of every target.
 */
export function fitSliders(
  target: PerAxis<PidGains>,
  naming: 'd-is-max' | 'd-is-base',
  /** Craft scaling to put on the master multiplier (rounded to the configurator's 0.05 steps). */
  masterHint?: number,
): { sliders: SliderValues; gains: PerAxis<IntegerGains>; cost: number } {
  if (masterHint !== undefined) {
    const mm = Math.min(SLIDER_MAX, Math.max(20, Math.round(masterHint * 20) * 5));
    const fit = fitWithMaster(target, naming, mm, false);
    const atBound = SLIDER_KEYS.some((k) => k !== 'masterMultiplier' && (fit.sliders[k] <= 0 || fit.sliders[k] >= SLIDER_MAX));
    if (!atBound) return fit;
  }
  // Master multiplier that keeps every other slider comfortably below 200 %.
  const roll = target.roll;
  const ref = DEFAULTS_D_IS_BASE;
  const largest = Math.max(roll.p / ref.roll.p, roll.dMin / ref.roll.d, roll.ff / ref.roll.f / 1.4, roll.i / ref.roll.i / 1.4);
  return fitWithMaster(target, naming, Math.min(SLIDER_MAX, Math.max(100, Math.round((largest / 1.6) * 20) * 5)), true);
}

function fitWithMaster(target: PerAxis<PidGains>, naming: 'd-is-max' | 'd-is-base', mm: number, refineMaster: boolean) {
  const roll = target.roll;
  const pitch = target.pitch;
  const ref = DEFAULTS_D_IS_BASE;
  const m = mm / 100;
  const pi = (roll.p / (ref.roll.p * m)) * 100;
  const d = (roll.dMin / (ref.roll.d * m)) * 100;
  const dRange = roll.dMin > 0 ? roll.dMax / roll.dMin : 1;
  const seed: SliderValues = {
    masterMultiplier: mm,
    piGain: pi,
    iGain: (roll.i / (ref.roll.i * m * (pi / 100))) * 100,
    dGain: d,
    // dMax/dMin = 1 + slider × (default range − 1); default range 40/30 → slider = 3 × (range − 1).
    dMaxGain: ((dRange - 1) / (ref.roll.dMax / ref.roll.d - 1)) * 100,
    feedforwardGain: (roll.ff / (ref.roll.f * m)) * 100,
    pitchDGain: (pitch.dMin / (ref.pitch.d * m * (d / 100))) * 100,
    pitchPiGain: (pitch.p / (ref.pitch.p * m * (pi / 100))) * 100,
  };
  let best = Object.fromEntries(SLIDER_KEYS.map((k) => [k, Math.min(SLIDER_MAX, Math.max(0, Math.round(seed[k])))])) as unknown as SliderValues;
  let bestCost = sliderCost(best, target, naming);
  const keys = refineMaster ? SLIDER_KEYS : SLIDER_KEYS.filter((k) => k !== 'masterMultiplier');
  for (const step of [8, 4, 2, 1]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const key of keys) {
        for (const dir of [-1, 1]) {
          const value = best[key] + dir * step;
          if (value < 0 || value > SLIDER_MAX) continue;
          const candidate = { ...best, [key]: value };
          const c = sliderCost(candidate, target, naming);
          if (c < bestCost - 1e-12) {
            best = candidate;
            bestCost = c;
            improved = true;
          }
        }
      }
    }
  }
  return {
    sliders: best,
    gains: { roll: slidersToGains(best, 'roll', naming), pitch: slidersToGains(best, 'pitch', naming), yaw: slidersToGains(best, 'yaw', naming) },
    cost: bestCost,
  };
}
