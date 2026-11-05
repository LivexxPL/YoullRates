// Paste a `diff all` to compare against the current setup, reuse its rates and hardware details.
import { useState } from 'react';
import { toCanonical } from '../../core/rates/fit';
import { evaluateRate, RATE_MODELS } from '../../core/rates/models';
import { AXES, type RateSet } from '../../core/types';
import type { FirmwareAdapter, ParsedDump } from '../../firmware/types';
import type { Action, AppState } from '../state/useTuneState';
import { Notice } from '../components/controls';

export function ImportPanel({ adapter, state, dispatch }: { adapter: FirmwareAdapter; state: AppState; dispatch: (a: Action) => void }) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string }>();
  const dump = state.imported;
  if (!adapter.parseDump) return <p className="hint">{adapter.name} import is not available yet.</p>;

  const read = () => {
    const parsed = adapter.parseDump!(text);
    const settings = Object.keys(parsed.master).length + Object.values(parsed.profiles).reduce((n, p) => n + Object.keys(p).length, 0) + Object.values(parsed.rateProfiles).reduce((n, p) => n + Object.keys(p).length, 0);
    if (!settings) {
      setMessage({ kind: 'error', text: 'No settings found. Paste the output of "diff all" from the CLI tab.' });
      return;
    }
    const banner = parsed.version ? `# ${parsed.firmware ?? 'Betaflight'} / X (X) ${parsed.version}` : '';
    const version = adapter.detectVersion?.(banner);
    dispatch({ type: 'import', dump: parsed, version });
    if (parsed.version && !version) setMessage({ kind: 'warn', text: `${parsed.firmware} ${parsed.version} is older than the versions TuneForge supports; values are shown for comparison only.` });
    else setMessage({ kind: 'ok', text: `Read ${settings} settings${parsed.version ? ` from ${parsed.firmware} ${parsed.version}` : ''}${version ? `; output switched to ${version}` : ''}.` });
  };

  const applyCurrentRates = (d: ParsedDump) => {
    const section = d.rateProfiles[d.activeRateProfile ?? 0] ?? {};
    const rates = {} as RateSet;
    for (const axis of AXES) {
      const r = adapter.ratesFromDump?.(section, axis);
      if (!r) return setMessage({ kind: 'error', text: 'Could not read the rates from this dump.' });
      rates[axis] = toCanonical((x) => evaluateRate(RATE_MODELS[r.model], r.raw, x));
    }
    dispatch({ type: 'customRates', rates });
    setMessage({ kind: 'ok', text: 'Your current rates are now the starting point; PIDs are matched to them.' });
  };

  const applyHardware = (d: ParsedDump) => {
    const poles = Number(d.master.motor_poles);
    const bidir = d.master.dshot_bidir;
    dispatch({ type: 'craft', patch: { ...(Number.isFinite(poles) && poles > 0 ? { motorPoles: poles } : {}), ...(bidir ? { rpmFilter: bidir.toUpperCase() === 'ON' } : {}) } });
    dispatch({ type: 'output', patch: { profileIndex: d.activeProfile ?? 0, rateProfileIndex: d.activeRateProfile ?? 0 } });
    setMessage({ kind: 'ok', text: 'Motor poles, bidirectional DShot and the active profiles were taken from your setup.' });
  };

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        In the CLI tab type <code>diff all</code>, copy the output and paste it here. Nothing leaves your browser.
      </p>
      <textarea className="dump" value={text} onChange={(e) => setText(e.target.value)} placeholder={'# diff all\n# version\n# Betaflight / STM32F7X2 (S7X2) 4.5.1 …'} aria-label="diff all output" />
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn" onClick={read} disabled={!text.trim()}>
          Read my setup
        </button>
        {dump && (
          <>
            <button type="button" className="btn" onClick={() => applyCurrentRates(dump)}>
              Start from my current rates
            </button>
            <button type="button" className="btn" onClick={() => applyHardware(dump)}>
              Use my motor & profile details
            </button>
            <button type="button" className="btn small" onClick={() => dispatch({ type: 'import', dump: undefined })}>
              Forget
            </button>
          </>
        )}
      </div>
      {message && (
        <div style={{ marginTop: 10 }}>
          <Notice kind={message.kind}>{message.text}</Notice>
        </div>
      )}
      {dump && <p className="hint">Expert mode now shows a “Current” column next to every generated value.</p>}
    </div>
  );
}
