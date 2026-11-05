// A text byte stream to a flight controller. Implementations: Web Serial (browser), the simulated
// flight controller (tests and demo), and, outside this web app, Node `serialport`, a Tauri/Electron
// serial plugin or tools/push_cli.py (pyserial).
export interface SerialTransport {
  readonly label: string;
  readonly isOpen: boolean;
  open(): Promise<void>;
  write(text: string): Promise<void>;
  /** Called with every chunk of received text; returns an unsubscribe function. */
  onData(handler: (text: string) => void): () => void;
  /** Called when the port goes away (the flight controller reboots after `save`). */
  onClose(handler: () => void): () => void;
  close(): Promise<void>;
}

export interface CommandResult {
  command: string;
  /** Firmware output for the command, without the echo and the prompt. */
  output: string;
  /** Error text when the firmware reported one. */
  error?: string;
}

export interface PushReport {
  ok: boolean;
  /** Firmware version banner read before writing. */
  banner?: string;
  results: CommandResult[];
  saved: boolean;
  message: string;
}
