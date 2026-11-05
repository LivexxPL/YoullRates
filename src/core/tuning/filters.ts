// Gyro/D-term filtering from the build's noise level, with and without RPM filtering.
//
// Anchors: the official Betaflight "basic" filter presets (firmware-presets repository,
// presets/4.5/filters/basic_rpm_*.txt and basic_no_rpm_*.txt, levels very clean … very noisy),
// which are written for 5". Between levels the cutoffs are interpolated in log space; the
// propwash slider moves the effective level; prop size and frame shift the frequencies.
import { clamp, interpolateIndex } from '../math';
import type { CraftSpec, FeelSliders, NoiseLevel, Reason } from '../types';

export type LowpassType = 'PT1' | 'BIQUAD' | 'PT2' | 'PT3';

export interface FilterPlan {
  /** Gyro lowpass 1: dynamic when dynMinHz > 0, static when staticHz > 0, off when both are 0. */
  gyroLpf1: { type: LowpassType; staticHz: number; dynMinHz: number; dynMaxHz: number };
  /** Gyro lowpass 2 (static); 0 = off. */
  gyroLpf2: { type: LowpassType; staticHz: number };
  dtermLpf1: { type: LowpassType; staticHz: number; dynMinHz: number; dynMaxHz: number; dynExpo: number };
  dtermLpf2: { type: LowpassType; staticHz: number };
  dynNotch: { count: number; q: number; minHz: number; maxHz: number };
  /** RPM filter; undefined when the ESCs cannot report RPM. */
  rpm?: { harmonics: number; q: number; minHz: number; fadeRangeHz: number; lpfHz: number };
  motorPoles: number;
  yawLowpassHz: number;
  /** Noise level the filters were built for (0…4, fractional after adjustments). */
  effectiveNoise: number;
  heatRisk: HeatRisk;
  reasons: Reason[];
}

export interface HeatRisk {
  /** 0…1 */
  score: number;
  level: 'low' | 'moderate' | 'high';
  advice: string;
}

// Index 0 = very clean … 4 = very noisy (values from the Betaflight basic presets).
const RPM_TABLE = {
  gyroLpf2Hz: [1000, 875, 500, 250, 125],
  dtermScale: [1.1, 1.05, 1, 0.85, 0.8],
  notchCount: [1, 1, 2, 2, 2],
  notchQ: [500, 475, 450, 400, 350],
  rpmQ: [750, 650, 500, 450, 350],
  yawLowpassHz: [100, 100, 100, 75, 50],
};
const NO_RPM_TABLE = {
  gyroLpf1MinHz: [400, 250, 150, 137, 125],
  gyroLpf2Hz: [800, 500, 300, 275, 250],
  dtermScale: [1, 0.9, 0.8, 0.7, 0.6],
  notchCount: [4, 4, 5, 5, 5],
  notchQ: [450, 350, 350, 325, 300],
  notchMinHz: [100, 100, 100, 90, 80],
};

/** Betaflight defaults: D-term dynamic lowpass 75–150 Hz, lowpass 2 at 150 Hz. */
const DTERM_DYN_MIN = 75;
const DTERM_DYN_MAX = 150;
const DTERM_LPF2 = 150;

/** Log-space interpolation of a table at a fractional noise level. */
const logAt = (values: readonly number[], level: number) =>
  Math.exp(
    interpolateIndex(
      values.map((v) => Math.log(v)),
      level,
    ),
  );
const round5 = (v: number) => Math.round(v / 5) * 5;

