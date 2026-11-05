import { describe, expect, it } from 'vitest';
import { defaultCraft } from '../../core/craft/classes';
import { generateTune } from '../../core/tuning/engine';
import { inavAdapter } from './index';

describe('INAV adapter (experimental, rates only)', () => {
  const tune = generateTune({ craft: defaultCraft('mini'), style: 'racing', sliders: { response: 0, propwash: 0, lock: 0 }, rateFeel: { speed: 0, center: 0, curve: 0 }, scope: 'rates' });
  const config = inavAdapter.compile!(tune, { version: '7+', profileIndex: 0, rateProfileIndex: 0 });

  it('writes valid INAV rate settings', () => {
    expect(config.issues).toEqual([]);
    expect(config.params.find((p) => p.name === 'roll_rate')?.value).toBe(70);
    expect(config.rateFit.roll!.rmsError).toBeLessThan(40);
  });
  it('uses the 1-based control_profile command', () => {
    expect(inavAdapter.renderCli!(config, tune)).toMatch(/\ncontrol_profile 1\n/);
  });
});
