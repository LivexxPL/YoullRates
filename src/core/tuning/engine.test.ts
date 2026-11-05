import { describe, expect, it } from 'vitest';
import { defaultCraft } from '../craft/classes';
import { estimatePhysics } from '../craft/physics';
import type { CraftSpec, FeelSliders, FlightStyle, TuneInput, TuneScope } from '../types';
import { generateTune } from './engine';

const neutral: FeelSliders = { response: 0, propwash: 0, lock: 0 };
const input = (craft: Partial<CraftSpec> & Pick<CraftSpec, 'classId'>, style: FlightStyle, extra: Partial<TuneInput> = {}, scope: TuneScope = 'full'): TuneInput => ({
  craft: { ...defaultCraft(craft.classId), ...craft },
  style,
  sliders: neutral,
  rateFeel: { speed: 0, center: 0, curve: 0 },
  scope,
  ...extra,
});
const tune = (...args: Parameters<typeof input>) => generateTune(input(...args));

describe('physics estimate', () => {
  it('puts a 650 g 6S 5" near 10:1 thrust-to-weight and ~30 % hover throttle', () => {
    const p = estimatePhysics(defaultCraft('mini'));
    expect(p.twr).toBeGreaterThan(9);
    expect(p.twr).toBeLessThan(12.5);
    expect(p.hoverThrottle).toBeGreaterThan(0.25);
    expect(p.hoverThrottle).toBeLessThan(0.36);
  });
  it('more KV or ducts mean more thrust; more weight means less TWR', () => {
    const base = estimatePhysics(defaultCraft('mini'));
    expect(estimatePhysics({ ...defaultCraft('mini'), motorKv: 2200 }).thrustPerMotorGrams).toBeGreaterThan(base.thrustPerMotorGrams);
    expect(estimatePhysics({ ...defaultCraft('mini'), weightGrams: 800 }).twr).toBeLessThan(base.twr);
    const open = estimatePhysics({ ...defaultCraft('micro'), frame: 'open' });
    expect(estimatePhysics(defaultCraft('micro')).thrustPerMotorGrams).toBeGreaterThan(open.thrustPerMotorGrams);
  });
});

// Ranges spanned by professional Betaflight 4.5 presets for each class (UAV Tech, Karate, SupaflyFPV,
// AOS, ctzsnooze, Minchan; effective values after the simplified-tuning sliders). Roll axis.
describe('calibration against professional presets', () => {
  const cases: { name: string; t: ReturnType<typeof tune>; p: [number, number]; d: [number, number]; ff: [number, number] }[] = [
    { name: 'tinywhoop 1S', t: tune({ classId: 'tinywhoop' }, 'freestyle'), p: [40, 80], d: [25, 75], ff: [110, 240] },
    { name: '5" race', t: tune({ classId: 'mini', weightGrams: 500, motorKv: 1950 }, 'racing'), p: [36, 50], d: [20, 40], ff: [118, 160] },
    { name: '5" freestyle', t: tune({ classId: 'mini' }, 'freestyle'), p: [50, 80], d: [35, 55], ff: [115, 250] },
    { name: '7" long range', t: tune({ classId: 'macro' }, 'freestyle'), p: [48, 62], d: [30, 65], ff: [140, 210] },
  ];
  for (const c of cases) {
    it(`${c.name}: P, D and FF inside the preset range`, () => {
      const g = c.t.pids?.gains.roll;
      expect(g).toBeDefined();
      if (!g) return;
      expect(g.p).toBeGreaterThanOrEqual(c.p[0]);
      expect(g.p).toBeLessThanOrEqual(c.p[1]);
      expect(g.dMin).toBeGreaterThanOrEqual(c.d[0]);
      expect(g.dMax).toBeLessThanOrEqual(c.d[1] + 15);
      expect(g.ff).toBeGreaterThanOrEqual(c.ff[0]);
      expect(g.ff).toBeLessThanOrEqual(c.ff[1]);
    });
  }
});

