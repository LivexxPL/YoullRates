// Step 2: how do you fly, and what should be generated?
import { FLIGHT_STYLES, type FlightStyle, type TuneScope } from '../../core/types';
import { ChoiceCards, Chips, Notice } from '../components/controls';
import { StyleArt } from '../components/Icons';
import type { StepProps } from './types';

const STYLE_TEXT: Record<FlightStyle, { label: string; tag: string; description: string }> = {
  freestyle: { label: 'Freestyle', tag: 'Flips, rolls, dives', description: 'High max rate for snappy flips, soft center for clean lines, balanced P/D.' },
  cinematic: { label: 'Cinematic', tag: 'Smooth footage', description: 'Low center sensitivity, low expo, heavy feedforward smoothing: buttery, high-resolution stick feel.' },
  racing: { label: 'Racing', tag: 'Gates and lap times', description: 'Near-linear, predictable rates; strong feedforward and I-term for fast, exact tracking.' },
};

const SCOPES: { value: TuneScope; label: string; hint: string }[] = [
  { value: 'rates', label: 'Rates only', hint: 'Degrees per second and expo. PIDs and filters stay as they are.' },
  { value: 'rates+pids', label: 'Rates + matched PIDs', hint: 'PIDs, feedforward and I-term relax tailored to your rates and style.' },
  { value: 'full', label: 'Full tune', hint: 'Also gyro/D-term filters, RPM filter and dynamic idle for your build.' },
];

export function StyleStep({ state, dispatch, adapter }: StepProps) {
  const pidsAvailable = adapter.capabilities.pids;
  const scope = pidsAvailable ? state.scope : 'rates';
  return (
    <section className="panel" aria-labelledby="style-title">
      <h2 id="style-title" tabIndex={-1}>How do you fly?</h2>
      <p className="lede">The style picks the rate curve and the character of the PID tune.</p>
      <ChoiceCards
        label="Flight style"
        value={state.style}
        onChange={(style) => dispatch({ type: 'style', style })}
        options={FLIGHT_STYLES.map((s) => ({ value: s, label: STYLE_TEXT[s].label, tag: STYLE_TEXT[s].tag, description: STYLE_TEXT[s].description, art: <StyleArt style={s} /> }))}
      />
      <div className="field">
        <span className="field-label">What should we generate?</span>
        <Chips label="Output scope" value={scope} onChange={(value) => dispatch({ type: 'scope', scope: value })} options={SCOPES.map((s) => ({ value: s.value, label: s.label, disabled: !pidsAvailable && s.value !== 'rates' }))} />
        <p className="hint">{SCOPES.find((s) => s.value === scope)?.hint}</p>
        {!pidsAvailable && <Notice kind="info">{adapter.name} support covers rates only for now.</Notice>}
      </div>
    </section>
  );
}
