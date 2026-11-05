// A deliberately small physics model: enough to scale a tune between craft, simple enough to explain.
//
// Why thrust-to-weight is the key number: with geometric similarity, roll inertia J ∝ m·L² and the
// available torque τ ∝ T_max·L, so the angular acceleration per unit of motor command (the "plant
// gain" a PID loop sees) is τ/J ∝ TWR / L. Bigger props are also slower to spin up (motor time
// constant ∝ L), which limits the usable loop bandwidth by the same factor, so the gains needed
// for the same feel follow 1/TWR, while the D-to-P balance grows with prop size. See
// docs/TUNING_MODEL.md for the derivation and the presets used to calibrate the exponents.
import { clamp, interpolateLogLog } from '../math';
import type { CraftSpec } from '../types';

/** Typical static thrust per motor (grams) of a sensible build for each prop size at its usual voltage. */
const TYPICAL_THRUST_G: readonly (readonly [number, number])[] = [
  [1.22, 26],
  [1.4, 34],
  [1.57, 65],
  [1.8, 85],
  [2, 150],
  [2.5, 330],
  [3, 500],
  [3.5, 800],
  [4, 1150],
  [5, 1700],
  [6, 2000],
  [7, 2350],
  [8, 2900],
  [9, 3400],
  [10, 3900],
  [13, 5200],
];

/** Typical KV × cell count for each prop size (e.g. 5": 1850 KV × 6S = 11100). */
const TYPICAL_KV_CELLS: readonly (readonly [number, number])[] = [
  [1.22, 26000],
  [1.57, 27000],
  [2, 21000],
  [2.5, 18000],
  [3, 16000],
  [3.5, 14000],
  [4, 12600],
  [5, 11100],
  [6, 9600],
  [7, 7800],
  [8, 6600],
  [10, 5400],
  [13, 3600],
];

/** The cell count a typical build of each prop size runs. */
const TYPICAL_CELLS: readonly (readonly [number, number])[] = [
  [1.22, 1],
  [1.57, 2],
  [2, 3],
  [2.5, 4],
  [3, 4],
  [3.5, 6],
  [5, 6],
  [13, 6],
];

/** Volts per cell under load (LiPo). */
const LOADED_CELL_VOLTAGE = 3.7;
/** Loaded RPM as a fraction of KV × volts at full throttle. */
const LOADED_RPM_FRACTION = 0.75;
/** Ducts recover tip losses: more static thrust for the same motor and prop. */
const DUCT_THRUST_GAIN = 1.1;

export interface PhysicsEstimate {
  thrustPerMotorGrams: number;
  /** Whether thrust came from the pilot's KV or from a typical build. */
  thrustBasis: 'kv' | 'typical';
  /** KV assumed or entered. */
  kv: number;
  /** Thrust-to-weight ratio (all four motors at full throttle vs. all-up weight). */
  twr: number;
  /** Throttle fraction needed to hover (thrust ∝ throttle²). */
  hoverThrottle: number;
  /** Motor rotation frequency at hover (Hz), the fundamental the RPM filter tracks. */
  hoverMotorHz: number;
  /** Motor rotation frequency at full throttle (Hz). */
  maxMotorHz: number;
}

export function typicalKv(propInches: number, cells: number): number {
  return Math.round(interpolateLogLog(TYPICAL_KV_CELLS, propInches) / Math.max(cells, 1) / 50) * 50;
}

export function estimatePhysics(craft: CraftSpec): PhysicsEstimate {
  const typicalProduct = interpolateLogLog(TYPICAL_KV_CELLS, craft.propInches);
  const typicalCells = interpolateLogLog(TYPICAL_CELLS, craft.propInches);
  let thrust = interpolateLogLog(TYPICAL_THRUST_G, craft.propInches);
  let basis: PhysicsEstimate['thrustBasis'] = 'typical';
  let kv = typicalKv(craft.propInches, craft.cells);
  if (craft.motorKv && craft.motorKv > 0) {
    // Thrust ∝ RPM² for a fixed prop; the prop loads the motor, so the exponent is a bit below 2.
    const ratio = clamp((craft.motorKv * craft.cells) / typicalProduct, 0.5, 2);
    thrust *= ratio ** 1.6;
    basis = 'kv';
    kv = craft.motorKv;
  } else {
    // Builders pick lower KV for more cells, so the cell count changes thrust only mildly.
    thrust *= clamp(craft.cells / typicalCells, 0.25, 4) ** 0.25;
  }
  if (craft.frame === 'ducted') thrust *= DUCT_THRUST_GAIN;

  const twr = (4 * thrust) / Math.max(craft.weightGrams, 1);
  const hoverThrottle = clamp(Math.sqrt(1 / twr), 0.1, 0.95);
  const maxRpm = kv * craft.cells * LOADED_CELL_VOLTAGE * LOADED_RPM_FRACTION;
  return {
    thrustPerMotorGrams: Math.round(thrust),
    thrustBasis: basis,
    kv,
    twr: Math.round(twr * 100) / 100,
    hoverThrottle,
    hoverMotorHz: Math.round((maxRpm * hoverThrottle) / 60),
    maxMotorHz: Math.round(maxRpm / 60),
  };
}
