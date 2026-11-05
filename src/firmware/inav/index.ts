// INAV adapter: experimental, rates only. It shows how a second firmware plugs in: same canonical
// tune, different rate model (shared roll/pitch expo, deg/s ÷ 10) and a different CLI dialect
// (1-based `control_profile`). Names and ranges are from src/main/fc/settings.yaml.
import { canonicalRate, fitRateModel } from '../../core/rates/fit';
import { evaluateRate, RATE_MODELS, type RawRateParams } from '../../core/rates/models';
import type { CanonicalTune } from '../../core/tuning/engine';
import type { CompileOptions, CompiledConfig, CompiledParam, FirmwareAdapter, ParamDef, RateFitReport, ValidationIssue } from '../types';
import { validateParam } from '../betaflight/versions';

const SCHEMA: Record<string, ParamDef> = {
  rc_expo: { scope: 'rateprofile', type: 'UINT8', kind: 'range', min: 0, max: 100 },
  rc_yaw_expo: { scope: 'rateprofile', type: 'UINT8', kind: 'range', min: 0, max: 100 },
  roll_rate: { scope: 'rateprofile', type: 'UINT8', kind: 'range', min: 4, max: 180 },
  pitch_rate: { scope: 'rateprofile', type: 'UINT8', kind: 'range', min: 4, max: 180 },
  yaw_rate: { scope: 'rateprofile', type: 'UINT8', kind: 'range', min: 1, max: 180 },
};

function compileInav(tune: CanonicalTune, options: CompileOptions): CompiledConfig {
  const model = RATE_MODELS.INAV;
  const roll = (x: number) => canonicalRate(tune.rates.roll, x);
  const pitch = (x: number) => canonicalRate(tune.rates.pitch, x);
  // Roll and pitch share rc_expo: pick the expo that suits both, each axis keeps its own rate.
  const rollRate = Math.min(180, Math.max(4, Math.round(tune.rates.roll.max / 10)));
  const pitchRate = Math.min(180, Math.max(4, Math.round(tune.rates.pitch.max / 10)));
  let bestExpo = 0;
  let bestCost = Infinity;
  for (let expo = 0; expo <= 100; expo++) {
    let cost = 0;
    for (let i = 0; i <= 40; i++) {
      const x = i / 40;
      cost += (evaluateRate(model, { rcRate: rollRate, superRate: 0, expo }, x) - roll(x)) ** 2;
      cost += (evaluateRate(model, { rcRate: pitchRate, superRate: 0, expo }, x) - pitch(x)) ** 2;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestExpo = expo;
    }
  }
  const yawFit = fitRateModel(model, (x) => canonicalRate(tune.rates.yaw, x));
  const report = (raw: RawRateParams, target: (x: number) => number): RateFitReport => {
    let sum = 0;
    let max = 0;
    for (let i = 0; i <= 40; i++) {
      const d = Math.abs(evaluateRate(model, raw, i / 40) - target(i / 40));
      sum += d * d;
      max = Math.max(max, d);
    }
    return { model: 'INAV', raw, rmsError: Math.sqrt(sum / 41), maxError: max };
  };
  const params: CompiledParam[] = [
    { name: 'rc_expo', value: bestExpo, scope: 'rateprofile', group: 'rates', note: 'Shared by roll and pitch in INAV' },
    { name: 'roll_rate', value: rollRate, scope: 'rateprofile', group: 'rates', note: `${rollRate * 10}°/s` },
    { name: 'pitch_rate', value: pitchRate, scope: 'rateprofile', group: 'rates', note: `${pitchRate * 10}°/s` },
    { name: 'rc_yaw_expo', value: yawFit.params.expo, scope: 'rateprofile', group: 'rates' },
    { name: 'yaw_rate', value: yawFit.params.rcRate, scope: 'rateprofile', group: 'rates', note: `${yawFit.params.rcRate * 10}°/s` },
  ];
  const issues: ValidationIssue[] = [];
  for (const [name, value] of Object.entries(options.overrides ?? {})) {
    const p = params.find((q) => q.name === name);
    if (p) {
      p.value = value;
      p.overridden = true;
    } else {
      issues.push({ name, severity: 'error', message: `TuneForge only writes INAV rate settings; "${name}" cannot be edited here.` });
    }
  }
  for (const p of params) {
    const problem = validateParam(SCHEMA[p.name], p.name, p.value);
    if (problem) issues.push({ name: p.name, severity: 'error', message: problem });
  }
  return {
    firmware: 'inav',
    version: options.version,
    profileIndex: options.profileIndex,
    rateProfileIndex: options.rateProfileIndex,
    params,
    issues,
    rateFit: {
      roll: report({ rcRate: rollRate, superRate: 0, expo: bestExpo }, roll),
      pitch: report({ rcRate: pitchRate, superRate: 0, expo: bestExpo }, pitch),
      yaw: { model: 'INAV', raw: yawFit.params, rmsError: yawFit.rmsError, maxError: yawFit.maxError },
    },
    notes: ['INAV support is experimental and covers rates only: INAV PID scaling differs from Betaflight and is not modelled yet.'],
  };
}

function renderInavCli(config: CompiledConfig, tune: CanonicalTune): string {
  const lines = [
    `# TuneForge FPV: ${tune.input.style} rates for INAV (experimental, rates only)`,
    '# Paste into the INAV CLI tab.',
    '',
    `control_profile ${config.rateProfileIndex + 1}`,
    '',
    ...config.params.map((p) => `set ${p.name} = ${p.value}`),
    '',
    'save',
    '',
  ];
  return lines.join('\n');
}

export const inavAdapter: FirmwareAdapter = {
  id: 'inav',
  name: 'INAV',
  support: 'experimental',
  summary: 'Rates only (shared roll/pitch expo). PIDs and filters are not modelled for INAV yet.',
  versions: [{ id: '7+', label: 'INAV 7 and newer', note: 'Uses control_profile (1-based)' }],
  defaultVersion: '7+',
  capabilities: { rates: true, pids: false, filters: false, cliExport: true, directConnect: false, importDump: false },
  rateModels: ['INAV'],
  profileCounts: { pid: 3, rate: 3 },
  compile: compileInav,
  renderCli: renderInavCli,
  paramSchema: (version) => ({ firmware: 'inav', version, params: SCHEMA }),
};
