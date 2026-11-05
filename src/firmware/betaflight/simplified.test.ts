import { describe, expect, it } from 'vitest';
import { defaultCraft } from '../../core/craft/classes';
import { generateTune } from '../../core/tuning/engine';
import { DEFAULT_SLIDERS, fitSliders, slidersToGains } from './simplified';

describe('Betaflight simplified tuning (config/simplified_tuning.c)', () => {
  it('default sliders reproduce the firmware defaults in both D-term namings', () => {
    expect(slidersToGains(DEFAULT_SLIDERS, 'roll', 'd-is-max')).toEqual({ p: 45, i: 80, dMax: 40, dMin: 30, ff: 120 });
    expect(slidersToGains(DEFAULT_SLIDERS, 'pitch', 'd-is-max')).toEqual({ p: 47, i: 84, dMax: 46, dMin: 34, ff: 125 });
    expect(slidersToGains(DEFAULT_SLIDERS, 'roll', 'd-is-base')).toEqual({ p: 45, i: 80, dMin: 30, dMax: 40, ff: 120 });
    expect(slidersToGains(DEFAULT_SLIDERS, 'yaw', 'd-is-base')).toEqual({ p: 45, i: 80, dMin: 0, dMax: 0, ff: 120 });
  });

  it('reproduces a published preset (UAV Tech whoop, 4.5: master 160, D 140, dynamic damping 0)', () => {
    const s = { ...DEFAULT_SLIDERS, masterMultiplier: 160, dGain: 140, dMaxGain: 0 };
    expect(slidersToGains(s, 'roll', 'd-is-max')).toEqual({ p: 72, i: 128, dMax: 67, dMin: 67, ff: 192 });
    expect(slidersToGains(s, 'pitch', 'd-is-max')).toEqual({ p: 75, i: 134, dMax: 76, dMin: 76, ff: 200 });
  });

  it('dynamic damping 0 turns the D boost off in 2025.12+ too (d_max = d)', () => {
    const g = slidersToGains({ ...DEFAULT_SLIDERS, dMaxGain: 0 }, 'roll', 'd-is-base');
    expect(g.dMax).toBe(g.dMin);
  });

  it('fits slider positions that land within a couple of units of generated gains', () => {
    for (const classId of ['tinywhoop', 'micro', 'mini', 'macro'] as const) {
      const tune = generateTune({ craft: defaultCraft(classId), style: 'freestyle', sliders: { response: 0, propwash: 0, lock: 0 }, rateFeel: { speed: 0, center: 0, curve: 0 }, scope: 'rates+pids' });
      const target = tune.pids!.gains;
      for (const naming of ['d-is-max', 'd-is-base'] as const) {
        const fit = fitSliders(target, naming);
        for (const axis of ['roll', 'pitch'] as const) {
          expect(Math.abs(fit.gains[axis].p - target[axis].p)).toBeLessThanOrEqual(2);
          expect(Math.abs(fit.gains[axis].dMin - target[axis].dMin)).toBeLessThanOrEqual(2.5);
          expect(Math.abs(fit.gains[axis].ff - target[axis].ff) / target[axis].ff).toBeLessThan(0.03);
        }
        for (const v of Object.values(fit.sliders)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(200);
        }
      }
    }
  });
});
