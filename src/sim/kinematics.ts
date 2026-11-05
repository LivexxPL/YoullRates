// Attitude kinematics for the simulator: body-frame angular rates → orientation.
//
// The setpoints are body rates (what the gyro measures), so they rotate the craft about its own
// axes. Over one frame the rates are constant (the flight controller also holds a setpoint until
// the next RC packet), and a constant body rate ω for dt is an exact rotation of |ω|·dt about ω,
// applied on the right: q ← q ⊗ exp(ω·dt / 2). No Euler angles, so no gimbal lock, and the result
// does not depend on the frame rate.
//
// Model frame (three.js convention): +X right, +Y up, −Z forward (the nose).
//   roll right  (right side down)  = negative rotation about +Z
//   pitch down  (stick forward)    = negative rotation about +X
//   yaw right   (nose right)       = negative rotation about +Y
import type { StickInput } from './rcPipeline';

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const DEG = Math.PI / 180;

/** Hamilton product a ⊗ b (apply b, then a). */
export function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function normalize(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const p = multiply(multiply(q, { x: v.x, y: v.y, z: v.z, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w });
  return { x: p.x, y: p.y, z: p.z };
}

/** Body angular velocity (rad/s, model frame) for setpoints in deg/s signed like the sticks. */
export function bodyOmega(rates: StickInput): Vec3 {
  return { x: -rates.pitch * DEG, y: -rates.yaw * DEG, z: -rates.roll * DEG };
}

/** Exact rotation by a constant body rate ω (rad/s) for dt seconds. */
export function integrateBodyRate(q: Quat, omega: Vec3, dt: number): Quat {
  const speed = Math.hypot(omega.x, omega.y, omega.z);
  const angle = speed * dt;
  if (angle < 1e-12) return q;
  const s = Math.sin(angle / 2) / speed;
  return normalize(multiply(q, { x: omega.x * s, y: omega.y * s, z: omega.z * s, w: Math.cos(angle / 2) }));
}

/** Angle in degrees between the model's up axis and world up (0 = level, 180 = inverted). */
export function tiltDegrees(q: Quat): number {
  const up = rotate(q, { x: 0, y: 1, z: 0 });
  return (Math.acos(Math.max(-1, Math.min(1, up.y))) * 180) / Math.PI;
}
