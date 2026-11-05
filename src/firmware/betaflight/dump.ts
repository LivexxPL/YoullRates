// Parses Betaflight `diff`, `diff all`, `dump` and `get` output for import and comparison.
import type { RateModelId, RawRateParams } from '../../core/rates/models';
import type { Axis } from '../../core/types';
import type { ParsedDump } from '../types';

export function parseBetaflightDump(text: string): ParsedDump {
  const result: ParsedDump = { master: {}, profiles: {}, rateProfiles: {} };
  let section: 'master' | 'profile' | 'rateprofile' = 'master';
  let profile = 0;
  let rateProfile = 0;
  let restoring = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const banner = line.match(/^#\s*(\w+)\s*\/\s*\S+\s*\(\w+\)\s+(\d+\.\d+\.\d+)/);
    if (banner) {
      result.firmware = banner[1];
      result.version = banner[2];
      continue;
    }
    if (/^#\s*restore original profile selection/i.test(line)) {
      restoring = true;
      continue;
    }
    const body = line.replace(/#.*$/, '').trim();
    if (!body) continue;

    const profileCmd = body.match(/^(profile|rateprofile)\s+(\d+)$/i);
    if (profileCmd) {
      const index = Number(profileCmd[2]);
      if (profileCmd[1]?.toLowerCase() === 'profile') {
        profile = index;
        section = 'profile';
        if (restoring) result.activeProfile = index;
      } else {
        rateProfile = index;
        section = 'rateprofile';
        if (restoring) result.activeRateProfile = index;
      }
      continue;
    }
    // `set name = value` (diff/dump) or `name = value` (get).
    const assignment = body.match(/^(?:set\s+)?([a-z0-9_]+)\s*=\s*(.*)$/i);
    if (!assignment) continue;
    const name = assignment[1]?.toLowerCase() ?? '';
    const value = (assignment[2] ?? '').trim();
    if (section === 'profile') (result.profiles[profile] ??= {})[name] = value;
    else if (section === 'rateprofile') (result.rateProfiles[rateProfile] ??= {})[name] = value;
    else result.master[name] = value;
  }
  // A plain `diff` only lists the active profiles, without the restore section.
  result.activeProfile ??= Number(Object.keys(result.profiles)[0] ?? 0);
  result.activeRateProfile ??= Number(Object.keys(result.rateProfiles)[0] ?? 0);
  return result;
}

const BETAFLIGHT_RATE_TYPES: readonly RateModelId[] = ['BETAFLIGHT', 'RACEFLIGHT', 'KISS', 'ACTUAL', 'QUICK'];

/**
 * Rates of one axis from a rate-profile section. Values missing from a `diff` are at their
 * defaults (4.3+: ACTUAL, rc_rate 7, srate 67, expo 0).
 */
export function betaflightRatesFromSection(section: Record<string, string>, axis: Axis): { model: RateModelId; raw: RawRateParams } | undefined {
  const type = (section.rates_type ?? 'ACTUAL').toUpperCase() as RateModelId;
  if (!BETAFLIGHT_RATE_TYPES.includes(type)) return undefined;
  const num = (key: string, fallback: number) => {
    const v = Number(section[key]);
    return Number.isFinite(v) && section[key] !== undefined ? v : fallback;
  };
  return {
    model: type,
    raw: { rcRate: num(`${axis}_rc_rate`, 7), superRate: num(`${axis}_srate`, 67), expo: num(`${axis}_expo`, 0) },
  };
}
