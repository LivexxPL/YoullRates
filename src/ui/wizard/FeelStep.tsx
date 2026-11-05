// Step 3: the feel. Rate simulator and rate sliders always; tune sliders when PIDs are generated.
import { lazy, Suspense, useMemo, useState } from 'react';
import { AXES, type Axis, type FlightStyle, type RateCurve } from '../../core/types';
import { deadbandsFor, flownRates } from '../../firmware/flownRates';
import { IntentSlider, Notice, NumberInput } from '../components/controls';
import { HeatMeter } from '../panels/LivePreview';
import type { StepProps } from './types';

// Three.js is only downloaded when the simulator is opened.
const SimulatorPanel = lazy(() => import('../sim/SimulatorPanel'));

const SIM_OPEN_KEY = 'tuneforge:sim-open';
/** Typical FPV camera uptilt for each style, degrees. */
const UPTILT: Record<FlightStyle, number> = { freestyle: 30, cinematic: 20, racing: 40 };

function RateSimulator({ state, tune, config }: StepProps) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(SIM_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(SIM_OPEN_KEY, next ? '1' : '0');
    } catch {
      // Not remembered.
    }
  };
  // The exact rates the script writes (after expert edits), and the stick deadbands.
  const rates = useMemo(() => flownRates(tune, config), [tune, config]);
  const deadbands = useMemo(() => deadbandsFor(config, state.imported), [config, state.imported]);
  return (
    <div className="sim-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0 }}>Feel them before you fly</h3>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            A 3D quad that rotates exactly as Betaflight would command it with these rates. Plug in your radio (USB joystick mode), or use the on-screen sticks.
          </p>
        </div>
        <button type="button" className={`btn ${open ? '' : 'primary'}`} onClick={() => toggle(!open)} aria-expanded={open}>
          {open ? 'Close simulator' : 'Open rate simulator'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <Suspense fallback={<p className="hint">Loading the 3D view…</p>}>
            <SimulatorPanel rates={rates} deadbands={deadbands} ducted={state.craft.frame === 'ducted'} defaultUptilt={UPTILT[state.style]} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

function RateEditor({ state, dispatch, tune }: StepProps) {
  const rates = tune.rates;
  const edit = (axis: Axis, patch: Partial<RateCurve>) => {
    const next = { ...rates, [axis]: { ...rates[axis], ...patch } };
    // Roll and pitch move together unless the pilot edits pitch itself.
    if (axis === 'roll' && !state.customRates) next.pitch = { ...next.roll };
    dispatch({ type: 'customRates', rates: next });
  };
  return (
    <div className="field">
      <span className="field-label">Per-axis rates (Actual: center sensitivity, max rate, expo)</span>
      <div className="table-scroll" style={{ maxHeight: 'none' }}>
        <table className="param-table">
          <thead>
            <tr>
              <th scope="col">Axis</th>
              <th scope="col">Center °/s</th>
              <th scope="col">Max °/s</th>
              <th scope="col">Expo</th>
            </tr>
          </thead>
          <tbody>
            {AXES.map((axis) => (
              <tr key={axis}>
                <td style={{ textTransform: 'capitalize' }}>{axis}</td>
                <td>
                  <NumberInput value={Math.round(rates[axis].center)} unit="°/s" min={10} max={1800} step={10} onChange={(v) => v !== undefined && edit(axis, { center: Math.max(10, v) })} />
                </td>
                <td>
                  <NumberInput value={Math.round(rates[axis].max)} unit="°/s" min={100} max={1990} step={10} onChange={(v) => v !== undefined && edit(axis, { max: Math.min(1990, Math.max(100, v)) })} />
                </td>
                <td>
                  <NumberInput value={Math.round(rates[axis].expo * 100) / 100} unit="" min={0} max={1} step={0.01} onChange={(v) => v !== undefined && edit(axis, { expo: Math.min(1, Math.max(0, v)) })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.customRates && (
        <div className="row" style={{ marginTop: 10 }}>
          <Notice kind="info">Using your own rates. PIDs, D boost and I-term relax are matched to them.</Notice>
          <button type="button" className="btn small" onClick={() => dispatch({ type: 'customRates', rates: undefined })}>
            Back to style rates
          </button>
        </div>
      )}
    </div>
  );
}

export function FeelStep(props: StepProps) {
  const { state, dispatch, tune } = props;
  const roll = tune.rates.roll;
  const pids = state.scope !== 'rates' && props.adapter.capabilities.pids;
  return (
    <section className="panel" aria-labelledby="feel-title">
      <h2 id="feel-title" tabIndex={-1}>Dial in the feel</h2>
      <p className="lede">Move the sliders and watch the curve and gains update. Double-click a slider to center it.</p>

      <RateSimulator {...props} />

      <h3 style={{ marginTop: 24 }}>Stick feel (rates)</h3>
      <IntentSlider label="Rotation speed" left="Calm" right="Fast flips" value={state.rateFeel.speed} onChange={(value) => dispatch({ type: 'rateFeel', key: 'speed', value })} readout={`${Math.round(roll.max)}°/s max`} />
      <IntentSlider label="Center stick" left="Gentle" right="Direct" value={state.rateFeel.center} onChange={(value) => dispatch({ type: 'rateFeel', key: 'center', value })} readout={`${Math.round(roll.center)}°/s center`} />
      <IntentSlider label="Curve" left="Linear" right="Strong expo" value={state.rateFeel.curve} onChange={(value) => dispatch({ type: 'rateFeel', key: 'curve', value })} readout={`expo ${roll.expo.toFixed(2)}`} />
      {state.expert && <RateEditor {...props} />}

      {pids && (
        <>
          <h3 style={{ marginTop: 28 }}>Tune feel (PIDs)</h3>
          <IntentSlider label="Response" left="Smooth" right="Snappy" value={state.sliders.response} onChange={(value) => dispatch({ type: 'slider', key: 'response', value })} />
          <IntentSlider label="Hold" left="Floaty" right="Locked-in" value={state.sliders.lock} onChange={(value) => dispatch({ type: 'slider', key: 'lock', value })} />
          <IntentSlider label="Propwash handling vs. motor heat" left="Cool, safe motors" right="Max propwash handling" value={state.sliders.propwash} onChange={(value) => dispatch({ type: 'slider', key: 'propwash', value })} />
          {tune.filters ? <HeatMeter risk={tune.filters.heatRisk} /> : <p className="hint">Generate the full tune to see the motor heat estimate (it depends on the filters).</p>}
        </>
      )}
    </section>
  );
}
