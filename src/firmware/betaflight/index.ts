import type { FirmwareAdapter } from '../types';
import { renderBetaflightCli } from './cli';
import { compileBetaflight } from './compile';
import { betaflightRatesFromSection, parseBetaflightDump } from './dump';
import { BETAFLIGHT_VERSIONS, betaflightSchema, detectBetaflightVersion } from './versions';

export const betaflightAdapter: FirmwareAdapter = {
  id: 'betaflight',
  name: 'Betaflight',
  support: 'supported',
  summary: 'Rates, PIDs and filters for 4.4, 4.5, 2025.12 and 2026.6, validated against each version’s CLI table.',
  versions: BETAFLIGHT_VERSIONS,
  defaultVersion: '2026.6',
  capabilities: { rates: true, pids: true, filters: true, cliExport: true, directConnect: true, importDump: true },
  rateModels: ['ACTUAL', 'BETAFLIGHT', 'KISS', 'RACEFLIGHT', 'QUICK'],
  // PID_PROFILE_COUNT 4, CONTROL_RATE_PROFILE_COUNT 4 (target/common_pre.h).
  profileCounts: { pid: 4, rate: 4 },
  compile: compileBetaflight,
  renderCli: renderBetaflightCli,
  parseDump: parseBetaflightDump,
  detectVersion: detectBetaflightVersion,
  paramSchema: betaflightSchema,
  ratesFromDump: betaflightRatesFromSection,
  cli: {
    enter: '#',
    // cliPrompt() prints "\r\n# " once the previous command finished.
    prompt: /\r?\n# $/,
    // cliPrintErrorVa(): "###ERROR IN <command>: <message>###"
    error: /###ERROR[^#]*###/,
    lineEnding: '\n',
    versionCommand: 'version',
    saveCommand: 'save',
    exitCommand: 'exit',
    rebootsOnSave: true,
  },
};
