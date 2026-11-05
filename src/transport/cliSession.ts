// Drives a firmware's text CLI over any SerialTransport: enter CLI mode, run commands one at a
// time (waiting for the prompt after each), detect errors, check the firmware version, save.
import type { CliDialect, FirmwareAdapter } from '../firmware/types';
import type { CommandResult, PushReport, SerialTransport } from './types';

export interface CliSessionOptions {
  /** Max time for one command's output to end with the prompt. */
  commandTimeoutMs?: number;
  /**
   * Quiet time after the prompt before a command counts as finished. Output lines such as
   * "# Betaflight / …" also start with "# ", and a USB packet can end right after that "# ".
   */
  settleMs?: number;
}

export class CliTimeoutError extends Error {}

export class CliSession {
  private buffer = '';
  private waiter?: { resolve: (text: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
  private settle?: ReturnType<typeof setTimeout>;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeClose: () => void;

  constructor(
    private readonly transport: SerialTransport,
    private readonly dialect: CliDialect,
    private readonly options: CliSessionOptions = {},
  ) {
    this.unsubscribe = transport.onData((text) => {
      this.buffer += text;
      clearTimeout(this.settle);
      if (this.waiter && this.dialect.prompt.test(this.buffer)) {
        this.settle = setTimeout(() => {
          if (!this.waiter) return;
          const { resolve, timer } = this.waiter;
          this.waiter = undefined;
          clearTimeout(timer);
          resolve(this.buffer);
        }, this.options.settleMs ?? 30);
      }
    });
    this.unsubscribeClose = transport.onClose(() => {
      if (this.waiter) {
        const { reject, timer } = this.waiter;
        this.waiter = undefined;
        clearTimeout(timer);
        reject(new Error('The flight controller disconnected.'));
      }
    });
  }

  dispose(): void {
    clearTimeout(this.settle);
    this.unsubscribe();
    this.unsubscribeClose();
  }

  /** Writes `text` and resolves with everything received until the CLI prompt returns. */
  private async exchange(text: string, timeoutMs = this.options.commandTimeoutMs ?? 3000): Promise<string> {
    if (this.waiter) throw new Error('Another command is still running.');
    this.buffer = '';
    const done = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        reject(new CliTimeoutError(`No CLI prompt after "${text.trim() || 'enter'}" within ${timeoutMs} ms.`));
      }, timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
    await this.transport.write(text);
    return done;
  }

  /** Switches the flight controller from MSP to CLI mode. */
  async enter(): Promise<string> {
    return this.exchange(this.dialect.enter);
  }

  async send(command: string): Promise<CommandResult> {
    const raw = await this.exchange(command + this.dialect.lineEnding);
    return parseCommandOutput(command, raw, this.dialect);
  }

  /**
   * Writes the save command. Betaflight stores the configuration and reboots, so success is the
   * "saving" confirmation or the port closing; an error line means the batch refused to save.
   */
  async save(timeoutMs = 6000): Promise<CommandResult> {
    const command = this.dialect.saveCommand;
    this.buffer = '';
    const outcome = new Promise<string>((resolve) => {
      const finish = () => {
        clearInterval(poll);
        clearTimeout(timer);
        offClose();
        resolve(this.buffer);
      };
      const offClose = this.transport.onClose(finish);
      const timer = setTimeout(finish, timeoutMs);
      const poll = setInterval(() => {
        if (this.dialect.error.test(this.buffer) && this.dialect.prompt.test(this.buffer)) finish();
      }, 20);
    });
    await this.transport.write(command + this.dialect.lineEnding);
    return parseCommandOutput(command, await outcome, this.dialect);
  }
}

export function parseCommandOutput(command: string, raw: string, dialect: CliDialect): CommandResult {
  const lines = raw
    .replace(dialect.prompt, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\r/g, ''));
  // The CLI echoes what was typed: drop the echoed command line.
  const echoIndex = lines.findIndex((l) => l.trim() === command.trim());
  const output = lines
    .filter((_, i) => i !== echoIndex)
    .join('\n')
    .trim();
  const error = raw.match(dialect.error)?.[0];
  return error ? { command, output, error } : { command, output };
}

export interface PushOptions {
  /** Version id the script was compiled for; the push stops if the firmware reports another. */
  expectedVersion?: string;
  onProgress?: (done: number, total: number, last?: CommandResult) => void;
  session?: CliSessionOptions;
}

/**
 * Runs a compiled CLI script: checks the firmware version, sends every command, and saves only if
 * nothing failed. On any error it leaves without saving (Betaflight `exit` reboots and drops the
 * unsaved changes), so a failed push never leaves a half-applied tune behind.
 */
export async function pushScript(transport: SerialTransport, adapter: FirmwareAdapter, commands: readonly string[], options: PushOptions = {}): Promise<PushReport> {
  const dialect = adapter.cli;
  if (!dialect) return { ok: false, results: [], saved: false, message: `${adapter.name} does not support direct connection yet.` };
  const session = new CliSession(transport, dialect, options.session);
  const results: CommandResult[] = [];
  const body = commands.filter((c) => c !== dialect.saveCommand);
  const wantsSave = commands.includes(dialect.saveCommand);
  const total = body.length + (wantsSave ? 1 : 0);
  const abort = async (message: string, banner?: string): Promise<PushReport> => {
    try {
      await transport.write(dialect.exitCommand + dialect.lineEnding);
    } catch {
      // Port already closed.
    }
    session.dispose();
    return { ok: false, banner, results, saved: false, message };
  };

  try {
    await session.enter();
    const version = await session.send(dialect.versionCommand);
    const banner = version.output.split('\n').find((l) => l.startsWith('#')) ?? version.output;
    const detected = adapter.detectVersion?.(banner);
    if (options.expectedVersion && detected !== options.expectedVersion) {
      return abort(detected ? `The flight controller runs ${adapter.name} ${detected}, but the script was built for ${options.expectedVersion}. Select ${detected} and generate again.` : `Could not recognise the firmware (${banner || 'no banner'}). Nothing was changed.`, banner);
    }
    for (const command of body) {
      const result = await session.send(command);
      results.push(result);
      options.onProgress?.(results.length, total, result);
      if (result.error) return abort(`"${command}" failed: ${result.error}. Nothing was saved; the flight controller rebooted with its previous settings.`, banner);
    }
    if (!wantsSave) {
      session.dispose();
      return { ok: true, banner, results, saved: false, message: 'All commands accepted. Not saved: type "save" in the CLI to keep them.' };
    }
    const saved = await session.save();
    results.push(saved);
    options.onProgress?.(total, total, saved);
    session.dispose();
    if (saved.error) return { ok: false, banner, results, saved: false, message: `Save refused: ${saved.error}` };
    return { ok: true, banner, results, saved: true, message: 'Saved. The flight controller is rebooting with the new tune.' };
  } catch (e) {
    session.dispose();
    return { ok: false, results, saved: false, message: e instanceof Error ? e.message : String(e) };
  }
}
