import { describe, expect, it } from 'vitest';
import { actualParamsToCurve, canonicalRate, fitRateModel, toCanonical } from './fit';
import { evaluateRate, RATE_MODELS } from './models';

describe('rate fitting', () => {
  it('compiles a canonical curve to Actual integers within the 10°/s storage step', () => {
    const curve = { center: 104, max: 853, expo: 0.47 };
    const fit = fitRateModel(RATE_MODELS.ACTUAL, (x) => canonicalRate(curve, x));
    // 104 → 100 and 853 → 850 are forced by the 10°/s storage; expo re-optimises around them.
    expect(fit.params.rcRate).toBe(10);
    expect(fit.params.superRate).toBe(85);
    expect(Math.abs(fit.params.expo - 47)).toBeLessThanOrEqual(2);
    expect(fit.maxError).toBeLessThan(6);
  });

  it('converts classic Betaflight rates to Actual with the same max rate', () => {
    const classic = (x: number) => evaluateRate(RATE_MODELS.BETAFLIGHT, { rcRate: 100, superRate: 70, expo: 0 }, x);
    const fit = fitRateModel(RATE_MODELS.ACTUAL, classic);
    expect(fit.params.superRate).toBe(67);
    expect(fit.rmsError).toBeLessThan(15);
  });

  it('round-trips between Actual and classic Betaflight rates', () => {
    const target = (x: number) => evaluateRate(RATE_MODELS.ACTUAL, { rcRate: 12, superRate: 75, expo: 30 }, x);
    const classic = fitRateModel(RATE_MODELS.BETAFLIGHT, target);
    const back = fitRateModel(RATE_MODELS.ACTUAL, (x) => evaluateRate(RATE_MODELS.BETAFLIGHT, classic.params, x));
    expect(Math.abs(back.params.superRate - 75)).toBeLessThanOrEqual(1);
    expect(classic.rmsError).toBeLessThan(25);
  });

  it('fits INAV rate + expo', () => {
    const target = (x: number) => canonicalRate({ center: 250, max: 700, expo: 0.1 }, x);
    const fit = fitRateModel(RATE_MODELS.INAV, target);
    expect(fit.params.rcRate).toBe(70);
    expect(fit.rmsError).toBeLessThan(30);
  });

  it('reads any curve back into the canonical description', () => {
    const c = toCanonical((x) => evaluateRate(RATE_MODELS.ACTUAL, { rcRate: 10, superRate: 85, expo: 50 }, x));
    expect(c.center).toBeCloseTo(100, 0);
    expect(c.max).toBeCloseTo(850, 6);
    expect(c.expo).toBeCloseTo(0.5, 2);
    expect(actualParamsToCurve({ rcRate: 10, superRate: 85, expo: 50 })).toEqual({ center: 100, max: 850, expo: 0.5 });
  });
});
