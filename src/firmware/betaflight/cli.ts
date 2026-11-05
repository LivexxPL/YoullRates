// Renders a compiled configuration as a Betaflight CLI script.
//
// Firmware behaviour this layout relies on (cli/cli.c, identical in 4.4 → 2026.6):
// - Everything after '#' on a line is stripped, so comment lines are safe to paste.
// - `profile N` / `rateprofile N` (0-based) select the PID / rate profile that later `set`
//   commands of that scope write to; master settings are global.
// - Inside `batch start`, any failing command sets an error flag. `save` refuses to write while
//   that flag is set ("PLEASE FIX ERRORS THEN 'SAVE'"), but `batch end` clears it. So the script
//   ends with `save` *inside* the batch: one bad line and nothing is stored.
import type { CanonicalTune } from '../../core/tuning/engine';
import type { CompiledConfig, CompiledParam, ParamGroup, ParamScope, RenderOptions } from '../types';

const GROUP_TITLES: Record<ParamGroup, string> = {
  meta: 'name',
  rates: 'rates',
  throttle: 'throttle curve',
  pids: 'PID gains',
  feedforward: 'feedforward',
  'pid-extras': 'I-term relax, anti-gravity, TPA',
  filters: 'filters',
  motors: 'motors',
  'rc-link': 'RC smoothing',
};
const GROUP_ORDER: readonly ParamGroup[] = ['meta', 'rates', 'throttle', 'pids', 'feedforward', 'pid-extras', 'filters', 'motors', 'rc-link'];

const STYLE_LABEL = { freestyle: 'Freestyle', cinematic: 'Cinematic', racing: 'Racing' } as const;

export function describeCraft(tune: CanonicalTune): string {
  const c = tune.input.craft;
  const prop = c.propInches < 2 ? `${Math.round(c.propInches * 25.4)} mm` : `${c.propInches}"`;
  return `${prop} ${c.frame === 'ducted' ? 'ducted' : 'open-prop'}, ${c.cells}S, ${c.weightGrams} g`;
}


function section(lines: string[], params: CompiledParam[], comments: boolean) {
  for (const group of GROUP_ORDER) {
    const inGroup = params.filter((p) => p.group === group);
    if (!inGroup.length) continue;
    if (comments && group !== 'meta') lines.push(`# ${GROUP_TITLES[group]}`);
    for (const p of inGroup) lines.push(`set ${p.name} = ${String(p.value)}`);
    lines.push('');
  }
}

export function renderBetaflightCli(config: CompiledConfig, tune: CanonicalTune, options: RenderOptions = {}): string {
  const comments = options.comments ?? true;
  const byScope = (scope: ParamScope) => config.params.filter((p) => p.scope === scope);
  const lines: string[] = [];
  if (comments) {
    const date = (options.generatedAt ?? new Date()).toISOString().slice(0, 10);
    const scope = tune.input.scope === 'rates' ? 'rates only' : tune.input.scope === 'rates+pids' ? 'rates + PIDs' : 'rates + PIDs + filters';
    lines.push(
      `# TuneForge FPV: ${STYLE_LABEL[tune.input.style]} tune (${scope}) for ${describeCraft(tune)}`,
      `# Betaflight ${config.version}, written ${date}. PID profile ${config.profileIndex + 1}, rate profile ${config.rateProfileIndex + 1}.`,
      '# Paste everything into the CLI tab. The final save is inside the batch: if any line',
      '# reports an error, save is refused and nothing is stored. Props off for the first power-up.',
      '',
    );
  }
  lines.push('batch start', '');

  const master = byScope('master');
  if (master.length) {
    if (comments) lines.push('# ---- global settings ----');
    section(lines, master, comments);
  }
  const profile = byScope('profile');
  if (profile.length) {
    if (comments) lines.push(`# ---- PID profile ${config.profileIndex + 1} ----`);
    lines.push(`profile ${config.profileIndex}`, '');
    section(lines, profile, comments);
  }
  const rateProfile = byScope('rateprofile');
  if (rateProfile.length) {
    if (comments) lines.push(`# ---- rate profile ${config.rateProfileIndex + 1} ----`);
    lines.push(`rateprofile ${config.rateProfileIndex}`, '');
    section(lines, rateProfile, comments);
  }
  lines.push('save', '');
  return lines.join('\n');
}

/** The script as a list of commands only (no comments or blank lines), for pushing over serial. */
export function cliCommands(script: string): string[] {
  return script
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);
}
