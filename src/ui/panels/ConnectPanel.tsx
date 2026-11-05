// Direct write over USB (Web Serial), or a dry run against the simulated flight controller.
import { useState } from 'react';
import { cliCommands } from '../../firmware/betaflight/cli';
import type { FirmwareAdapter } from '../../firmware/types';
import { pushScript } from '../../transport/cliSession';
import { SimulatedFlightController } from '../../transport/simulatedFc';
import type { PushReport, SerialTransport } from '../../transport/types';
import { isWebSerialSupported, requestWebSerialTransport } from '../../transport/webSerial';
import { Notice } from '../components/controls';

export function ConnectPanel({ adapter, script, version, blocked }: { adapter: FirmwareAdapter; script: string; version: string; blocked: boolean }) {
  const [propsOff, setPropsOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<PushReport>();
  const webSerial = isWebSerialSupported();

  if (!adapter.capabilities.directConnect || !adapter.cli) {
    return <p className="hint">Direct connection is not available for {adapter.name} yet; copy the script into its CLI.</p>;
  }

  const run = async (makeTransport: () => Promise<SerialTransport>) => {
    setBusy(true);
    setReport(undefined);
    setLog([]);
    setProgress(0);
    let transport: SerialTransport | undefined;
    try {
      transport = await makeTransport();
      await transport.open();
      setLog([`Connected: ${transport.label}`]);
      const result = await pushScript(transport, adapter, cliCommands(script), {
        expectedVersion: version,
        onProgress: (done, total, last) => {
          setProgress(done / total);
          if (last) setLog((l) => [...l.slice(-200), `${last.error ? '✗' : '✓'} ${last.command}${last.error ? `  ${last.error}` : ''}`]);
        },
      });
      setReport(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Closing the browser's port picker is not an error worth shouting about.
      setReport({ ok: false, results: [], saved: false, message: /No port selected|cancel/i.test(message) ? 'No port selected.' : message });
    } finally {
      if (transport?.isOpen) await transport.close().catch(() => undefined);
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Writes the script line by line, checks the firmware version first and stops without saving at the first error. Close the Betaflight App first (only one program can open the port).
      </p>
      <label className="toggle">
        <input type="checkbox" checked={propsOff} onChange={(e) => setPropsOff(e.target.checked)} />
        Props are off
      </label>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={!webSerial || !propsOff || busy || blocked} onClick={() => run(() => requestWebSerialTransport())}>
          Connect & write over USB
        </button>
        <button type="button" className="btn" disabled={busy || blocked} onClick={() => run(async () => new SimulatedFlightController(version))}>
          Try on a simulated flight controller
        </button>
      </div>
      {!webSerial && <p className="hint">This browser has no Web Serial: use Chrome or Edge on a computer, or copy the script, or run tools/push_cli.py.</p>}
      {blocked && <Notice kind="error">Fix the errors listed in the preview before writing.</Notice>}
      {(busy || log.length > 0) && (
        <>
          <div className="progress" aria-label="Write progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <pre className="log" aria-live="polite">
            {log.join('\n')}
          </pre>
        </>
      )}
      {report && (
        <div style={{ marginTop: 10 }}>
          <Notice kind={report.ok ? 'ok' : 'error'}>{report.message}</Notice>
        </div>
      )}
    </div>
  );
}
