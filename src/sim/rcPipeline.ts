// Stick → setpoint exactly as Betaflight computes it (4.4 → 2026.6):
//
//   rcData − midrc            the RC channel as a deflection of ±500 µs around the center
//   updateRcCommands()        clamp to ±500, remove `deadband` (roll/pitch) or `yaw_deadband`
//                             4.4/4.5 inline, 2025.12+ via fapplyDeadband(): the same result
//   calculateSetpointRate()   rcCommandf = rcCommand / (500 − deadband), so the full range
//                             survives the deadband; then applyRates() and the `*_rate_limit` clamp
//
// A USB joystick axis in [-1, 1] stands for (rcData − midrc) / 500, which is what a radio in
// joystick mode sends for its calibrated channel.
import { clamp } from '../core/math';
import type { PerAxis } from '../core/types';
import type { AxisRate, Deadbands } from '../firmware/flownRates';

/** Stick deflection (-1…1) → Betaflight `rcCommandf` (-1…1) for a deadband in µs. */
export function stickToRcCommandf(stick: number, deadbandUs: number): number {
  const deflection = clamp(Number.isFinite(stick) ? stick : 0, -1, 1) * 500;
  const magnitude = Math.min(Math.abs(deflection), 500);
  const afterDeadband = magnitude > deadbandUs ? magnitude - deadbandUs : 0;
  return (Math.sign(deflection) * afterDeadband) / (500 - deadbandUs);
}

export interface StickInput {
  /** +1 = stick right (roll right). */
  roll: number;
  /** +1 = stick forward (nose down). */
  pitch: number;
  /** +1 = stick right (nose right). */
  yaw: number;
}

export const CENTERED: StickInput = { roll: 0, pitch: 0, yaw: 0 };

/** Target angular velocity in deg/s per axis, signed like the stick. */
export function setpoints(sticks: StickInput, rates: PerAxis<AxisRate>, deadbands: Deadbands): StickInput {
  return {
    roll: rates.roll(stickToRcCommandf(sticks.roll, deadbands.rollPitch)),
    pitch: rates.pitch(stickToRcCommandf(sticks.pitch, deadbands.rollPitch)),
    yaw: rates.yaw(stickToRcCommandf(sticks.yaw, deadbands.yaw)),
  };
}
