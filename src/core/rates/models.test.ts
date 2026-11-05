import { describe, expect, it } from 'vitest';
import { curveStats, evaluateRate, RATE_MODELS, type RateModelId, type RawRateParams } from './models';

const rate = (id: RateModelId, p: RawRateParams, x: number) => evaluateRate(RATE_MODELS[id], p, x);

describe('Betaflight rate formulas (fc/rc.c)', () => {
  it('ACTUAL: firmware defaults 7/67/0 give 70°/s center sensitivity and 670°/s max', () => {
    const p = { rcRate: 7, superRate: 67, expo: 0 };
    expect(rate('ACTUAL', p, 1)).toBeCloseTo(670, 6);
    expect(rate('ACTUAL', p, 0.5)).toBeCloseTo(0.5 * 70 + 600 * 0.5 * 0.5, 6);
    expect(curveStats((x) => rate('ACTUAL', p, x)).center).toBeCloseTo(70, 0);
  });

  it('ACTUAL: expo only reshapes the transition, never the end points', () => {
    for (const expo of [0, 35, 70, 100]) {
      const p = { rcRate: 15, superRate: 80, expo };
      expect(rate('ACTUAL', p, 1)).toBeCloseTo(800, 6);
      expect(curveStats((x) => rate('ACTUAL', p, x)).center).toBeCloseTo(150, 0);
    }
  });

  it('ACTUAL: a max rate below the center sensitivity gives a linear curve', () => {
    const p = { rcRate: 30, superRate: 20, expo: 50 };
    expect(rate('ACTUAL', p, 0.5)).toBeCloseTo(150, 6);
    expect(rate('ACTUAL', p, 1)).toBeCloseTo(300, 6);
  });

  it('BETAFLIGHT: classic 1.00 / 0.70 / 0 peaks at 200 / (1 - 0.7) ≈ 666.7°/s', () => {
    const p = { rcRate: 100, superRate: 70, expo: 0 };
    expect(rate('BETAFLIGHT', p, 1)).toBeCloseTo(200 / 0.3, 4);
    expect(curveStats((x) => rate('BETAFLIGHT', p, x)).center).toBeCloseTo(200, 0);
  });

  it('BETAFLIGHT: RC rate above 2.0 uses RC_RATE_INCREMENTAL = 14.54', () => {
    const p = { rcRate: 250, superRate: 0, expo: 0 };
    expect(rate('BETAFLIGHT', p, 1)).toBeCloseTo(200 * (2.5 + 14.54 * 0.5), 3);
  });

  it('KISS and QUICK reproduce the same 666.7 / 670°/s classic numbers', () => {
    expect(rate('KISS', { rcRate: 100, superRate: 70, expo: 0 }, 1)).toBeCloseTo(200 / 0.3, 3);
    expect(rate('QUICK', { rcRate: 100, superRate: 67, expo: 0 }, 1)).toBeCloseTo(670, 3);
  });

  it('RACEFLIGHT: rate × (1 + acro+)', () => {
    expect(rate('RACEFLIGHT', { rcRate: 37, superRate: 80, expo: 50 }, 1)).toBeCloseTo(370 * 1.8, 6);
  });

  it('every model is an odd function of the stick and honours the rate limit', () => {
    const p = { rcRate: 120, superRate: 80, expo: 40 };
    for (const id of Object.keys(RATE_MODELS) as RateModelId[]) {
      for (const x of [0.1, 0.37, 0.8, 1]) expect(rate(id, p, -x)).toBeCloseTo(-rate(id, p, x), 6);
    }
    expect(evaluateRate(RATE_MODELS.ACTUAL, { rcRate: 100, superRate: 255, expo: 0 }, 1, { rateLimit: 1200 })).toBe(1200);
  });
});

describe('INAV rate formula (rc_curves.c rcLookup + pidRcCommandToRate)', () => {
  it('max rate is rate × 10 at full stick', () => {
    expect(rate('INAV', { rcRate: 70, superRate: 0, expo: 0 }, 1)).toBeCloseTo(700, 6);
  });
  it('expo follows the integer rcLookup', () => {
    // deflection 250 → t = 2.5 → (2500 + 70·(6.25 − 25))·2.5 / 25 = 118.75 → lrintf → 119
    expect(rate('INAV', { rcRate: 70, superRate: 0, expo: 70 }, 0.5)).toBeCloseTo((119 / 500) * 700, 6);
  });
});
