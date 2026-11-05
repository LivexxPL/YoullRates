import { describe, expect, it } from 'vitest';
import { defaultCraft } from '../../core/craft/classes';
import { generateTune } from '../../core/tuning/engine';
import type { CraftClassId, FlightStyle, TuneScope } from '../../core/types';
import { cliCommands, renderBetaflightCli } from './cli';
import { compileBetaflight } from './compile';
import { parseBetaflightDump } from './dump';

const tuneFor = (classId: CraftClassId, style: FlightStyle, scope: TuneScope = 'full', rpmFilter = true) =>
  generateTune({ craft: { ...defaultCraft(classId), rpmFilter }, style, sliders: { response: 0, propwash: 0, lock: 0 }, rateFeel: { speed: 0, center: 0, curve: 0 }, scope });
const VERSIONS = ['4.4', '4.5', '2025.12', '2026.6'];
const value = (config: ReturnType<typeof compileBetaflight>, name: string) => config.params.find((p) => p.name === name)?.value;

describe('Betaflight compiler', () => {
  it('produces only valid parameters for every version, class, style, scope and PID mode', () => {
    for (const version of VERSIONS)
      for (const classId of ['tinywhoop', 'micro', 'mini', 'macro'] as const)
        for (const style of ['freestyle', 'cinematic', 'racing'] as const)
          for (const scope of ['rates', 'rates+pids', 'full'] as const)
            for (const pidMode of ['sliders', 'raw'] as const) {
              const config = compileBetaflight(tuneFor(classId, style, scope, classId !== 'macro'), { version, profileIndex: 1, rateProfileIndex: 2, pidMode });
              expect(config.issues, `${version} ${classId} ${style} ${scope} ${pidMode}`).toEqual([]);
            }
  });

  it('maps resting and boosted D to the right names: 4.5 d/d_min, 2025.12+ d/d_max', () => {
    const tune = tuneFor('mini', 'racing');
    const g = tune.pids!.gains.roll;
    const v45 = compileBetaflight(tune, { version: '4.5', profileIndex: 0, rateProfileIndex: 0, pidMode: 'raw' });
    expect(value(v45, 'd_roll')).toBe(Math.round(g.dMax));
    expect(value(v45, 'd_min_roll')).toBe(Math.round(g.dMin));
    expect(value(v45, 'd_max_roll')).toBeUndefined();
    const v2026 = compileBetaflight(tune, { version: '2026.6', profileIndex: 0, rateProfileIndex: 0, pidMode: 'raw' });
    expect(value(v2026, 'd_roll')).toBe(Math.round(g.dMin));
    expect(value(v2026, 'd_max_roll')).toBe(Math.round(g.dMax));
    expect(value(v2026, 'd_min_roll')).toBeUndefined();
    expect(v2026.notes.join(' ')).toMatch(/d_max_\* the boost/);
  });

  it('uses the version-specific slider name and switches sliders off in raw mode', () => {
    const tune = tuneFor('mini', 'freestyle');
    expect(value(compileBetaflight(tune, { version: '4.5', profileIndex: 0, rateProfileIndex: 0 }), 'simplified_dmax_gain')).toBeDefined();
    expect(value(compileBetaflight(tune, { version: '2025.12', profileIndex: 0, rateProfileIndex: 0 }), 'simplified_d_max_gain')).toBeDefined();
    const raw = compileBetaflight(tune, { version: '4.5', profileIndex: 0, rateProfileIndex: 0, pidMode: 'raw' });
    expect(value(raw, 'simplified_pids_mode')).toBe('OFF');
    expect(value(raw, 'simplified_gyro_filter')).toBe('OFF');
    expect(value(raw, 'simplified_dterm_filter')).toBe('OFF');
  });

  it('rates-only output touches nothing but the rate profile', () => {
    const config = compileBetaflight(tuneFor('mini', 'racing', 'rates'), { version: '4.5', profileIndex: 0, rateProfileIndex: 0 });
    expect(config.params.every((p) => p.scope === 'rateprofile')).toBe(true);
    expect(value(config, 'rates_type')).toBe('ACTUAL');
    expect(value(config, 'roll_srate')).toBe(70);
  });

  it('applies expert overrides and reports invalid ones', () => {
    const tune = tuneFor('mini', 'freestyle');
    const ok = compileBetaflight(tune, { version: '4.5', profileIndex: 0, rateProfileIndex: 0, overrides: { p_roll: 61, gyro_lpf2_static_hz: 600 } });
    expect(ok.params.find((p) => p.name === 'p_roll')).toMatchObject({ value: 61, overridden: true });
    expect(ok.issues.map((i) => i.severity)).toEqual(['warning']); // hand-edited gain with sliders on
    expect(compileBetaflight(tune, { version: '4.5', profileIndex: 0, rateProfileIndex: 0, pidMode: 'raw', overrides: { p_roll: 61 } }).issues).toEqual([]);
    const bad = compileBetaflight(tune, { version: '4.5', profileIndex: 0, rateProfileIndex: 0, pidMode: 'raw', overrides: { p_roll: 300, d_max_roll: 40 } });
    expect(bad.issues.map((i) => i.name).sort()).toEqual(['d_max_roll', 'p_roll']);
  });

  it('can export any Betaflight rates type with a close curve', () => {
    for (const ratesType of ['BETAFLIGHT', 'KISS', 'QUICK', 'RACEFLIGHT'] as const) {
      const config = compileBetaflight(tuneFor('mini', 'freestyle', 'rates'), { version: '4.5', profileIndex: 0, rateProfileIndex: 0, ratesType });
      expect(config.issues).toEqual([]);
      expect(config.rateFit.roll!.rmsError, ratesType).toBeLessThan(40);
    }
  });
});

