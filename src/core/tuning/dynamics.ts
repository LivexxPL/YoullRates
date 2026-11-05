// Everything around the PID gains that shapes how the tune feels: feedforward processing,
// I-term relax, anti-gravity, TPA, dynamic idle, thrust linearisation and RC smoothing.
// Values are tied to the flight style AND to the rates the pilot chose (the "hybrid" profile).
import { clamp, sliderFactor } from '../math';
import type { PhysicsEstimate } from '../craft/physics';
import type { CraftSpec, FeelSliders, FlightStyle, RateSet, Reason } from '../types';

export type FeedforwardAveraging = 'OFF' | '2_POINT' | '3_POINT' | '4_POINT';
const AVERAGING_STEPS: readonly FeedforwardAveraging[] = ['OFF', '2_POINT', '3_POINT', '4_POINT'];

export interface DynamicsPlan {
  feedforward: {
    averaging: FeedforwardAveraging;
    /** feedforward_smooth_factor 0…95 */
    smoothFactor: number;
    /** feedforward_jitter_factor 0…20 */
    jitterFactor: number;
    /** feedforward_boost 0…50 */
    boost: number;
    /** feedforward_transition 0…100: fades FF out near stick center. */
    transition: number;
    /** feedforward_max_rate_limit (% of max rate where FF is cut to avoid overshoot). */
    maxRateLimit: number;
  };
  itermRelax: { axes: 'RP' | 'RPY'; cutoff: number };
  antiGravityGain: number;
  tpa: { mode: 'D' | 'PD'; rate: number; breakpoint: number };
  thrustLinear: number;
  /** dyn_idle_min_rpm in hundreds of RPM; 0 = off (needs bidirectional DShot). */
  dynIdleMinRpm: number;
  vbatSagCompensation: number;
  rcSmoothingAutoFactor: number;
  /** Throttle curve: thr_mid / thr_expo in percent. */
  throttle: { mid: number; expo: number };
  reasons: Reason[];
}

interface StyleDynamics {
  averaging: FeedforwardAveraging;
  smooth: number;
  jitter: number;
  boost: number;
  transition: number;
  relaxCutoff: number;
  antiGravity: number;
  rcSmoothing: number;
  throttleExpo: number;
}

const STYLE_DYNAMICS: Record<FlightStyle, StyleDynamics> = {
  freestyle: { averaging: '2_POINT', smooth: 45, jitter: 7, boost: 15, transition: 0, relaxCutoff: 15, antiGravity: 90, rcSmoothing: 30, throttleExpo: 0 },
  cinematic: { averaging: '3_POINT', smooth: 70, jitter: 12, boost: 5, transition: 30, relaxCutoff: 10, antiGravity: 100, rcSmoothing: 45, throttleExpo: 25 },
  racing: { averaging: 'OFF', smooth: 20, jitter: 5, boost: 18, transition: 0, relaxCutoff: 30, antiGravity: 80, rcSmoothing: 25, throttleExpo: 0 },
};

const round = Math.round;

