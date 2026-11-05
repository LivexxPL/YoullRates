// The plugin contract every flight-controller firmware implements.
//
// The core produces a firmware-agnostic CanonicalTune (rate curves in deg/s, PID gains in
// Betaflight-scale units, filter cutoffs in Hz). An adapter compiles it into its firmware's
// parameters, validates them against that firmware version, renders a CLI script, parses dumps
// for import, and describes its CLI protocol so the transport layer can push settings.
import type { CanonicalTune } from '../core/tuning/engine';
import type { RateModelId, RawRateParams } from '../core/rates/models';
import type { Axis, PerAxis } from '../core/types';

export type FirmwareId = 'betaflight' | 'inav' | 'emuflight' | 'kiss';
export type SupportLevel = 'supported' | 'experimental' | 'planned';
export type ParamScope = 'master' | 'profile' | 'rateprofile';
export type ParamGroup = 'rates' | 'throttle' | 'pids' | 'feedforward' | 'pid-extras' | 'filters' | 'motors' | 'rc-link' | 'meta';
export type ParamValue = string | number;

/** One CLI parameter of a firmware version (generated from the firmware source, see scripts/). */
export interface ParamDef {
  scope: ParamScope;
  type: string;
  kind: 'range' | 'lookup' | 'string' | 'array' | 'bitset';
  min?: number;
  max?: number;
  values?: string[];
  minLength?: number;
  maxLength?: number;
  length?: number;
}

export interface ParamSchema {
  firmware: FirmwareId;
  version: string;
  params: Record<string, ParamDef>;
}

export interface CompiledParam {
  name: string;
  value: ParamValue;
  scope: ParamScope;
  group: ParamGroup;
  /** Why this value (shown in expert mode). */
  note?: string;
  /** The value came from an expert-mode override. */
  overridden?: boolean;
}

export interface ValidationIssue {
  name: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface RateFitReport {
  model: RateModelId;
  raw: RawRateParams;
  rmsError: number;
  maxError: number;
}

export interface CompiledConfig {
  firmware: FirmwareId;
  version: string;
  /** 0-based PID profile / rate profile the script writes to. */
  profileIndex: number;
  rateProfileIndex: number;
  params: CompiledParam[];
  issues: ValidationIssue[];
  rateFit: Partial<PerAxis<RateFitReport>>;
  notes: string[];
}

export type PidOutputMode = 'sliders' | 'raw';

export interface CompileOptions {
  version: string;
  profileIndex: number;
  rateProfileIndex: number;
  ratesType?: RateModelId;
  /** Betaflight: express PIDs through the simplified-tuning sliders, or as raw gains. */
  pidMode?: PidOutputMode;
  /** Expert-mode edits, by CLI parameter name. */
  overrides?: Record<string, ParamValue>;
}

export interface RenderOptions {
  /** Comment lines describing the craft and settings (true by default). */
  comments?: boolean;
  /** Date stamp for the header comment. */
  generatedAt?: Date;
}

export interface ParsedDump {
  firmware?: string;
  version?: string;
  /** Global settings. */
  master: Record<string, string>;
  /** Settings per 0-based profile index. */
  profiles: Record<number, Record<string, string>>;
  rateProfiles: Record<number, Record<string, string>>;
  activeProfile?: number;
  activeRateProfile?: number;
}

/** How to talk to the firmware's text CLI over a serial port. */
export interface CliDialect {
  /** Sent to switch from MSP to CLI mode. */
  enter: string;
  /** Matches the end of output once the CLI waits for the next command. */
  prompt: RegExp;
  /** Matches an error reported for the last command. */
  error: RegExp;
  lineEnding: string;
  versionCommand: string;
  saveCommand: string;
  /** Leaves the CLI without saving (Betaflight reboots on exit). */
  exitCommand: string;
  rebootsOnSave: boolean;
}

export interface FirmwareVersionInfo {
  id: string;
  label: string;
  note?: string;
}

export interface FirmwareAdapter {
  id: FirmwareId;
  name: string;
  support: SupportLevel;
  summary: string;
  versions: readonly FirmwareVersionInfo[];
  defaultVersion: string;
  capabilities: {
    rates: boolean;
    pids: boolean;
    filters: boolean;
    cliExport: boolean;
    directConnect: boolean;
    importDump: boolean;
  };
  /** Rate models the firmware can store, first = recommended. */
  rateModels: readonly RateModelId[];
  profileCounts?: { pid: number; rate: number };
  compile?(tune: CanonicalTune, options: CompileOptions): CompiledConfig;
  renderCli?(config: CompiledConfig, tune: CanonicalTune, options?: RenderOptions): string;
  parseDump?(text: string): ParsedDump;
  /** Version id from the CLI `version` banner, if this firmware produced it. */
  detectVersion?(banner: string): string | undefined;
  /** CLI parameter table of a version (expert mode: inputs, ranges, validation). */
  paramSchema?(version: string): ParamSchema | undefined;
  /** Raw rates of one axis from a dump section, for "start from my current rates". */
  ratesFromDump?(section: Record<string, string>, axis: Axis): { model: RateModelId; raw: RawRateParams } | undefined;
  cli?: CliDialect;
}
