// Supported Betaflight versions, their generated CLI schemas and the naming differences between them.
import type { FirmwareVersionInfo, ParamDef, ParamSchema, ParamValue } from '../types';
import bf44 from './schema/bf-4.4.json';
import bf45 from './schema/bf-4.5.json';
import bf202512 from './schema/bf-2025.12.json';
import bf20266 from './schema/bf-2026.6.json';

export const BETAFLIGHT_VERSIONS: readonly FirmwareVersionInfo[] = [
  { id: '2026.6', label: 'Betaflight 2026.6', note: 'Latest release' },
  { id: '2025.12', label: 'Betaflight 2025.12', note: 'D-term naming changed: d_* is the base D, d_max_* the boost' },
  { id: '4.5', label: 'Betaflight 4.5' },
  { id: '4.4', label: 'Betaflight 4.4' },
];

const SCHEMAS: Record<string, ParamSchema> = {
  '4.4': bf44 as ParamSchema,
  '4.5': bf45 as ParamSchema,
  '2025.12': bf202512 as ParamSchema,
  '2026.6': bf20266 as ParamSchema,
};

export function betaflightSchema(version: string): ParamSchema {
  const schema = SCHEMAS[version];
  if (!schema) throw new Error(`No Betaflight ${version} schema; supported: ${Object.keys(SCHEMAS).join(', ')}`);
  return schema;
}

/**
 * Naming differences, read from the schema itself so a newly generated version is handled without
 * code changes:
 * - 4.4/4.5: `d_<axis>` is the D used during fast moves (max), `d_min_<axis>` the resting D.
 *   2025.12+: `d_<axis>` is the resting D, `d_max_<axis>` the boosted D.
 * - The "dynamic damping" slider: `simplified_dmax_gain` → `simplified_d_max_gain` (2025.12+).
 * - Digital idle: `dshot_idle_value` → `motor_idle` (2025.12+).
 */
export interface VersionTraits {
  dTermNaming: 'd-is-max' | 'd-is-base';
  dynamicDampingSlider: string;
  idleParam: string;
}

export function versionTraits(schema: ParamSchema): VersionTraits {
  const has = (name: string) => name in schema.params;
  return {
    dTermNaming: has('d_max_roll') ? 'd-is-base' : 'd-is-max',
    dynamicDampingSlider: has('simplified_d_max_gain') ? 'simplified_d_max_gain' : 'simplified_dmax_gain',
    idleParam: has('motor_idle') ? 'motor_idle' : 'dshot_idle_value',
  };
}

/** Maps the `version` banner ("# Betaflight / STM32F7X2 (S7X2) 4.5.1 …") to a supported schema. */
export function detectBetaflightVersion(banner: string): string | undefined {
  const m = banner.match(/Betaflight\s*\/\s*\S+\s*\(\w+\)\s+(\d+)\.(\d+)\.(\d+)/);
  if (!m) return undefined;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const key = major >= 2000 ? major * 100 + minor : major * 10 + minor; // 2025.12 → 202512, 4.5 → 45
  const known = BETAFLIGHT_VERSIONS.map((v) => {
    const [a = 0, b = 0] = v.id.split('.').map(Number);
    return { id: v.id, key: a >= 2000 ? a * 100 + b : a * 10 + b };
  }).sort((x, y) => y.key - x.key);
  // Newest supported version that is not newer than the firmware (newer firmware → newest schema).
  return known.find((v) => v.key <= key)?.id;
}

export function validateParam(def: ParamDef | undefined, name: string, value: ParamValue): string | undefined {
  if (!def) return `"${name}" does not exist in this firmware version`;
  switch (def.kind) {
    case 'range': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(n)) return `${name} must be a whole number`;
      if (def.min !== undefined && n < def.min) return `${name} = ${n} is below the minimum ${def.min}`;
      if (def.max !== undefined && n > def.max) return `${name} = ${n} is above the maximum ${def.max}`;
      return undefined;
    }
    case 'lookup':
      return def.values?.includes(String(value).toUpperCase()) ? undefined : `${name} must be one of ${def.values?.join(', ')}`;
    case 'string': {
      const s = String(value);
      if (s.includes('#')) return `${name} cannot contain "#" (the CLI strips everything after it)`;
      if (def.maxLength !== undefined && s.length > def.maxLength) return `${name} is limited to ${def.maxLength} characters`;
      if (def.minLength !== undefined && s.length < def.minLength) return `${name} needs at least ${def.minLength} character`;
      return undefined;
    }
    default:
      return undefined;
  }
}
