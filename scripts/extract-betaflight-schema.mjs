#!/usr/bin/env node
// Generates the per-version Betaflight CLI parameter schema used to validate every generated
// `set` line (name, scope, range or allowed values).
//
//   node scripts/extract-betaflight-schema.mjs <betaflight-checkout> <version-label> [--out <file>]
//
// Example (adding a new firmware release):
//   git clone --depth=1 -b 2026.6-maintenance https://github.com/betaflight/betaflight /tmp/bf
//   node scripts/extract-betaflight-schema.mjs /tmp/bf 2026.6 --out src/firmware/betaflight/schema/bf-2026.6.json
//
// The script reads src/main/cli/settings.c (the CLI value table and lookup tables),
// src/main/cli/settings.h (lookup table order) and every header under src/main (for the
// #define constants used as min/max). Conditional compilation is resolved for a regular
// multirotor build: every USE_* feature is assumed enabled except the wing-only ones.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outFile = outIndex >= 0 ? args[outIndex + 1] : undefined;
const [root, label] = args.filter((_, i) => i !== outIndex && i !== outIndex + 1);
if (!root || !label) {
  console.error('usage: extract-betaflight-schema.mjs <betaflight-checkout> <version-label> [--out <file>]');
  process.exit(2);
}

// Features that a multirotor build does NOT compile in.
const UNDEFINED_FEATURES = new Set(['USE_WING', 'USE_LAUNCH_WING', 'USE_VIRTUAL_LED', 'USE_RX_SX127X', 'USE_RX_SX1280', 'SIMULATOR_BUILD', 'UNIT_TEST', 'MINIMAL_CLI']);
const isDefined = (name) => (name.startsWith('USE_') ? !UNDEFINED_FEATURES.has(name) : false);

/** Keeps only the lines that a multirotor build compiles (#if / #ifdef / #elif / #else / #endif). */
function preprocess(text) {
  const out = [];
  const stack = []; // { parentActive, active, taken }
  const active = () => stack.every((f) => f.active);
  const evalCondition = (expr) => {
    let js = expr
      .replace(/\/\/.*$/, '')
      .replace(/\/\*.*?\*\//g, '')
      .replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, n) => (isDefined(n) ? ' 1 ' : ' 0 '))
      .replace(/defined\s+(\w+)/g, (_, n) => (isDefined(n) ? ' 1 ' : ' 0 '))
      .replace(/\b[A-Za-z_]\w*\b/g, (n) => (isDefined(n) ? ' 1 ' : ' 0 '));
    js = js.replace(/&&/g, ' && ').replace(/\|\|/g, ' || ');
    try {
      return Boolean(Function(`"use strict"; return (${js});`)());
    } catch {
      return true;
    }
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*#\s*(ifdef|ifndef|if|elif|else|endif)\b(.*)$/);
    if (!m) {
      if (active()) out.push(line);
      continue;
    }
    const [, directive, rest] = m;
    const name = rest.trim().split(/\s+/)[0] ?? '';
    if (directive === 'ifdef' || directive === 'ifndef' || directive === 'if') {
      const cond = directive === 'ifdef' ? isDefined(name) : directive === 'ifndef' ? !isDefined(name) : evalCondition(rest);
      stack.push({ active: cond, taken: cond });
    } else if (directive === 'elif') {
      const top = stack[stack.length - 1];
      if (top) {
        const cond = !top.taken && evalCondition(rest);
        top.active = cond;
        top.taken ||= cond;
      }
    } else if (directive === 'else') {
      const top = stack[stack.length - 1];
      if (top) {
        top.active = !top.taken;
        top.taken = true;
      }
    } else {
      stack.pop();
    }
  }
  return out.join('\n');
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.[ch]$/.test(entry)) files.push(path);
  }
  return files;
}