describe('scaling behaviour', () => {
  it('heavier craft (lower TWR) get more P; lighter, punchier craft get less', () => {
    const light = tune({ classId: 'mini', weightGrams: 500 }, 'freestyle').pids!.gains.roll.p;
    const heavy = tune({ classId: 'mini', weightGrams: 800 }, 'freestyle').pids!.gains.roll.p;
    expect(heavy).toBeGreaterThan(light);
  });
  it('bigger props shift the balance toward D and away from I', () => {
    const five = tune({ classId: 'mini' }, 'freestyle').pids!.gains.roll;
    const seven = tune({ classId: 'macro', weightGrams: 1000 }, 'freestyle').pids!.gains.roll;
    expect(seven.dMin / seven.p).toBeGreaterThan(five.dMin / five.p);
    expect(seven.i / seven.p).toBeLessThan(five.i / five.p);
  });
  it('styles: racing has the most FF and the widest D range, cinematic the least FF', () => {
    const race = tune({ classId: 'mini' }, 'racing').pids!.gains.roll;
    const free = tune({ classId: 'mini' }, 'freestyle').pids!.gains.roll;
    const cine = tune({ classId: 'mini' }, 'cinematic').pids!.gains.roll;
    expect(race.ff).toBeGreaterThan(free.ff);
    expect(free.ff).toBeGreaterThan(cine.ff);
    expect(race.dMax / race.dMin).toBeGreaterThan(free.dMax / free.dMin);
    expect(cine.dMin / cine.p).toBeGreaterThan(race.dMin / race.p);
  });
  it('sliders: snappy raises FF, propwash raises D and heat risk, lock-in raises I', () => {
    const base = tune({ classId: 'mini' }, 'freestyle');
    const snappy = tune({ classId: 'mini' }, 'freestyle', { sliders: { ...neutral, response: 1 } });
    const propwash = tune({ classId: 'mini' }, 'freestyle', { sliders: { ...neutral, propwash: 1 } });
    const locked = tune({ classId: 'mini' }, 'freestyle', { sliders: { ...neutral, lock: 1 } });
    expect(snappy.pids!.gains.roll.ff).toBeGreaterThan(base.pids!.gains.roll.ff);
    expect(snappy.dynamics!.feedforward.smoothFactor).toBeLessThan(base.dynamics!.feedforward.smoothFactor);
    expect(propwash.pids!.gains.roll.dMin).toBeGreaterThan(base.pids!.gains.roll.dMin);
    expect(propwash.filters!.heatRisk.score).toBeGreaterThan(base.filters!.heatRisk.score);
    expect(propwash.filters!.gyroLpf2.staticHz).toBeGreaterThan(base.filters!.gyroLpf2.staticHz);
    expect(locked.pids!.gains.roll.i).toBeGreaterThan(base.pids!.gains.roll.i);
  });
  it('hybrid: faster rates widen the D boost and lower the I-term relax cutoff', () => {
    const calm = tune({ classId: 'mini' }, 'freestyle', { rateFeel: { speed: -1, center: 0, curve: 0 } });
    const fast = tune({ classId: 'mini' }, 'freestyle', { rateFeel: { speed: 1, center: 0, curve: 0 } });
    expect(fast.rates.roll.max).toBeGreaterThan(calm.rates.roll.max);
    expect(fast.pids!.gains.roll.dMax / fast.pids!.gains.roll.dMin).toBeGreaterThan(calm.pids!.gains.roll.dMax / calm.pids!.gains.roll.dMin);
    expect(fast.dynamics!.itermRelax.cutoff).toBeLessThan(calm.dynamics!.itermRelax.cutoff);
    expect(fast.dynamics!.feedforward.maxRateLimit).toBeLessThanOrEqual(calm.dynamics!.feedforward.maxRateLimit);
  });
});

describe('scopes and filters', () => {
  it('rates-only output carries no PID or filter plan', () => {
    const t = tune({ classId: 'mini' }, 'racing', {}, 'rates');
    expect(t.pids).toBeUndefined();
    expect(t.filters).toBeUndefined();
    expect(t.rates.roll.max).toBeGreaterThan(t.rates.roll.center);
  });
  it('without RPM filtering: dynamic gyro lowpass on, more notches, no dynamic idle', () => {
    const t = tune({ classId: 'mini', rpmFilter: false }, 'freestyle');
    expect(t.filters!.rpm).toBeUndefined();
    expect(t.filters!.gyroLpf1.dynMinHz).toBeGreaterThan(0);
    expect(t.filters!.dynNotch.count).toBeGreaterThanOrEqual(4);
    expect(t.dynamics!.dynIdleMinRpm).toBe(0);
  });
  it('whoop motors (12 poles) filter 2 harmonics; dynamic idle scales with prop size', () => {
    const whoop = tune({ classId: 'tinywhoop' }, 'freestyle');
    const seven = tune({ classId: 'macro' }, 'freestyle');
    expect(whoop.filters!.rpm!.harmonics).toBe(2);
    expect(seven.filters!.rpm!.harmonics).toBe(3);
    expect(whoop.dynamics!.dynIdleMinRpm).toBeGreaterThan(100);
    expect(seven.dynamics!.dynIdleMinRpm).toBeLessThan(25);
    expect(seven.filters!.dynNotch.minHz).toBeLessThan(whoop.filters!.dynNotch.minHz);
  });
  it('noisier builds get lower cutoffs', () => {
    const clean = tune({ classId: 'mini', noise: 0 }, 'freestyle').filters!;
    const noisy = tune({ classId: 'mini', noise: 4 }, 'freestyle').filters!;
    expect(noisy.gyroLpf2.staticHz).toBeLessThan(clean.gyroLpf2.staticHz);
    expect(noisy.dtermLpf1.dynMinHz).toBeLessThan(clean.dtermLpf1.dynMinHz);
  });
});
