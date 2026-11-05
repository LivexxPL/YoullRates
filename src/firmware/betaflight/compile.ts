// CanonicalTune → Betaflight CLI parameters for one firmware version.
import { canonicalRate, fitRateModel } from '../../core/rates/fit';
import { evaluateRate, RATE_MODELS, type RateModelId } from '../../core/rates/models';
import type { CanonicalTune } from '../../core/tuning/engine';
import type { PidGains } from '../../core/tuning/pid';
import { AXES, type FlightStyle, type PerAxis } from '../../core/types';
import type { CompileOptions, CompiledConfig, CompiledParam, ParamGroup, ParamValue, RateFitReport, ValidationIssue } from '../types';
import { fitSliders, type IntegerGains } from './simplified';
import { betaflightSchema, validateParam, versionTraits } from './versions';

const STYLE_TAG: Record<FlightStyle, string> = { freestyle: 'FREE', cinematic: 'CINE', racing: 'RACE' };

/** Profile name shown in the OSD/configurator: max 8 characters, no '#'. */
export const profileName = (style: FlightStyle) => `TF-${STYLE_TAG[style]}`;

export function compileBetaflight(tune: CanonicalTune, options: CompileOptions): CompiledConfig {
  const schema = betaflightSchema(options.version);
  const traits = versionTraits(schema);
  const params: CompiledParam[] = [];
  const issues: ValidationIssue[] = [];
  const notes: string[] = [];

  const add = (name: string, value: ParamValue, group: ParamGroup, note?: string) => {
    const def = schema.params[name];
    if (!def) {
      issues.push({ name, severity: 'warning', message: `${name} is not available in Betaflight ${options.version}; skipped.` });
      return;
    }
    const existing = params.findIndex((p) => p.name === name);
    const entry: CompiledParam = { name, value, scope: def.scope, group, note };
    if (existing >= 0) params[existing] = entry;
    else params.push(entry);
  };
  const style = tune.input.style;

  // ---- Rate profile -------------------------------------------------------------------------
  const ratesType: RateModelId = options.ratesType ?? 'ACTUAL';
  const model = RATE_MODELS[ratesType];
  add('rateprofile_name', profileName(style), 'meta');
  add('rates_type', ratesType, 'rates', `${model.label} rates`);
  if (ratesType === 'QUICK') add('quickrates_rc_expo', 'OFF', 'rates');
  const rateFit: Partial<PerAxis<RateFitReport>> = {};
  for (const axis of AXES) {
    const curve = tune.rates[axis];
    const fit = fitRateModel(model, (x) => canonicalRate(curve, x));
    rateFit[axis] = { model: ratesType, raw: fit.params, rmsError: fit.rmsError, maxError: fit.maxError };
    const shape = `${Math.round(curve.center)}°/s center, ${Math.round(curve.max)}°/s max, expo ${curve.expo.toFixed(2)}`;
    add(`${axis}_rc_rate`, fit.params.rcRate, 'rates', shape);
    add(`${axis}_srate`, fit.params.superRate, 'rates');
    add(`${axis}_expo`, fit.params.expo, 'rates');
  }
  if (tune.dynamics) {
    add('thr_mid', tune.dynamics.throttle.mid, 'throttle');
    add('thr_expo', tune.dynamics.throttle.expo, 'throttle');
  }

  // ---- PID profile --------------------------------------------------------------------------
  if (tune.pids && tune.dynamics) {
    add('profile_name', profileName(style), 'meta');
    const naming = traits.dTermNaming;
    const pidMode = options.pidMode ?? 'sliders';
    let gains: PerAxis<IntegerGains>;
    if (pidMode === 'sliders') {
      const fit = fitSliders(tune.pids.gains, naming, tune.pids.authority);
      gains = fit.gains;
      const s = fit.sliders;
      add('simplified_pids_mode', 'RPY', 'pids', 'PIDs follow the Betaflight sliders; the values below are what the sliders produce');
      add('simplified_master_multiplier', s.masterMultiplier, 'pids', 'Craft scaling (thrust-to-weight, prop size); the other sliders carry style and feel');
      add('simplified_pi_gain', s.piGain, 'pids');
      add('simplified_i_gain', s.iGain, 'pids');
      add('simplified_d_gain', s.dGain, 'pids');
      add(traits.dynamicDampingSlider, s.dMaxGain, 'pids');
      add('simplified_feedforward_gain', s.feedforwardGain, 'pids');
      add('simplified_pitch_d_gain', s.pitchDGain, 'pids');
      add('simplified_pitch_pi_gain', s.pitchPiGain, 'pids');
    } else {
      gains = roundGains(tune.pids.gains);
      add('simplified_pids_mode', 'OFF', 'pids', 'Sliders off, so neither the firmware nor the Betaflight App recalculates these gains');
    }
    for (const axis of AXES) {
      const g = gains[axis];
      add(`p_${axis}`, g.p, 'pids');
      add(`i_${axis}`, g.i, 'pids');
      if (naming === 'd-is-max') {
        // 4.4/4.5: d_* is the boosted D, d_min_* the resting D (D boost off when d_min >= d).
        add(`d_${axis}`, g.dMax, 'pids', axis === 'yaw' ? undefined : 'D during fast moves / propwash (D max)');
        add(`d_min_${axis}`, Math.min(g.dMin, g.dMax), 'pids', axis === 'yaw' ? undefined : 'Resting D (D min)');
      } else {
        // 2025.12+: d_* is the resting D, d_max_* the boosted D (boost off when d_max <= d).
        add(`d_${axis}`, g.dMin, 'pids', axis === 'yaw' ? undefined : 'Resting D');
        add(`d_max_${axis}`, Math.max(g.dMin, g.dMax), 'pids', axis === 'yaw' ? undefined : 'D during fast moves / propwash (D max)');
      }
      add(`f_${axis}`, g.ff, 'pids');
    }

    const d = tune.dynamics;
    add('feedforward_averaging', d.feedforward.averaging, 'feedforward');
    add('feedforward_smooth_factor', d.feedforward.smoothFactor, 'feedforward');
    add('feedforward_jitter_factor', d.feedforward.jitterFactor, 'feedforward');
    add('feedforward_boost', d.feedforward.boost, 'feedforward');
    add('feedforward_transition', d.feedforward.transition, 'feedforward');
    add('feedforward_max_rate_limit', d.feedforward.maxRateLimit, 'feedforward');
    add('iterm_relax', d.itermRelax.axes, 'pid-extras');
    add('iterm_relax_type', 'SETPOINT', 'pid-extras');
    add('iterm_relax_cutoff', d.itermRelax.cutoff, 'pid-extras');
    add('anti_gravity_gain', d.antiGravityGain, 'pid-extras');
    add('tpa_mode', d.tpa.mode, 'pid-extras');
    add('tpa_rate', d.tpa.rate, 'pid-extras');
    add('tpa_breakpoint', d.tpa.breakpoint, 'pid-extras');
    add('thrust_linear', d.thrustLinear, 'motors');
    add('vbat_sag_compensation', d.vbatSagCompensation, 'motors');
    add('rc_smoothing', 'ON', 'rc-link');
    add('rc_smoothing_auto_factor', d.rcSmoothingAutoFactor, 'rc-link', 'Higher = smoother RC, more delay');
  }

  // ---- Filters and motors (global, plus the D-term filters of the PID profile) ---------------
  if (tune.filters && tune.dynamics) {
    const f = tune.filters;
    add('simplified_gyro_filter', 'OFF', 'filters', 'Filter sliders off: the explicit cutoffs below are used as written');
    add('gyro_lpf1_type', f.gyroLpf1.type, 'filters');
    add('gyro_lpf1_static_hz', f.gyroLpf1.staticHz, 'filters');
    add('gyro_lpf1_dyn_min_hz', f.gyroLpf1.dynMinHz, 'filters', f.gyroLpf1.dynMinHz === 0 ? '0 = dynamic lowpass off' : undefined);
    add('gyro_lpf1_dyn_max_hz', f.gyroLpf1.dynMaxHz, 'filters');
    add('gyro_lpf2_type', f.gyroLpf2.type, 'filters');
    add('gyro_lpf2_static_hz', f.gyroLpf2.staticHz, 'filters');
    add('dyn_notch_count', f.dynNotch.count, 'filters');
    add('dyn_notch_q', f.dynNotch.q, 'filters');
    add('dyn_notch_min_hz', f.dynNotch.minHz, 'filters');
    add('dyn_notch_max_hz', f.dynNotch.maxHz, 'filters');
    add('simplified_dterm_filter', 'OFF', 'filters');
    add('dterm_lpf1_type', f.dtermLpf1.type, 'filters');
    add('dterm_lpf1_static_hz', f.dtermLpf1.staticHz, 'filters');
    add('dterm_lpf1_dyn_min_hz', f.dtermLpf1.dynMinHz, 'filters');
    add('dterm_lpf1_dyn_max_hz', f.dtermLpf1.dynMaxHz, 'filters');
    add('dterm_lpf1_dyn_expo', f.dtermLpf1.dynExpo, 'filters');
    add('dterm_lpf2_type', f.dtermLpf2.type, 'filters');
    add('dterm_lpf2_static_hz', f.dtermLpf2.staticHz, 'filters');
    add('yaw_lowpass_hz', f.yawLowpassHz, 'filters');
    add('motor_poles', f.motorPoles, 'motors', 'Magnet count: RPM filter frequencies depend on it');
    if (f.rpm) {
      add('dshot_bidir', 'ON', 'motors', 'Bidirectional DShot: needs Bluejay, BLHeli_32 or AM32 ESC firmware');
      add('rpm_filter_harmonics', f.rpm.harmonics, 'filters');
      add('rpm_filter_q', f.rpm.q, 'filters');
      add('rpm_filter_min_hz', f.rpm.minHz, 'filters');
      add('rpm_filter_fade_range_hz', f.rpm.fadeRangeHz, 'filters');
      add('rpm_filter_lpf_hz', f.rpm.lpfHz, 'filters');
      add('dyn_idle_min_rpm', tune.dynamics.dynIdleMinRpm, 'motors', `${tune.dynamics.dynIdleMinRpm * 100} RPM minimum while armed`);
      notes.push('RPM filtering needs working bidirectional DShot: check the Motors tab shows RPM and 0 % errors before the first flight.');
    } else {
      add('dshot_bidir', 'OFF', 'motors', 'ESC firmware without RPM telemetry');
      add('dyn_idle_min_rpm', 0, 'motors');
    }
  }

  // ---- Expert overrides and validation --------------------------------------------------------
  for (const [name, value] of Object.entries(options.overrides ?? {})) {
    const def = schema.params[name];
    if (!def) {
      issues.push({ name, severity: 'error', message: `Override "${name}" does not exist in Betaflight ${options.version}.` });
      continue;
    }
    const existing = params.find((p) => p.name === name);
    if (existing) {
      existing.value = value;
      existing.overridden = true;
    } else {
      params.push({ name, value, scope: def.scope, group: 'meta', overridden: true, note: 'Added in expert mode' });
    }
  }
  // Expert edits of raw rate values: the preview must show what will actually be written.
  for (const axis of AXES) {
    const fit = rateFit[axis];
    const num = (name: string) => Number(params.find((p) => p.name === name)?.value);
    const type = String(params.find((p) => p.name === 'rates_type')?.value ?? ratesType) as RateModelId;
    const raw = { rcRate: num(`${axis}_rc_rate`), superRate: num(`${axis}_srate`), expo: num(`${axis}_expo`) };
    if (!fit || !(type in RATE_MODELS) || !Object.values(raw).every(Number.isFinite)) continue;
    if (type === fit.model && raw.rcRate === fit.raw.rcRate && raw.superRate === fit.raw.superRate && raw.expo === fit.raw.expo) continue;
    let maxError = 0;
    for (let i = 0; i <= 40; i++) maxError = Math.max(maxError, Math.abs(evaluateRate(RATE_MODELS[type], raw, i / 40) - canonicalRate(tune.rates[axis], i / 40)));
    rateFit[axis] = { model: type, raw, rmsError: maxError, maxError };
  }
  const editedGains = Object.keys(options.overrides ?? {}).filter((n) => /^(p|i|d|f|d_min|d_max)_(roll|pitch|yaw)$/.test(n));
  if (editedGains.length && (options.pidMode ?? 'sliders') === 'sliders' && tune.pids) {
    issues.push({ name: editedGains[0] ?? 'p_roll', severity: 'warning', message: `You edited ${editedGains.join(', ')} while the PID format is "Betaflight sliders": the Betaflight App recalculates gains from the sliders when the PID tab is saved. Choose "Raw gains" to keep hand-edited values.` });
  }
  for (const p of params) {
    const problem = validateParam(schema.params[p.name], p.name, p.value);
    if (problem) issues.push({ name: p.name, severity: 'error', message: problem });
  }
  if (traits.dTermNaming === 'd-is-base') notes.push(`Betaflight ${options.version}: d_* is the resting D and d_max_* the boost (the reverse of 4.4/4.5). Do not paste D values from older tunes unchanged.`);

  return { firmware: 'betaflight', version: options.version, profileIndex: options.profileIndex, rateProfileIndex: options.rateProfileIndex, params, issues, rateFit, notes };
}

function roundGains(gains: PerAxis<PidGains>): PerAxis<IntegerGains> {
  const r = (g: PidGains): IntegerGains => ({ p: Math.round(g.p), i: Math.round(g.i), dMin: Math.round(g.dMin), dMax: Math.round(g.dMax), ff: Math.round(g.ff) });
  return { roll: r(gains.roll), pitch: r(gains.pitch), yaw: r(gains.yaw) };
}