export function planFilters(craft: CraftSpec, sliders: FeelSliders, styleDFactor: number): FilterPlan {
  const reasons: Reason[] = [];
  const prop = craft.propInches;
  const ducted = craft.frame === 'ducted';

  // Ducts and whoop frames resonate: treat them half a level noisier. The propwash slider trades
  // filtering (delay) for D-term responsiveness: +1 = one level less filtering.
  const frameOffset = ducted ? 0.5 : 0;
  const effectiveNoise = clamp(craft.noise + frameOffset - clamp(sliders.propwash, -1, 1), 0, 4);
  reasons.push({
    topic: 'Filters',
    text: `Filtering for a "${['very clean', 'clean', 'normal', 'noisy', 'very noisy'][Math.round(effectiveNoise)]}" build (level ${effectiveNoise.toFixed(1)} of 4${ducted ? ', +0.5 for the ducted frame' : ''}${Math.abs(sliders.propwash) > 0.05 ? ', moved by the propwash slider' : ''}).`,
  });

  // Big props: frame resonances and motor noise sit lower in frequency.
  const sizeGyro = prop > 5.5 ? (5.5 / prop) ** 0.5 : 1;
  const sizeDterm = prop > 5.5 ? (5.5 / prop) ** 0.4 : 1;
  if (sizeGyro < 1) reasons.push({ topic: 'Filters', factor: sizeGyro, text: `${prop}" props: noise sits lower in frequency, cutoffs lowered.` });

  const dyn = {
    minHz: clamp(round5(100 * (5 / prop) ** 0.6), 50, 150),
    maxHz: clamp(round5(600 * (5 / prop) ** 0.3), 350, 850),
  };

  let gyroLpf1: FilterPlan['gyroLpf1'];
  let gyroLpf2: FilterPlan['gyroLpf2'];
  let dtermScale: number;
  let dynNotch: FilterPlan['dynNotch'];
  let rpm: FilterPlan['rpm'];
  let yawLowpassHz = 100;

  if (craft.rpmFilter) {
    // RPM filtering removes motor noise at the source: gyro lowpass 1 off, a light lowpass 2.
    gyroLpf2 = { type: 'PT1', staticHz: clamp(round5(logAt(RPM_TABLE.gyroLpf2Hz, effectiveNoise) * sizeGyro), 100, 1000) };
    // dyn_min_hz 0 disables the dynamic lowpass and static_hz 0 disables lowpass 1 (dyn_max_hz is
    // set to the lowpass 2 cutoff like the Betaflight presets do, so the configurator shows sane values).
    gyroLpf1 = { type: 'PT1', staticHz: 0, dynMinHz: 0, dynMaxHz: gyroLpf2.staticHz };
    dtermScale = logAt(RPM_TABLE.dtermScale, effectiveNoise);
    dynNotch = {
      count: Math.round(interpolateIndex(RPM_TABLE.notchCount, effectiveNoise)),
      q: round5(interpolateIndex(RPM_TABLE.notchQ, effectiveNoise)),
      minHz: dyn.minHz,
      maxHz: dyn.maxHz,
    };
    // Whoop motors (9N12) show weak 2nd/3rd harmonics; filtering them only adds delay.
    const harmonics = craft.motorPoles <= 12 && prop < 2 ? 2 : 3;
    rpm = {
      harmonics,
      q: round5(interpolateIndex(RPM_TABLE.rpmQ, effectiveNoise)),
      minHz: clamp(round5(100 * (5 / prop) ** 0.5), 60, 130),
      fadeRangeHz: 50,
      lpfHz: 150,
    };
    yawLowpassHz = round5(interpolateIndex(RPM_TABLE.yawLowpassHz, effectiveNoise));
    reasons.push({ topic: 'Filters', text: `RPM filter on (${harmonics} harmonics, ${craft.motorPoles} motor poles): gyro lowpass 1 off, lowpass 2 at ${gyroLpf2.staticHz} Hz, ${dynNotch.count} dynamic notch${dynNotch.count > 1 ? 'es' : ''} for frame resonances.` });
  } else {
    const min = clamp(round5(logAt(NO_RPM_TABLE.gyroLpf1MinHz, effectiveNoise) * sizeGyro), 50, 500);
    gyroLpf1 = { type: 'PT1', staticHz: min * 2, dynMinHz: min, dynMaxHz: min * 2 };
    gyroLpf2 = { type: 'PT1', staticHz: clamp(round5(logAt(NO_RPM_TABLE.gyroLpf2Hz, effectiveNoise) * sizeGyro), 100, 1000) };
    dtermScale = logAt(NO_RPM_TABLE.dtermScale, effectiveNoise);
    dynNotch = {
      count: Math.round(interpolateIndex(NO_RPM_TABLE.notchCount, effectiveNoise)),
      q: round5(interpolateIndex(NO_RPM_TABLE.notchQ, effectiveNoise)),
      minHz: clamp(round5(interpolateIndex(NO_RPM_TABLE.notchMinHz, effectiveNoise) * (5 / prop) ** 0.6), 50, 150),
      maxHz: dyn.maxHz,
    };
    reasons.push({ topic: 'Filters', text: `No RPM filter: dynamic gyro lowpass ${min}–${min * 2} Hz and ${dynNotch.count} dynamic notches carry the motor noise. Bidirectional DShot (Bluejay/BLHeli_32/AM32) would allow lighter filtering.` });
  }

  const dScale = dtermScale * sizeDterm;
  const dtermLpf1 = { type: 'PT1' as const, staticHz: round5(DTERM_DYN_MAX * dScale), dynMinHz: round5(DTERM_DYN_MIN * dScale), dynMaxHz: round5(DTERM_DYN_MAX * dScale), dynExpo: 5 };
  const dtermLpf2 = { type: 'PT1' as const, staticHz: round5(DTERM_LPF2 * dScale) };
  reasons.push({ topic: 'Filters', text: `D-term lowpass ${dtermLpf1.dynMinHz}–${dtermLpf1.dynMaxHz} Hz (dynamic) + ${dtermLpf2.staticHz} Hz.` });

  return {
    gyroLpf1,
    gyroLpf2,
    dtermLpf1,
    dtermLpf2,
    dynNotch,
    rpm,
    motorPoles: craft.motorPoles,
    yawLowpassHz,
    effectiveNoise,
    heatRisk: heatRisk(craft.noise, sliders.propwash, craft.rpmFilter, styleDFactor),
    reasons,
  };
}

/**
 * Heuristic motor-heat risk: more D (slider, style), less filtering and a noisier build all push
 * more high-frequency noise into the motors.
 */
export function heatRisk(noise: NoiseLevel, propwash: number, rpmFilter: boolean, styleDFactor: number): HeatRisk {
  const x = 1.1 * clamp(propwash, -1, 1) + 0.45 * (noise - 2) + (rpmFilter ? 0 : 0.4) + 1.5 * Math.log(styleDFactor) - 0.2;
  const score = 1 / (1 + Math.exp(-x));
  if (score < 0.4) return { score, level: 'low', advice: 'Motors should stay cool. If propwash bothers you, there is room to move the slider right.' };
  if (score < 0.65) return { score, level: 'moderate', advice: 'Hover 30 s, land and touch the motors: warm is fine, too hot to hold means move the slider left.' };
  return { score, level: 'high', advice: 'Check motor temperature after the first short flight and listen for grinding at idle; back off if motors get hot.' };
}
