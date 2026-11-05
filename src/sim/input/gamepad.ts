// RC radios and gamepads through the Gamepad API.
//
// A radio in USB joystick mode (EdgeTX/OpenTX on Radiomaster, Jumper, FrSky; FreedomTX/EdgeTX on
// TBS Tango and Mambo) is a HID joystick whose axes are its output channels, usually in AETR order:
// axes[0] aileron (roll), [1] elevator (pitch), [2] throttle, [3] rudder (yaw). Orders, directions
// and end points differ between radios and operating systems, so every binding can be detected by
// moving the stick, inverted, and calibrated; the result is stored per device.
//
// The Gamepad API is polled (navigator.getGamepads() returns a snapshot); browsers only expose a
// device after a button press or stick move, and only in secure contexts (https, localhost).
import { clamp } from '../../core/math';
import type { StickInput } from '../rcPipeline';

export type StickAxis = keyof StickInput;
export const STICK_AXES: readonly StickAxis[] = ['roll', 'pitch', 'yaw'];

export interface AxisBinding {
  /** Index into Gamepad.axes. */
  axis: number;
  invert: boolean;
  /** Raw readings at the stick's end points and center (calibration). */
  min: number;
  center: number;
  max: number;
}

export type GamepadMapping = Record<StickAxis, AxisBinding>;

/** The part of the Gamepad interface the simulator uses (plain objects in tests). */
export interface PadSnapshot {
  id: string;
  index: number;
  mapping: string;
  axes: readonly number[];
}

const bind = (axis: number, invert = false): AxisBinding => ({ axis, invert, min: -1, center: 0, max: 1 });

export function defaultMapping(pad: Pick<PadSnapshot, 'mapping'>): GamepadMapping {
  if (pad.mapping === 'standard') {
    // Console-style controller held like a Mode 2 radio; on "standard" pads, stick up reads −1.
    return { yaw: bind(0), roll: bind(2), pitch: bind(3, true) };
  }
  return { roll: bind(0), pitch: bind(1), yaw: bind(3) };
}

/** Raw axis → calibrated stick position in [-1, 1] (separate scaling either side of center). */
export function normalizeAxis(raw: number | undefined, b: AxisBinding): number {
  if (raw === undefined || !Number.isFinite(raw)) return 0;
  const span = raw >= b.center ? b.max - b.center : b.center - b.min;
  const v = span > 1e-6 ? (raw - b.center) / span : 0;
  return clamp(b.invert ? -v : v, -1, 1);
}

export function readSticks(pad: Pick<PadSnapshot, 'axes'>, mapping: GamepadMapping): StickInput {
  return {
    roll: normalizeAxis(pad.axes[mapping.roll.axis], mapping.roll),
    pitch: normalizeAxis(pad.axes[mapping.pitch.axis], mapping.pitch),
    yaw: normalizeAxis(pad.axes[mapping.yaw.axis], mapping.yaw),
  };
}

/**
 * The axis that moved most since `baseline`, and whether it moved negative. Used with prompts such
 * as "push the roll stick fully right": that move must read +1, so a negative move means invert.
 */
export function detectAxis(baseline: readonly number[], current: readonly number[], minDelta = 0.5): { axis: number; invert: boolean } | undefined {
  let axis = -1;
  let delta = 0;
  current.forEach((value, i) => {
    const d = value - (baseline[i] ?? 0);
    if (Math.abs(d) > Math.abs(delta)) {
      delta = d;
      axis = i;
    }
  });
  return axis >= 0 && Math.abs(delta) >= minDelta ? { axis, invert: delta < 0 } : undefined;
}

/** Calibration: sticks centered at the start, then moved to every corner. */
export interface Calibration {
  centers: number[];
  mins: number[];
  maxs: number[];
}

export const startCalibration = (axes: readonly number[]): Calibration => ({ centers: [...axes], mins: [...axes], maxs: [...axes] });

export function updateCalibration(c: Calibration, axes: readonly number[]): void {
  axes.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    c.mins[i] = Math.min(c.mins[i] ?? v, v);
    c.maxs[i] = Math.max(c.maxs[i] ?? v, v);
  });
}

/** Applies a calibration to the bound axes; axes that barely moved keep their previous range. */
export function applyCalibration(mapping: GamepadMapping, c: Calibration): GamepadMapping {
  const next = { ...mapping };
  for (const key of STICK_AXES) {
    const b = mapping[key];
    const center = c.centers[b.axis];
    const min = c.mins[b.axis];
    const max = c.maxs[b.axis];
    if (center === undefined || min === undefined || max === undefined) continue;
    if (max - center < 0.1 || center - min < 0.1) continue;
    next[key] = { ...b, min, center, max };
  }
  return next;
}

/** Connected devices from the Gamepad API (empty where it is unavailable). */
export function connectedPads(): Gamepad[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  try {
    return navigator.getGamepads().filter((p): p is Gamepad => p !== null && p.connected);
  } catch {
    return []; // blocked by a permissions policy
  }
}

const storageKey = (id: string) => `tuneforge:radio:${id}`;

function isBinding(b: unknown): b is AxisBinding {
  const o = b as Partial<AxisBinding> | null;
  return !!o && Number.isInteger(o.axis) && typeof o.invert === 'boolean' && [o.min, o.center, o.max].every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function loadMapping(pad: Pick<PadSnapshot, 'id' | 'mapping'>): GamepadMapping {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(pad.id)) ?? 'null') as Partial<GamepadMapping> | null;
    if (saved && STICK_AXES.every((k) => isBinding(saved[k]))) return saved as GamepadMapping;
  } catch {
    // No storage (private mode) or a stale entry: fall back to the defaults.
  }
  return defaultMapping(pad);
}

export function saveMapping(id: string, mapping: GamepadMapping): void {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(mapping));
  } catch {
    // Not persisted; the mapping still applies for this session.
  }
}
