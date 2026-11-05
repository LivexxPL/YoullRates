// PID gains scaled from the reference 5" tune by size, weight (through thrust-to-weight), frame,
// flight style, the rates the pilot chose and the feel sliders.
//
// Units are Betaflight's (4.3+): the common currency of FPV tuning. Other firmware adapters convert.
import { clamp, sliderFactor } from '../math';
import type { PhysicsEstimate } from '../craft/physics';
import type { Axis, CraftSpec, FeelSliders, FlightStyle, PerAxis, RateSet, Reason } from '../types';

export interface PidGains {
  p: number;
  i: number;
  /** D at rest (Betaflight 4.4/4.5 `d_min_*`; 2025.12+ `d_*`). */
  dMin: number;
  /** D during fast moves and propwash (Betaflight 4.4/4.5 `d_*`; 2025.12+ `d_max_*`). */
  dMax: number;
  ff: number;
}

/**
 * Betaflight defaults since 4.3 (PID_ROLL/PITCH/YAW_DEFAULT and D_MIN/D_MAX_DEFAULT in flight/pid.h):
 * the firmware's own reference tune for a typical 5". All scaling is relative to it.
 */
export const REFERENCE_GAINS: PerAxis<PidGains> = {
  roll: { p: 45, i: 80, dMin: 30, dMax: 40, ff: 120 },
  pitch: { p: 47, i: 84, dMin: 34, dMax: 46, ff: 125 },
  yaw: { p: 45, i: 80, dMin: 0, dMax: 0, ff: 120 },
};

/**
 * Thrust-to-weight of the craft the reference gains suit (calibrated so that a 650 g 6S 5"
 * freestyle build lands near the median of professional presets, see docs/TUNING_MODEL.md).
 */
export const REFERENCE_TWR = 15.6;
const TWR_EXPONENT = 0.5;

interface StyleGains {
  p: number;
  i: number;
  d: number;
  ff: number;
  /** D boost range: dMax / dMin for roll and pitch. */
  dRange: number;
  why: string;
}

export const STYLE_GAINS: Record<FlightStyle, StyleGains> = {
  freestyle: { p: 1.05, i: 1, d: 1, ff: 1.1, dRange: 1.25, why: 'Freestyle: balanced P/D, moderate feedforward, some D boost for flips.' },
  cinematic: { p: 0.95, i: 0.85, d: 1.1, ff: 0.45, dRange: 1.1, why: 'Cinematic: more damping than drive, low feedforward so stick noise never reaches the footage.' },
  racing: { p: 0.95, i: 1.1, d: 0.85, ff: 1.25, dRange: 1.55, why: 'Racing: strong feedforward and I for tracking, low resting D with a wide D boost.' },
};

/** Less D on noisy builds: D amplifies the noise that heats motors. */
const NOISE_D_FACTOR = [1.05, 1, 1, 0.92, 0.85] as const;