// #define constants for min/max expressions.
const defines = new Map();
for (const file of walk(join(root, 'src/main'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/^\s*#define\s+([A-Z_][A-Z0-9_]*)\s+([^\n]+?)\s*(?:\/\/[^\n]*)?$/gm)) {
    if (!defines.has(m[1])) defines.set(m[1], m[2].replace(/\/\*.*?\*\//g, '').trim());
  }
  // Enum members with explicit values (e.g. AUTO_PROFILE_CELL_COUNT_CHANGE = -1).
  for (const body of text.matchAll(/enum\s*\w*\s*\{([\s\S]*?)\}/g)) {
    for (const m of body[1].matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(-?\d+)\s*,?/gm)) {
      if (!defines.has(m[1])) defines.set(m[1], m[2]);
    }
  }
}
const KNOWN = { INT8_MIN: -128, INT8_MAX: 127, UINT8_MAX: 255, INT16_MIN: -32768, INT16_MAX: 32767, UINT16_MAX: 65535, INT32_MIN: -2147483648, INT32_MAX: 2147483647, UINT32_MAX: 4294967295 };
function evaluate(expr, depth = 0) {
  if (depth > 25) return expr;
  const substituted = expr.replace(/\b[A-Za-z_]\w*\b/g, (n) => {
    if (n in KNOWN) return String(KNOWN[n]);
    if (defines.has(n)) return `(${evaluate(defines.get(n), depth + 1)})`;
    return n;
  });
  const cleaned = substituted.replace(/(\d+(?:\.\d+)?)[fFuUlL]+\b/g, '$1').replace(/\(\s*u?int\d+_t\s*\)/g, '');
  if (!/^[\d\s+\-*/().]+$/.test(cleaned)) return expr.trim();
  try {
    const v = Function(`"use strict"; return (${cleaned});`)();
    return Number.isFinite(v) ? Math.trunc(v) : expr.trim();
  } catch {
    return expr.trim();
  }
}

const settingsC = preprocess(readFileSync(join(root, 'src/main/cli/settings.c'), 'utf8'));
const settingsH = preprocess(readFileSync(join(root, 'src/main/cli/settings.h'), 'utf8'));
const paramNames = (() => {
  try {
    return readFileSync(join(root, 'src/main/fc/parameter_names.h'), 'utf8');
  } catch {
    return '';
  }
})();
const paramNameDefines = new Map([...paramNames.matchAll(/#define\s+(PARAM_NAME_\w+)\s+"([^"]+)"/g)].map((m) => [m[1], m[2]]));

// Lookup tables: lookupTableXxx[] string arrays, ordered by lookupTables[] which follows the TABLE_* enum.
const stringTables = new Map();
for (const m of settingsC.matchAll(/const\s+char\s*\*\s*const\s+(lookupTable\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
  stringTables.set(m[1], [...m[2].replace(/\/\/[^\n]*/g, '').matchAll(/"([^"]*)"/g)].map((x) => x[1]));
}
// Entries are either LOOKUP_TABLE_ENTRY(name) or { name, COUNT }.
const tableOrder = [...(settingsC.match(/lookupTableEntry_t\s+lookupTables\[\]\s*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '').matchAll(/LOOKUP_TABLE_ENTRY\((\w+)\)|\{\s*(\w+)\s*,/g)].map((m) => m[1] ?? m[2]);
const enumBody = settingsH.match(/typedef\s+enum\s*\{([\s\S]*?)\}\s*lookupTableIndex_e;/)?.[1] ?? '';
const enumOrder = [...enumBody.replace(/\/\/[^\n]*/g, '').matchAll(/\b(TABLE_\w+)\b/g)].map((m) => m[1]);
const tableValues = new Map(enumOrder.map((name, i) => [name, stringTables.get(tableOrder[i] ?? '') ?? null]));

const valueTable = settingsC.match(/const\s+clivalue_t\s+valueTable\[\]\s*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '';
const params = {};
const entryRe = /\{\s*("[^"]+"|PARAM_NAME_\w+)\s*,\s*([^,]+?),\s*(\.config\.\w+(?:\.\w+)?\s*=\s*\{[^}]*\}|\.config\.\w+(?:\.\w+)?\s*=\s*[^,{]+?)\s*,\s*(PG_\w+)/g;
for (const m of valueTable.replace(/\/\/[^\n]*/g, '').matchAll(entryRe)) {
  const name = m[1].startsWith('"') ? m[1].slice(1, -1) : paramNameDefines.get(m[1]) ?? m[1];
  const flags = m[2];
  const config = m[3];
  const scope = flags.includes('PROFILE_RATE_VALUE') ? 'rateprofile' : flags.includes('PROFILE_VALUE') ? 'profile' : 'master';
  const type = flags.match(/VAR_(\w+)/)?.[1] ?? 'UNKNOWN';
  const param = { scope, type };
  if (flags.includes('MODE_LOOKUP')) {
    const table = config.match(/TABLE_\w+/)?.[0];
    param.kind = 'lookup';
    param.values = (table && tableValues.get(table)) ?? [];
  } else if (flags.includes('MODE_ARRAY')) {
    param.kind = 'array';
    param.length = evaluate(config.replace(/.*=\s*/, '').replace(/[{}]/g, ''));
  } else if (flags.includes('MODE_STRING')) {
    const s = config.match(/\{\s*([^,]+),\s*([^,]+),/);
    param.kind = 'string';
    if (s) {
      param.minLength = evaluate(s[1]);
      param.maxLength = evaluate(s[2]);
    }
  } else if (flags.includes('MODE_BITSET')) {
    param.kind = 'bitset';
  } else {
    const r = config.match(/\{\s*([^,]+?)\s*,\s*([^}]+?)\s*\}/);
    param.kind = 'range';
    if (r) {
      param.min = evaluate(r[1]);
      param.max = evaluate(r[2]);
    }
  }
  params[name] = param;
}

// Tuning-related master (global) settings; every PID-profile and rate-profile setting is kept.
const MASTER_PREFIXES = ['gyro_lpf', 'gyro_notch', 'gyro_hardware_lpf', 'simplified_gyro', 'dyn_notch', 'rpm_filter', 'dshot_bidir', 'dshot_idle_value', 'motor_idle', 'motor_poles', 'motor_pwm_protocol', 'motor_kv', 'rc_smoothing', 'pid_process_denom', 'yaw_spin', 'gyro_filter_debug_axis'];
const selected = Object.fromEntries(
  Object.entries(params)
    .filter(([name, p]) => p.scope !== 'master' || MASTER_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .sort(([a], [b]) => a.localeCompare(b)),
);

let commit;
try {
  commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  commit = undefined;
}
const unresolved = Object.entries(selected).filter(([, p]) => p.kind === 'range' && (typeof p.min !== 'number' || typeof p.max !== 'number'));
for (const [name, p] of unresolved) console.error(`warning: ${name} has an unresolved range ${p.min}..${p.max}`);

const lines = Object.entries(selected).map(([name, p]) => `    ${JSON.stringify(name)}: ${JSON.stringify(p)}`);
const json = `{\n  "firmware": "betaflight",\n  "version": ${JSON.stringify(label)},\n  "source": ${JSON.stringify({ file: relative(root, join(root, 'src/main/cli/settings.c')), commit })},\n  "params": {\n${lines.join(',\n')}\n  }\n}\n`;
if (outFile) writeFileSync(outFile, json);
else process.stdout.write(json);
console.error(`${Object.keys(selected).length} parameters (${Object.keys(params).length} in the full table)`);