describe('Betaflight CLI script', () => {
  const tune = tuneFor('mini', 'freestyle');
  const config = compileBetaflight(tune, { version: '4.5', profileIndex: 1, rateProfileIndex: 2 });
  const script = renderBetaflightCli(config, tune, { generatedAt: new Date('2026-11-05T12:00:00Z') });
  const commands = cliCommands(script);

  it('is one batch whose save happens before any batch end', () => {
    expect(commands[0]).toBe('batch start');
    expect(commands.at(-1)).toBe('save');
    expect(commands).not.toContain('batch end');
  });

  it('selects the profiles (0-based) before writing their settings', () => {
    const profileAt = commands.indexOf('profile 1');
    const rateProfileAt = commands.indexOf('rateprofile 2');
    expect(profileAt).toBeGreaterThan(0);
    expect(rateProfileAt).toBeGreaterThan(profileAt);
    expect(commands.indexOf('set p_roll = ' + value(config, 'p_roll'))).toBeGreaterThan(profileAt);
    expect(commands.indexOf('set roll_srate = ' + value(config, 'roll_srate'))).toBeGreaterThan(rateProfileAt);
    expect(commands.indexOf('set gyro_lpf2_static_hz = ' + value(config, 'gyro_lpf2_static_hz'))).toBeLessThan(profileAt);
  });

  it('round-trips through the dump parser', () => {
    const parsed = parseBetaflightDump(script);
    for (const p of config.params) {
      const section = p.scope === 'master' ? parsed.master : p.scope === 'profile' ? parsed.profiles[1] : parsed.rateProfiles[2];
      expect(section?.[p.name], p.name).toBe(String(p.value));
    }
  });

  it('keeps comment text off the command lines', () => {
    expect(script).toMatch(/^# TuneForge FPV/);
    expect(commands.every((c) => !c.includes('#'))).toBe(true);
  });
});

describe('expert edits of rates', () => {
  it('the reported curve follows hand-edited raw rate values', () => {
    const tune = tuneFor('mini', 'freestyle', 'rates');
    const config = compileBetaflight(tune, { version: '4.5', profileIndex: 0, rateProfileIndex: 0, overrides: { roll_srate: 100 } });
    expect(config.rateFit.roll!.raw.superRate).toBe(100);
    expect(config.rateFit.roll!.maxError).toBeGreaterThan(100);
    expect(config.rateFit.pitch!.raw.superRate).toBe(85);
  });
});
