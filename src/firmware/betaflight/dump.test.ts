import { describe, expect, it } from 'vitest';
import { betaflightRatesFromSection, parseBetaflightDump } from './dump';
import { detectBetaflightVersion } from './versions';

const DIFF_ALL = `# diff all

# version
# Betaflight / STM32F7X2 (S7X2) 4.5.1 Nov 12 2024 / 10:20:30 (77d01ba3b) MSP API: 1.46
# config rev: 1ad2a4c

# start the command batch
batch start

board_name SPEEDYBEEF7V3
set motor_poles = 14
set dshot_bidir = ON

profile 0

set p_roll = 52
set d_min_roll = 34

profile 1

set p_roll = 60

rateprofile 0

set roll_rc_rate = 15
set roll_srate = 80
set roll_expo = 54

# restore original profile selection
profile 1
rateprofile 0

# end the command batch
batch end
`;

describe('Betaflight dump parser', () => {
  it('reads the banner, sections and the active profiles', () => {
    const d = parseBetaflightDump(DIFF_ALL);
    expect(d.firmware).toBe('Betaflight');
    expect(d.version).toBe('4.5.1');
    expect(d.master).toMatchObject({ motor_poles: '14', dshot_bidir: 'ON' });
    expect(d.profiles[0]).toEqual({ p_roll: '52', d_min_roll: '34' });
    expect(d.profiles[1]).toEqual({ p_roll: '60' });
    expect(d.activeProfile).toBe(1);
    expect(d.activeRateProfile).toBe(0);
  });

  it('extracts rates, filling firmware defaults for missing values', () => {
    const d = parseBetaflightDump(DIFF_ALL);
    expect(betaflightRatesFromSection(d.rateProfiles[0]!, 'roll')).toEqual({ model: 'ACTUAL', raw: { rcRate: 15, superRate: 80, expo: 54 } });
    expect(betaflightRatesFromSection(d.rateProfiles[0]!, 'yaw')).toEqual({ model: 'ACTUAL', raw: { rcRate: 7, superRate: 67, expo: 0 } });
  });

  it('accepts `get` output', () => {
    expect(parseBetaflightDump('roll_rc_rate = 12\nAllowed range: 1 - 255\n').master).toEqual({ roll_rc_rate: '12' });
  });
});

describe('version detection from the CLI banner', () => {
  const banner = (v: string) => `# Betaflight / STM32H743 (SH74) ${v} Oct 24 2026 / 07:53:00 (5b88201) MSP API: 1.47`;
  it.each([
    ['4.4.3', '4.4'],
    ['4.5.2', '4.5'],
    ['2025.12.6', '2025.12'],
    ['2026.6.3', '2026.6'],
    ['2026.12.0', '2026.6'],
  ])('%s → %s', (v, expected) => expect(detectBetaflightVersion(banner(v))).toBe(expected));
  it('rejects versions older than 4.4', () => expect(detectBetaflightVersion(banner('4.3.2'))).toBeUndefined());
});
