// Web Serial transport (Chrome, Edge, Opera on desktop; Android Chrome supports it over USB OTG).
// Flight controllers enumerate as USB CDC virtual COM ports, so Web Serial is the right API for
// the CLI; WebUSB is only needed for DFU flashing, which this app does not do.
import type { SerialTransport } from './types';

// Minimal Web Serial typings (lib.dom does not ship them yet).
interface WebSerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  addEventListener(type: 'disconnect', listener: () => void): void;
}
interface WebSerial {
  requestPort(options?: { filters?: { usbVendorId?: number; usbProductId?: number }[] }): Promise<WebSerialPort>;
}

/** USB vendor ids of flight-controller virtual COM ports and common USB-UART bridges. */
export const FLIGHT_CONTROLLER_USB_FILTERS = [
  { usbVendorId: 0x0483 }, // STMicroelectronics (STM32 VCP)
  { usbVendorId: 0x2e3c }, // Artery (AT32F435 VCP)
  { usbVendorId: 0x10c4 }, // Silicon Labs CP210x
  { usbVendorId: 0x0403 }, // FTDI
  { usbVendorId: 0x1a86 }, // QinHeng CH340
];

const serial = (): WebSerial | undefined => (typeof navigator !== 'undefined' && 'serial' in navigator ? (navigator as unknown as { serial: WebSerial }).serial : undefined);

export const isWebSerialSupported = (): boolean => serial() !== undefined;

/** Must be called from a user gesture (click): the browser shows its port picker. */
export async function requestWebSerialTransport(options: { allPorts?: boolean; baudRate?: number } = {}): Promise<SerialTransport> {
  const api = serial();
  if (!api) throw new Error('Web Serial is not available in this browser. Use Chrome or Edge on desktop, or copy the CLI text instead.');
  const port = await api.requestPort(options.allPorts ? {} : { filters: FLIGHT_CONTROLLER_USB_FILTERS });
  return new WebSerialTransport(port, options.baudRate ?? 115200);
}

class WebSerialTransport implements SerialTransport {
  private reader?: ReadableStreamDefaultReader<string>;
  private pipeClosed?: Promise<void>;
  private readLoop?: Promise<void>;
  private dataHandlers = new Set<(text: string) => void>();
  private closeHandlers = new Set<() => void>();
  private open_ = false;

  constructor(
    private readonly port: WebSerialPort,
    private readonly baudRate: number,
  ) {
    port.addEventListener('disconnect', () => this.handleClosed());
  }

  get label(): string {
    const info = this.port.getInfo();
    const hex = (n?: number) => (n === undefined ? '????' : n.toString(16).padStart(4, '0'));
    return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}`;
  }

  get isOpen(): boolean {
    return this.open_;
  }

  async open(): Promise<void> {
    await this.port.open({ baudRate: this.baudRate });
    this.open_ = true;
    const readable = this.port.readable;
    if (!readable) throw new Error('Serial port is not readable');
    // pipeTo + an explicit promise (the Web Serial explainer's pattern): after reader.cancel() the
    // pipe settles and unlocks port.readable, which port.close() requires.
    const decoder = new TextDecoderStream();
    this.pipeClosed = readable.pipeTo(decoder.writable as unknown as WritableStream<Uint8Array>).catch(() => undefined);
    this.reader = decoder.readable.getReader();
    this.readLoop = this.pump();
  }

  private async pump(): Promise<void> {
    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) for (const handler of this.dataHandlers) handler(value);
      }
    } catch {
      // The port vanished (reboot after save, cable pulled).
    } finally {
      this.handleClosed();
    }
  }

  async write(text: string): Promise<void> {
    const writable = this.port.writable;
    if (!writable) throw new Error('Serial port is not writable');
    const writer = writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(text));
    } finally {
      writer.releaseLock();
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
    const reader = this.reader;
    this.reader = undefined;
    try {
      await reader?.cancel();
      await this.pipeClosed;
      await this.readLoop;
      await this.port.close();
    } catch {
      // Already gone.
    }
    this.handleClosed();
  }

  private handleClosed() {
    if (!this.open_) return;
    this.open_ = false;
    for (const handler of this.closeHandlers) handler();
  }
}
