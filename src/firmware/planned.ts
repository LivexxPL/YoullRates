// Firmwares on the roadmap. Each entry documents what an adapter needs; implementing one means
// filling in compile/renderCli (and optionally parseDump/cli) as src/firmware/betaflight does.
import type { FirmwareAdapter } from './types';

export const emuflightAdapter: FirmwareAdapter = {
  id: 'emuflight',
  name: 'EmuFlight',
  support: 'planned',
  summary: 'Betaflight-derived CLI. Needs its own schema (generate one from its settings.c) and a PID scale table: EmuFlight gains are not Betaflight 4.3+ gains.',
  versions: [{ id: '0.4', label: 'EmuFlight 0.4' }],
  defaultVersion: '0.4',
  capabilities: { rates: false, pids: false, filters: false, cliExport: false, directConnect: false, importDump: false },
  rateModels: [],
};

export const kissAdapter: FirmwareAdapter = {
  id: 'kiss',
  name: 'KISS / Ultra',
  support: 'planned',
  summary: 'Configured through the KISS GUI rather than a text CLI: an adapter would export a settings file or show the values to enter by hand. KISS rates are already modelled (core/rates).',
  versions: [{ id: 'ultra', label: 'KISS Ultra' }],
  defaultVersion: 'ultra',
  capabilities: { rates: false, pids: false, filters: false, cliExport: false, directConnect: false, importDump: false },
  rateModels: ['KISS'],
};
