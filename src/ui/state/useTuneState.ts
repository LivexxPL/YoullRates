// All wizard answers and output options in one reducer, persisted in localStorage so a pilot can
// come back to the same tune. Everything the app shows is derived from this state.
import { useEffect, useMemo, useReducer } from 'react';
import { CRAFT_CLASSES_INFO, defaultCraft, suggestedWeight } from '../../core/craft/classes';
import type { RateModelId } from '../../core/rates/models';
import { generateTune, type CanonicalTune } from '../../core/tuning/engine';
import type { CraftClassId, CraftSpec, FeelSliders, FlightStyle, RateFeel, RateSet, TuneScope } from '../../core/types';
import { getAdapter } from '../../firmware/registry';
import type { CompiledConfig, FirmwareAdapter, FirmwareId, ParamValue, ParsedDump, PidOutputMode } from '../../firmware/types';

export interface AppState {
  step: number;
  craft: CraftSpec;
  style: FlightStyle;
  scope: TuneScope;
  sliders: FeelSliders;
  rateFeel: RateFeel;
  /** Rates imported from the pilot's setup or edited per axis in expert mode. */
  customRates?: RateSet;
  firmware: FirmwareId;
  version: string;
  profileIndex: number;
  rateProfileIndex: number;
  ratesType: RateModelId;
  pidMode: PidOutputMode;
  overrides: Record<string, ParamValue>;
  expert: boolean;
  imported?: ParsedDump;
  /** The pilot set the weight themselves (style changes then keep it). */
  weightTouched: boolean;
}

export type Action =
  | { type: 'step'; step: number }
  | { type: 'craftClass'; classId: CraftClassId }
  | { type: 'craft'; patch: Partial<CraftSpec>; weightTouched?: boolean }
  | { type: 'style'; style: FlightStyle }
  | { type: 'scope'; scope: TuneScope }
  | { type: 'slider'; key: keyof FeelSliders; value: number }
  | { type: 'rateFeel'; key: keyof RateFeel; value: number }
  | { type: 'customRates'; rates?: RateSet }
  | { type: 'firmware'; firmware: FirmwareId }
  | { type: 'output'; patch: Partial<Pick<AppState, 'version' | 'profileIndex' | 'rateProfileIndex' | 'ratesType' | 'pidMode'>> }
  | { type: 'override'; name: string; value?: ParamValue }
  | { type: 'clearOverrides' }
  | { type: 'expert'; expert: boolean }
  | { type: 'import'; dump?: ParsedDump; version?: string }
  | { type: 'reset' };

const STORAGE_KEY = 'tuneforge:v1';

export function initialState(): AppState {
  return {
    step: 0,
    craft: defaultCraft('mini'),
    style: 'freestyle',
    scope: 'full',
    sliders: { response: 0, propwash: 0, lock: 0 },
    rateFeel: { speed: 0, center: 0, curve: 0 },
    firmware: 'betaflight',
    version: getAdapter('betaflight').defaultVersion,
    profileIndex: 0,
    rateProfileIndex: 0,
    ratesType: 'ACTUAL',
    pidMode: 'sliders',
    overrides: {},
    expert: false,
    weightTouched: false,
  };
}

function load(): AppState {
  const fallback = initialState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<AppState>;
    return { ...fallback, ...saved, craft: { ...fallback.craft, ...saved.craft }, sliders: { ...fallback.sliders, ...saved.sliders }, rateFeel: { ...fallback.rateFeel, ...saved.rateFeel } };
  } catch {
    return fallback;
  }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'step':
      return { ...state, step: action.step };
    case 'craftClass': {
      const info = CRAFT_CLASSES_INFO[action.classId];
      const craft = { ...defaultCraft(action.classId), rpmFilter: state.craft.rpmFilter, noise: state.craft.noise, linkRateHz: state.craft.linkRateHz };
      return { ...state, craft: { ...craft, weightGrams: suggestedWeight(action.classId, info.defaultStyle, craft.frame) }, style: info.defaultStyle, weightTouched: false, customRates: undefined, overrides: {} };
    }
    case 'craft': {
      const craft = { ...state.craft, ...action.patch };
      // Switching between ducted and open changes the typical weight a lot.
      if (action.patch.frame && action.patch.frame !== state.craft.frame && !state.weightTouched) craft.weightGrams = suggestedWeight(craft.classId, state.style, craft.frame);
      return { ...state, craft, weightTouched: state.weightTouched || Boolean(action.weightTouched) };
    }
    case 'style': {
      const weightGrams = state.weightTouched ? state.craft.weightGrams : suggestedWeight(state.craft.classId, action.style, state.craft.frame);
      return { ...state, style: action.style, craft: { ...state.craft, weightGrams }, customRates: undefined };
    }
    case 'scope':
      return { ...state, scope: action.scope };
    case 'slider':
      return { ...state, sliders: { ...state.sliders, [action.key]: action.value } };
    case 'rateFeel':
      return { ...state, rateFeel: { ...state.rateFeel, [action.key]: action.value }, customRates: undefined };
    case 'customRates':
      return { ...state, customRates: action.rates };
    case 'firmware': {
      const adapter = getAdapter(action.firmware);
      return { ...state, firmware: action.firmware, version: adapter.defaultVersion, ratesType: adapter.rateModels[0] ?? 'ACTUAL', overrides: {}, scope: adapter.capabilities.pids ? state.scope : 'rates' };
    }
    case 'output':
      return { ...state, ...action.patch, overrides: action.patch.version && action.patch.version !== state.version ? {} : state.overrides };
    case 'override': {
      const overrides = { ...state.overrides };
      if (action.value === undefined) delete overrides[action.name];
      else overrides[action.name] = action.value;
      return { ...state, overrides };
    }
    case 'clearOverrides':
      return { ...state, overrides: {} };
    case 'expert':
      return { ...state, expert: action.expert };
    case 'import':
      return { ...state, imported: action.dump, version: action.version ?? state.version };
    case 'reset':
      return { ...initialState(), expert: state.expert };
  }
}

export interface Derived {
  adapter: FirmwareAdapter;
  tune: CanonicalTune;
  config?: CompiledConfig;
  script: string;
}

export function useTuneState() {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private mode or storage full: the app still works, it just will not remember.
    }
  }, [state]);

  const derived = useMemo<Derived>(() => {
    const adapter = getAdapter(state.firmware);
    const scope: TuneScope = adapter.capabilities.pids ? state.scope : 'rates';
    const tune = generateTune({ craft: state.craft, style: state.style, sliders: state.sliders, rateFeel: state.rateFeel, scope }, state.customRates);
    if (!adapter.compile || !adapter.renderCli) return { adapter, tune, script: '' };
    const config = adapter.compile(tune, {
      version: state.version,
      profileIndex: state.profileIndex,
      rateProfileIndex: state.rateProfileIndex,
      ratesType: state.ratesType,
      pidMode: state.pidMode,
      overrides: state.overrides,
    });
    return { adapter, tune, config, script: adapter.renderCli(config, tune) };
  }, [state]);

  return { state, dispatch, ...derived };
}
