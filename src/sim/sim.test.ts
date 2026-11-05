import { describe, expect, it } from 'vitest';
import { defaultCraft } from '../core/craft/classes';
import { evaluateRate, RATE_MODELS } from '../core/rates/models';
import { generateTune } from '../core/tuning/engine';
import { compileBetaflight } from '../firmware/betaflight/compile';
import { deadbandsFor, flownRates } from '../firmware/flownRates';
import { bodyOmega, IDENTITY, integrateBodyRate, rotate, tiltDegrees, type Quat, type Vec3 } from './kinematics';
import { setpoints, stickToRcCommandf } from './rcPipeline';

const close = (a: Vec3, b: Vec3, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
};
const fly = (q: Quat, rates: { roll: number; pitch: number; yaw: number }, seconds: number, steps = 1) => {
  let out = q;
  for (let i = 0; i < steps; i++) out = integrateBodyRate(out, bodyOmega(rates), seconds / steps);
  return out;
};
const RIGHT = { x: 1, y: 0, z: 0 };
const UP = { x: 0, y: 1, z: 0 };
const NOSE = { x: 0, y: 0, z: -1 };

describe('stick → rcCommandf (Betaflight updateRcCommands + calculateSetpointRate)', () => {
  it('is the identity without a deadband', () => {
    for (const s of [-1, -0.37, 0, 0.5, 1]) expect(stickToRcCommandf(s, 0)).toBeCloseTo(s, 12);
  });
  it('removes the deadband and rescales so full stick stays full stick', () => {
    // 10 µs deadband: 0.02 × 500 = 10 µs is still inside, half stick is (250 − 10) / 490.
    expect(stickToRcCommandf(0.02, 10)).toBe(0);
    expect(stickToRcCommandf(0.5, 10)).toBeCloseTo(240 / 490, 12);
    expect(stickToRcCommandf(-0.5, 10)).toBeCloseTo(-240 / 490, 12);
    expect(stickToRcCommandf(1, 10)).toBe(1);
    expect(stickToRcCommandf(1.3, 32)).toBe(1); // over-travel is clamped to ±500 µs
  });
});

describe('setpoints use the compiled rates exactly', () => {
  const tune = generateTune({ craft: defaultCraft('mini'), style: 'freestyle', sliders: { response: 0, propwash: 0, lock: 0 }, rateFeel: { speed: 0, center: 0, curve: 0 }, scope: 'rates' });
  const config = compileBetaflight(tune, { version: '4.5', profileIndex: 0, rateProfileIndex: 0 });
  const rates = flownRates(tune, config);

  it('match the firmware formula on the stored integers', () => {
    const fit = config.rateFit.roll!;
    for (const s of [0.1, 0.5, 0.9, 1]) {
      expect(setpoints({ roll: s, pitch: -s, yaw: 0 }, rates, { rollPitch: 0, yaw: 0 }).roll).toBeCloseTo(evaluateRate(RATE_MODELS.ACTUAL, fit.raw, s), 9);
    }
    expect(setpoints({ roll: 1, pitch: -1, yaw: 1 }, rates, { rollPitch: 0, yaw: 0 })).toEqual({ roll: 850, pitch: -850, yaw: 650 });
  });

  it('honour an expert-mode rate limit and the deadbands', () => {
    const limited = compileBetaflight(tune, { version: '4.5', profileIndex: 0, rateProfileIndex: 0, overrides: { roll_rate_limit: 600, deadband: 12 } });
    const r = flownRates(tune, limited);
    expect(r.roll(1)).toBe(600);
    expect(deadbandsFor(limited)).toEqual({ rollPitch: 12, yaw: 0 });
    expect(deadbandsFor(undefined, { master: { deadband: '5', yaw_deadband: '15' }, profiles: {}, rateProfiles: {} })).toEqual({ rollPitch: 5, yaw: 15 });
  });
});

describe('attitude kinematics', () => {
  it('stick right rolls right, stick forward pitches the nose down, yaw right turns the nose right', () => {
    close(rotate(fly(IDENTITY, { roll: 90, pitch: 0, yaw: 0 }, 1), RIGHT), { x: 0, y: -1, z: 0 });
    close(rotate(fly(IDENTITY, { roll: 0, pitch: 90, yaw: 0 }, 1), NOSE), { x: 0, y: -1, z: 0 });
    close(rotate(fly(IDENTITY, { roll: 0, pitch: 0, yaw: 90 }, 1), NOSE), { x: 1, y: 0, z: 0 });
  });

  it('rotates about the craft’s own axes (body frame), like a real acro quad', () => {
    // Roll right 90°: the craft's belly faces left. Pitching "down" now swings the nose to the left.
    const rolled = fly(IDENTITY, { roll: 90, pitch: 0, yaw: 0 }, 1);
    close(rotate(fly(rolled, { roll: 0, pitch: 90, yaw: 0 }, 1), NOSE), { x: -1, y: 0, z: 0 });
  });

  it('a full-stick flip takes 360 / max rate seconds, independent of the frame rate', () => {
    const coarse = fly(IDENTITY, { roll: 0, pitch: 720, yaw: 0 }, 0.25, 4);
    const fine = fly(IDENTITY, { roll: 0, pitch: 720, yaw: 0 }, 0.25, 1000);
    close(rotate(coarse, UP), { x: 0, y: -1, z: 0 }); // 180° after a quarter second at 720°/s
    close(rotate(fine, UP), rotate(coarse, UP), 9);
    expect(tiltDegrees(fly(IDENTITY, { roll: 720, pitch: 0, yaw: 0 }, 0.5, 30))).toBeCloseTo(0, 5);
  });

  it('combined axes follow the exact constant-rate rotation and stay normalised', () => {
    const rates = { roll: 400, pitch: -250, yaw: 120 };
    const fine = fly(IDENTITY, rates, 1, 10000);
    const exact = fly(IDENTITY, rates, 1, 1);
    close(rotate(fine, NOSE), rotate(exact, NOSE), 9);
    expect(Math.hypot(fine.x, fine.y, fine.z, fine.w)).toBeCloseTo(1, 12);
  });
});
