// Firmware-agnostic domain types. Nothing in src/core imports React, the DOM or a firmware adapter.

/** Rotation axes in flight-controller order (FD_ROLL, FD_PITCH, FD_YAW). */
export const AXES = ['roll', 'pitch', 'yaw'] as const;
export type Axis = (typeof AXES)[number];
export type PerAxis<T> = Record<Axis, T>;

export const FLIGHT_STYLES = ['freestyle', 'cinematic', 'racing'] as const;
export type FlightStyle = (typeof FLIGHT_STYLES)[number];

/** The four size categories of the wizard. */
export const CRAFT_CLASSES = ['tinywhoop', 'micro', 'mini', 'macro'] as const;
export type CraftClassId = (typeof CRAFT_CLASSES)[number];

export type FrameType = 'open' | 'ducted';

/**
 * Mechanical/electrical noise of the build, using the five levels of the official
 * Betaflight "basic filter" presets: 0 very clean … 4 very noisy.
 */
export type NoiseLevel = 0 | 1 | 2 | 3 | 4;
export const NOISE_LEVEL_LABELS: Record<NoiseLevel, string> = {
  0: 'Very clean',
  1: 'Clean',
  2: 'Normal',
  3: 'Noisy',
  4: 'Very noisy',
};

/** What the pilot told the wizard about the aircraft. */
export interface CraftSpec {
  classId: CraftClassId;
  /** Propeller diameter in inches (31 mm whoop props = 1.22"). */
  propInches: number;
  frame: FrameType;
  /** All-up weight in grams, battery and camera included. */
  weightGrams: number;
  /** Battery cells in series. */
  cells: number;
  /** Motor KV; undefined means "typical for this prop size and cell count". */
  motorKv?: number;
  /** Magnet count of the motors: 12 for most 9N12 whoop/micro motors, 14 for 12N14. */
  motorPoles: number;
  /** ESC supports bidirectional DShot (Bluejay, BLHeli_32, AM32) so RPM filtering can run. */
  rpmFilter: boolean;
  noise: NoiseLevel;
  /** Radio link packet rate in Hz (ELRS 500 Hz, Crossfire 150 Hz, …). */
  linkRateHz: number;
}

/** The intent sliders, each from -1 to +1. */
export interface FeelSliders {
  /** -1 smooth … +1 snappy (feedforward, RC smoothing, P). */
  response: number;
  /** -1 cool, safe motors … +1 maximum propwash handling (more D, less filtering, more heat). */
  propwash: number;
  /** -1 floaty … +1 locked-in (P/I authority, I-term relax, anti-gravity). */
  lock: number;
}

/** Rate feel controls, each from -1 to +1, applied on top of the style preset. */
export interface RateFeel {
  /** Max rotation speed: -1 calm … +1 fast flips. */
  speed: number;
  /** Center stick sensitivity: -1 gentle … +1 direct. */
  center: number;
  /** Curve shape: -1 linear … +1 strong expo. */
  curve: number;
}

/** How much the generator produces. */
export type TuneScope = 'rates' | 'rates+pids' | 'full';

/**
 * One axis described with the three numbers of Betaflight "Actual" rates, which are the
 * canonical rate description here because each number is physical:
 * center = slope at stick center (deg/s per full stick), max = rate at full stick (deg/s),
 * expo = 0…1 curvature of the transition.
 */
export interface RateCurve {
  center: number;
  max: number;
  expo: number;
}
export type RateSet = PerAxis<RateCurve>;

/** A human-readable "why" attached to a generated value. */
export interface Reason {
  /** What the reason applies to, e.g. "P", "D", "Filters", "Rates". */
  topic: string;
  text: string;
  /** Multiplicative effect, when there is one (1.12 = +12 %). */
  factor?: number;
}

export interface TuneInput {
  craft: CraftSpec;
  style: FlightStyle;
  sliders: FeelSliders;
  rateFeel: RateFeel;
  scope: TuneScope;
}