export interface PidPlan {
  gains: PerAxis<PidGains>;
  /** Overall multipliers vs. the reference (roll axis), for display. */
  multipliers: { p: number; i: number; d: number; ff: number };
  /** The craft-only part of the scaling (thrust-to-weight and prop size), before style and sliders. */
  authority: number;
  reasons: Reason[];
  warnings: string[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function planPids(craft: CraftSpec, physics: PhysicsEstimate, style: FlightStyle, sliders: FeelSliders, rates: RateSet): PidPlan {
  const reasons: Reason[] = [];
  const warnings: string[] = [];
  const s = STYLE_GAINS[style];
  const ducted = craft.frame === 'ducted';
  const prop = craft.propInches;

  // 1. Authority: the gain needed for the same response grows as thrust-to-weight falls.
  const authority = (REFERENCE_TWR / physics.twr) ** TWR_EXPONENT;
  reasons.push({
    topic: 'PID',
    factor: authority,
    text: `Thrust-to-weight ≈ ${physics.twr.toFixed(1)}:1 (${physics.thrustPerMotorGrams} g per motor${physics.thrustBasis === 'typical' ? ', typical motors' : `, ${physics.kv} KV`}) vs. ${REFERENCE_TWR}:1 for the reference tune.`,
  });

  // 2. Very big props respond too slowly for full gains: detune above 7".
  const slowProps = prop > 7 ? (7 / prop) ** 1.2 : 1;
  if (slowProps < 1) reasons.push({ topic: 'PID', factor: slowProps, text: `${prop}" props spin up slowly; gains reduced to keep the loop stable.` });

  // 3. Ducts add static thrust and aerodynamic damping: less P than TWR suggests, relatively more D.
  const duct = ducted ? { p: 0.8, i: 0.68, d: 0.96, f: 0.68 } : { p: 1, i: 1, d: 1, f: 1 };
  if (ducted) reasons.push({ topic: 'PID', text: 'Ducted frame vs. an open frame with the same thrust-to-weight: P ×0.80, D ×0.96, I ×0.68, FF ×0.68 (duct damping, turbulent propwash).' });

  // 4. D-to-P balance grows with prop size (slower motors need relatively more damping).
  const dBalance = clamp((prop / 5.5) ** 0.7, 1, 1.35);
  if (dBalance > 1.005) reasons.push({ topic: 'D', factor: dBalance, text: `Bigger props need more damping per unit of P (D/P ×${dBalance.toFixed(2)}).` });

  // 5. Big quads cruise; strong I causes bounce-back on slow props.
  const sizeI = prop > 5.5 ? (5.5 / prop) ** 0.6 : 1;
  if (sizeI < 1) reasons.push({ topic: 'I', factor: sizeI, text: 'Less I-term on big props to avoid slow bounce-back and wobble.' });

  reasons.push({ topic: 'PID', text: s.why });

  // 6. Feel sliders.
  const responseP = sliderFactor(sliders.response, 0.08);
  const responseF = sliderFactor(sliders.response, 0.35);
  const lockP = sliderFactor(sliders.lock, 0.12);
  const lockI = sliderFactor(sliders.lock, 0.25);
  const propwashD = sliderFactor(sliders.propwash, 0.22);
  if (Math.abs(sliders.response) > 0.05) reasons.push({ topic: 'FF', factor: responseF, text: `Response slider: feedforward ${sliders.response > 0 ? 'up for snap' : 'down for smoothness'}.` });
  if (Math.abs(sliders.lock) > 0.05) reasons.push({ topic: 'I', factor: lockI, text: `Lock-in slider: P/I ${sliders.lock > 0 ? 'up (locked-in)' : 'down (floatier)'}.` });
  if (Math.abs(sliders.propwash) > 0.05) reasons.push({ topic: 'D', factor: propwashD, text: `Propwash slider: D ${sliders.propwash > 0 ? 'up, better propwash handling, more motor heat' : 'down, cooler motors'}.` });

  // 7. Noise and filtering delay limit usable D.
  const noiseD = NOISE_D_FACTOR[craft.noise];
  const filterDelayD = craft.rpmFilter ? 1 : 0.9;
  if (noiseD !== 1) reasons.push({ topic: 'D', factor: noiseD, text: noiseD > 1 ? 'Very clean build: a little more D is safe.' : 'Noisy build: D trimmed to protect the motors.' });
  if (!craft.rpmFilter) reasons.push({ topic: 'D', factor: filterDelayD, text: 'No RPM filter: heavier filtering adds delay, so D is trimmed.' });

  // 8. Rates link: very fast flips need a wider D boost to stop cleanly; slow rates need less.
  const rollMax = rates.roll.max;
  const rateBoost = 1 + 0.15 * clamp((rollMax - 800) / 400, -1, 1);
  let dRange = 1 + (s.dRange - 1) * rateBoost;
  if (ducted) dRange = 1 + (dRange - 1) * 0.5;
  reasons.push({ topic: 'D', text: `D boost range ×${dRange.toFixed(2)} (D max / D min), matched to ${Math.round(rollMax)}°/s max rate${ducted ? ' and halved for ducts' : ''}.` });

  const base = authority * slowProps;
  const pMult = base * duct.p * s.p * responseP * lockP;
  const iMult = base * duct.i * sizeI * s.i * lockI;
  const dMult = base * duct.d * dBalance * s.d * propwashD * noiseD * filterDelayD;
  const fMult = base * duct.f * s.ff * responseF;

  const axisGains = (axis: Axis): PidGains => {
    const ref = REFERENCE_GAINS[axis];
    const dMin = ref.dMin * dMult;
    return {
      p: ref.p * pMult,
      i: ref.i * iMult,
      dMin,
      dMax: axis === 'yaw' ? 0 : dMin * dRange,
      ff: ref.ff * fMult,
    };
  };
  const gains: PerAxis<PidGains> = { roll: axisGains('roll'), pitch: axisGains('pitch'), yaw: axisGains('yaw') };

  // Plausibility guard rails (the firmware accepts far more, but these would be a modelling error).
  for (const axis of ['roll', 'pitch', 'yaw'] as const) {
    const g = gains[axis];
    const limited: PidGains = {
      p: clamp(g.p, 15, 150),
      i: clamp(g.i, 20, 200),
      dMin: clamp(g.dMin, 0, 120),
      dMax: clamp(g.dMax, 0, 150),
      ff: clamp(g.ff, 0, 450),
    };
    if (limited.p !== g.p || limited.dMax !== g.dMax || limited.ff !== g.ff) warnings.push(`${axis} gains reached a safety limit; check the craft details.`);
    gains[axis] = limited;
  }

  return {
    gains,
    multipliers: { p: round2(pMult), i: round2(iMult), d: round2(dMult), ff: round2(fMult) },
    authority: round2(base),
    reasons,
    warnings,
  };
}
