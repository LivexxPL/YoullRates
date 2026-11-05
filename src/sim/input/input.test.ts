import { describe, expect, it } from 'vitest';
import { applyCalibration, defaultMapping, detectAxis, normalizeAxis, readSticks, startCalibration, updateCalibration } from './gamepad';
import { KeyboardSticks } from './keyboard';

describe('gamepad mapping', () => {
  it('assumes AETR channel order for radios and Mode 2 layout for standard pads', () => {
    const radio = defaultMapping({ mapping: '' });
    expect([radio.roll.axis, radio.pitch.axis, radio.yaw.axis]).toEqual([0, 1, 3]);
    const pad = defaultMapping({ mapping: 'standard' });
    expect([pad.roll.axis, pad.pitch.axis, pad.yaw.axis, pad.pitch.invert]).toEqual([2, 3, 0, true]);
    // Standard pads report stick up as −1: that is "pitch forward".
    expect(readSticks({ axes: [0, 0, 0, -1] }, pad).pitch).toBe(1);
  });

  it('calibrates each side of center separately and inverts on request', () => {
    const b = { axis: 0, invert: false, min: -0.8, center: 0.1, max: 0.9 };
    expect(normalizeAxis(0.1, b)).toBe(0);
    expect(normalizeAxis(0.9, b)).toBe(1);
    expect(normalizeAxis(-0.8, b)).toBe(-1);
    expect(normalizeAxis(0.5, b)).toBeCloseTo(0.5, 12);
    expect(normalizeAxis(-0.35, b)).toBeCloseTo(-0.5, 12);
    expect(normalizeAxis(1.2, b)).toBe(1); // clamped
    expect(normalizeAxis(0.9, { ...b, invert: true })).toBe(-1);
    expect(normalizeAxis(undefined, b)).toBe(0);
  });

  it('detects the moved axis and its direction', () => {
    const baseline = [0, 0, -1, 0, 0];
    expect(detectAxis(baseline, [0.05, 0, -1, 0.98, 0])).toEqual({ axis: 3, invert: false });
    expect(detectAxis(baseline, [0, -0.9, -1, 0.1, 0])).toEqual({ axis: 1, invert: true });
    expect(detectAxis(baseline, [0.2, 0.1, -0.9, 0, 0])).toBeUndefined(); // nothing moved far enough
  });

  it('builds the calibration from a centered start and stick sweeps', () => {
    const run = startCalibration([0.02, -0.01, -1, 0.03]);
    for (const axes of [
      [0.95, -0.9, -1, 0],
      [-0.97, 0.92, 0.2, 0.99],
      [0, 0, 1, -1.01],
    ])
      updateCalibration(run, axes);
    const cal = applyCalibration(defaultMapping({ mapping: '' }), run);
    expect(cal.roll).toMatchObject({ min: -0.97, center: 0.02, max: 0.95 });
    expect(cal.yaw).toMatchObject({ min: -1.01, center: 0.03, max: 0.99 });
    expect(readSticks({ axes: [0.95, -0.9, 0, 0.03] }, cal)).toEqual({ roll: 1, pitch: -1, yaw: 0 });
  });
});

describe('keyboard sticks', () => {
  it('ramps toward full deflection while held and back to center on release', () => {
    const kb = new KeyboardSticks();
    expect(kb.handle('ArrowRight', true)).toBe(true);
    expect(kb.handle('KeyZ', true)).toBe(false);
    expect(kb.update(0.2).roll).toBeCloseTo(0.5, 9);
    expect(kb.update(0.4).roll).toBe(1);
    kb.handle('ArrowRight', false);
    expect(kb.update(0.2).roll).toBeCloseTo(0.5, 9);
    expect(kb.update(1).roll).toBe(0);
  });
});
