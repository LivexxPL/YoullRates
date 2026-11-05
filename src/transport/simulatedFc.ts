// A simulated Betaflight flight controller behind the SerialTransport interface. It reproduces the
// CLI behaviour the push flow depends on (prompt, echo, set/get, profile selection, batch error
// flag, save refusal, reboot on save/exit) and validates every `set` against the generated schema
// of the chosen version. Used by the tests and by the app's "demo flight controller".
import { betaflightSchema, validateParam } from '../firmware/betaflight/versions';
import type { ParamSchema } from '../firmware/types';
import type { SerialTransport } from './types';

const BANNERS: Record<string, string> = {
  '4.4': '# Betaflight / STM32F7X2 (S7X2) 4.4.3 Nov 14 2023 / 03:27:33 (3f62795) MSP API: 1.45',
  '4.5': '# Betaflight / STM32F7X2 (S7X2) 4.5.2 Nov 1 2026 / 17:22:46 (7dcc851) MSP API: 1.46',
  '2025.12': '# Betaflight / STM32H743 (SH74) 2025.12.6 Oct 24 2026 / 07:53:00 (5b88201) MSP API: 1.47',
  '2026.6': '# Betaflight / STM32H743 (SH74) 2026.6.3 Oct 19 2026 / 16:42:28 (0db9244) MSP API: 1.48',
};

export class SimulatedFlightController implements SerialTransport {
  readonly label: string;
  private open_ = false;
  private inCli = false;
  private line = '';
  private batchActive = false;
  private batchError = false;
  private profile = 0;
  private rateProfile = 0;
  private readonly schema: ParamSchema;
  private dataHandlers = new Set<(text: string) => void>();
  private closeHandlers = new Set<() => void>();
  /** Values in RAM (what `get` shows) and the last saved configuration. */
  readonly ram = { master: {} as Record<string, string>, profiles: [{}, {}, {}, {}] as Record<string, string>[], rateProfiles: [{}, {}, {}, {}] as Record<string, string>[] };
  saved?: typeof this.ram;
  /** Every command line received, for inspection. */
  readonly received: string[] = [];

  constructor(readonly version = '2026.6') {
    this.schema = betaflightSchema(version);
    this.label = `Simulated Betaflight ${version}`;
  }

  get isOpen(): boolean {
    return this.open_;
  }

  async open(): Promise<void> {
    this.open_ = true;
    this.inCli = false;
  }

  async write(text: string): Promise<void> {
    if (!this.open_) throw new Error('Port closed');
    for (const ch of text) {
      if (!this.inCli) {
        if (ch === '#') {
          this.inCli = true;
          this.batchActive = false;
          this.batchError = false;
          this.emit("\r\nEntering CLI Mode, type 'exit' to reboot, or 'help'\r\n\r\n# ");
        }
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        if (this.line.length) {
          const line = this.line;
          this.line = '';
          this.emit(`${line}\r\n`); // interactive echo
          this.process(line);
        }
        continue;
      }
      this.line += ch;
    }
  }

  onData(handler: (text: string) => void): () => void {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  async close(): Promise<void> {
    this.reboot();
  }

  private emit(text: string) {
    // Serial data arrives asynchronously.
    setTimeout(() => {
      for (const handler of this.dataHandlers) handler(text);
    }, 0);
  }

  private reboot() {
    if (!this.open_) return;
    setTimeout(() => {
      this.open_ = false;
      this.inCli = false;
      for (const handler of this.closeHandlers) handler();
    }, 5);
  }

  private error(command: string, message: string) {
    if (this.batchActive) this.batchError = true;
    this.emit(`###ERROR IN ${command}: ${message}###\r\n`);
  }

  private process(rawLine: string) {
    const line = rawLine.replace(/#.*$/, '').trim();
    this.received.push(line);
    const [command = '', ...rest] = line.split(/\s+/);
    const args = rest.join(' ');
    switch (command.toLowerCase()) {
      case '':
        break;
      case 'version':
        this.emit(`${BANNERS[this.version] ?? BANNERS['2026.6']}\r\n`);
        break;
      case 'batch':
        if (args.startsWith('start')) {
          this.batchActive = true;
          this.batchError = false;
          this.emit('Command batch started\r\n');
        } else {
          if (this.batchActive && this.batchError) this.emit('###ERROR IN batch: ERRORS WERE DETECTED - PLEASE REVIEW BEFORE CONTINUING###\r\n');
          else this.emit('Command batch ended\r\n');
          this.batchActive = false;
          this.batchError = false;
        }
        break;
      case 'profile':
      case 'rateprofile': {
        const index = Number(args);
        if (!Number.isInteger(index) || index < 0 || index > 3) this.error(command, 'PROFILE OUTSIDE OF [0..3]');
        else if (command === 'profile') this.profile = index;
        else this.rateProfile = index;
        this.emit(`${command} ${command === 'profile' ? this.profile : this.rateProfile}\r\n`);
        break;
      }
      case 'set': {
        const m = args.match(/^(\w+)\s*=\s*(.+)$/);
        const def = m ? this.schema.params[m[1] ?? ''] : undefined;
        if (!m || !def) {
          this.error('set', `INVALID NAME: ${args}`);
          break;
        }
        const name = m[1] ?? '';
        const value = (m[2] ?? '').trim();
        const problem = validateParam(def, name, def.kind === 'range' ? Number(value) : value);
        if (problem) {
          this.error('set', 'INVALID VALUE');
          if (def.kind === 'range') this.emit(`Allowed range: ${def.min} - ${def.max}\r\n`);
          break;
        }
        this.section(def.scope)[name] = value;
        this.emit(`${name} set to ${value}\r\n`);
        break;
      }
      case 'get': {
        const def = this.schema.params[args];
        if (!def) this.error('get', `INVALID NAME: ${args}`);
        else this.emit(`${args} = ${this.section(def.scope)[args] ?? '(default)'}\r\n`);
        break;
      }
      case 'save':
        if (this.batchActive && this.batchError) {
          this.error('save', 'ERRORS WERE DETECTED - PLEASE REVIEW BEFORE CONTINUING');
          this.error('save', "PLEASE FIX ERRORS THEN 'SAVE'");
          this.batchActive = false;
          this.batchError = false;
          break;
        }
        this.saved = structuredClone(this.ram);
        this.emit('\r\n# saving\r\n\r\nRebooting');
        this.reboot();
        return;
      case 'exit':
        this.emit('\r\nRebooting');
        this.reboot();
        return;
      default:
        this.error(command, "UNKNOWN COMMAND, TRY 'HELP'");
    }
    this.emit('\r\n# ');
  }

  private section(scope: 'master' | 'profile' | 'rateprofile'): Record<string, string> {
    if (scope === 'profile') return (this.ram.profiles[this.profile] ??= {});
    if (scope === 'rateprofile') return (this.ram.rateProfiles[this.rateProfile] ??= {});
    return this.ram.master;
  }
}
