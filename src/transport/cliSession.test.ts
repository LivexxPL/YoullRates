import { describe, expect, it } from 'vitest';
import { defaultCraft } from '../core/craft/classes';
import { generateTune } from '../core/tuning/engine';
import { betaflightAdapter } from '../firmware/betaflight';
import { cliCommands, renderBetaflightCli } from '../firmware/betaflight/cli';
import { compileBetaflight } from '../firmware/betaflight/compile';
import { CliSession, pushScript } from './cliSession';
import { SimulatedFlightController } from './simulatedFc';
import type { SerialTransport } from './types';

const fast = { session: { settleMs: 1, commandTimeoutMs: 1000 } };
const tune = generateTune({ craft: defaultCraft('mini'), style: 'freestyle', sliders: { response: 0, propwash: 0, lock: 0 }, rateFeel: { speed: 0, center: 0, curve: 0 }, scope: 'full' });
const scriptFor = (version: string) => {
  const config = compileBetaflight(tune, { version, profileIndex: 1, rateProfileIndex: 2 });
  return { config, commands: cliCommands(renderBetaflightCli(config, tune)) };
};

describe('pushing a script over the CLI', () => {
  it('writes every value into the right profile and saves', async () => {
    const fc = new SimulatedFlightController('4.5');
    await fc.open();
    const { config, commands } = scriptFor('4.5');
    const progress: number[] = [];
    const report = await pushScript(fc, betaflightAdapter, commands, { ...fast, expectedVersion: '4.5', onProgress: (done) => progress.push(done) });
    expect(report.message).toMatch(/Saved/);
    expect(report.ok && report.saved).toBe(true);
    expect(report.banner).toMatch(/4\.5\.2/);
    expect(progress.at(-1)).toBe(commands.length);
    for (const p of config.params) {
      const section = p.scope === 'master' ? fc.saved!.master : p.scope === 'profile' ? fc.saved!.profiles[1] : fc.saved!.rateProfiles[2];
      expect(section?.[p.name], p.name).toBe(String(p.value));
    }
    expect(fc.isOpen).toBe(false); // rebooted after save
  });

  it('refuses to write a script compiled for another firmware version', async () => {
    const fc = new SimulatedFlightController('2026.6');
    await fc.open();
    const report = await pushScript(fc, betaflightAdapter, scriptFor('4.5').commands, { ...fast, expectedVersion: '4.5' });
    expect(report.ok).toBe(false);
    expect(report.message).toMatch(/runs Betaflight 2026\.6.*built for 4\.5/);
    expect(fc.saved).toBeUndefined();
    expect(fc.received.some((c) => c.startsWith('set '))).toBe(false);
  });

  it('stops at the first error and leaves without saving', async () => {
    const fc = new SimulatedFlightController('2025.12');
    await fc.open();
    // A 4.5 script on 2025.12: the first renamed setting (simplified_dmax_gain → simplified_d_max_gain) fails.
    const report = await pushScript(fc, betaflightAdapter, scriptFor('4.5').commands, fast);
    expect(report.ok).toBe(false);
    expect(report.message).toMatch(/simplified_dmax_gain.*INVALID NAME/);
    expect(fc.saved).toBeUndefined();
    expect(fc.received.at(-1)).toBe('exit');
  });
});

describe('Betaflight CLI semantics the script relies on', () => {
  it('a failed set inside a batch makes save refuse', async () => {
    const fc = new SimulatedFlightController('4.5');
    await fc.open();
    const cli = new CliSession(fc, betaflightAdapter.cli!, { settleMs: 1 });
    await cli.enter();
    await cli.send('batch start');
    expect((await cli.send('set p_roll = 999')).error).toMatch(/INVALID VALUE/);
    const save = await cli.save(500);
    expect(save.error).toMatch(/ERRORS WERE DETECTED/);
    expect(fc.saved).toBeUndefined();
  });

  it('copes with output split into single characters', async () => {
    const fc = new SimulatedFlightController('4.5');
    const chunked: SerialTransport = {
      label: 'chunked',
      get isOpen() {
        return fc.isOpen;
      },
      open: () => fc.open(),
      close: () => fc.close(),
      write: (t) => fc.write(t),
      onClose: (h) => fc.onClose(h),
      onData: (h) => fc.onData((text) => [...text].forEach((ch) => h(ch))),
    };
    await chunked.open();
    const cli = new CliSession(chunked, betaflightAdapter.cli!, { settleMs: 5 });
    await cli.enter();
    const v = await cli.send('version');
    expect(v.output).toMatch(/^# Betaflight \/ STM32F7X2 \(S7X2\) 4\.5\.2/);
    expect((await cli.send('set p_roll = 50')).output).toBe('p_roll set to 50');
  });
});