export function planDynamics(craft: CraftSpec, physics: PhysicsEstimate, style: FlightStyle, sliders: FeelSliders, rates: RateSet): DynamicsPlan {
  const reasons: Reason[] = [];
  const s = STYLE_DYNAMICS[style];
  const prop = craft.propInches;
  const maxRate = rates.roll.max;

  // Feedforward: slow radio links send steps, so they need more averaging and smoothing.
  let averagingIndex = AVERAGING_STEPS.indexOf(s.averaging);
  let smooth = s.smooth - 15 * clamp(sliders.response, -1, 1);
  const jitter = s.jitter - 2 * clamp(sliders.response, -1, 1);
  if (craft.linkRateHz < 250) {
    averagingIndex = Math.max(averagingIndex, 1) + (craft.linkRateHz <= 150 ? 1 : 0);
    smooth += 10;
    reasons.push({ topic: 'FF', text: `${craft.linkRateHz} Hz radio link: more feedforward averaging and smoothing to hide RC steps.` });
  }
  const averaging = AVERAGING_STEPS[clamp(averagingIndex, 0, 3)] ?? 'OFF';
  // Fast flips overshoot at the end of the move unless FF is cut near max rate.
  const maxRateLimit = maxRate >= 1000 ? 85 : maxRate <= 550 ? 100 : 90;
  reasons.push({ topic: 'FF', text: `Feedforward cut at ${maxRateLimit} % of your ${round(maxRate)}°/s max rate to stop flip overshoot.` });
  const boost = clamp(round(s.boost + 5 * sliders.response), 0, 50);

  // I-term relax: big/slow quads and fast rates bounce back after flips → lower cutoff.
  const sizeRelax = prop > 5.5 ? (5.5 / prop) ** 1.2 : 1;
  const rateRelax = (800 / Math.max(maxRate, 200)) ** 0.3;
  const relaxCutoff = clamp(round(s.relaxCutoff * sizeRelax * rateRelax * sliderFactor(sliders.lock, 0.3)), 3, 45);
  reasons.push({ topic: 'I', text: `I-term relax cutoff ${relaxCutoff} Hz: ${style} base, scaled for ${prop}" props and ${round(maxRate)}°/s rates (lower = less bounce-back after flips).` });

  // Anti-gravity: heavier, slower craft lose attitude on throttle punches.
  const antiGravity = clamp(round((s.antiGravity + (prop > 6 ? 20 : 0) + (craft.frame === 'ducted' ? 10 : 0)) * sliderFactor(sliders.lock, 0.12)), 0, 250);

  // TPA: race and big quads see the most D oscillation at high throttle.
  const tpa = style === 'racing' ? { mode: 'D' as const, rate: 70, breakpoint: 1250 } : prop > 6 ? { mode: 'D' as const, rate: 75, breakpoint: 1250 } : { mode: 'D' as const, rate: 65, breakpoint: 1350 };

  // Thrust linearisation helps small props with stiff, non-linear low-throttle thrust.
  const thrustLinear = craft.classId === 'tinywhoop' ? 25 : craft.classId === 'micro' ? (craft.frame === 'ducted' ? 20 : 25) : craft.classId === 'mini' && style === 'cinematic' ? 15 : 0;
  if (thrustLinear) reasons.push({ topic: 'Motors', text: `thrust_linear ${thrustLinear}: evens out motor response at low throttle on ${craft.frame === 'ducted' ? 'ducted ' : ''}small props.` });

  // Dynamic idle: constant prop tip speed at idle → min RPM ∝ 1 / diameter (150 / D in hundreds of RPM).
  let dynIdle = 0;
  if (craft.rpmFilter) {
    dynIdle = clamp(round((150 / prop) * (style === 'racing' ? 1.1 : 1) * sliderFactor(sliders.propwash, 0.08)), 15, 200);
    reasons.push({ topic: 'Motors', text: `Dynamic idle ${dynIdle * 100} RPM (same prop tip speed as ~3000 RPM on 5"): better low-throttle authority and propwash, fewer desyncs.` });
  }

  const sagCompensation = craft.classId === 'tinywhoop' || craft.frame === 'ducted' || style === 'racing' ? 100 : 0;
  if (sagCompensation) reasons.push({ topic: 'Motors', text: 'Battery sag compensation 100 %: the same feel from full pack to landing.' });

  const rcSmoothing = clamp(round(s.rcSmoothing - 10 * sliders.response), 0, 250);

  // Throttle: center the curve on hover so a cinematic expo gives fine height control.
  const hover = clamp(round(physics.hoverThrottle * 100), 10, 80);
  const throttle = s.throttleExpo > 0 ? { mid: hover, expo: s.throttleExpo } : { mid: 50, expo: 0 };
  if (s.throttleExpo > 0) reasons.push({ topic: 'Throttle', text: `Throttle mid at the estimated hover point (${hover} %), expo ${s.throttleExpo} % for smooth altitude changes.` });

  return {
    feedforward: { averaging, smoothFactor: clamp(round(smooth), 0, 95), jitterFactor: clamp(round(jitter), 0, 20), boost, transition: s.transition, maxRateLimit },
    itermRelax: { axes: 'RP', cutoff: relaxCutoff },
    antiGravityGain: antiGravity,
    tpa,
    thrustLinear,
    dynIdleMinRpm: dynIdle,
    vbatSagCompensation: sagCompensation,
    rcSmoothingAutoFactor: rcSmoothing,
    throttle,
    reasons,
  };
}
