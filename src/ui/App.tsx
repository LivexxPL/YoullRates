// App shell: top bar, stepper, current step and the live preview column.
import { useEffect, useRef } from 'react';
import { CRAFT_CLASSES_INFO } from '../core/craft/classes';
import { FIRMWARE_ADAPTERS } from '../firmware/registry';
import type { FirmwareId } from '../firmware/types';
import { Logo } from './components/Icons';
import { LivePreview } from './panels/LivePreview';
import { useTuneState } from './state/useTuneState';
import { CraftStep } from './wizard/CraftStep';
import { ExportStep } from './wizard/ExportStep';
import { FeelStep } from './wizard/FeelStep';
import { StyleStep } from './wizard/StyleStep';

const STYLE_LABEL = { freestyle: 'Freestyle', cinematic: 'Cinematic', racing: 'Racing' } as const;
const SCOPE_LABEL = { rates: 'Rates only', 'rates+pids': 'Rates + PIDs', full: 'Full tune' } as const;

export function App() {
  const store = useTuneState();
  const { state, dispatch, adapter, tune, config } = store;
  const headingRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // Move focus to the new step's heading for keyboard and screen-reader users (not on page load).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, [state.step]);

  const craftInfo = CRAFT_CLASSES_INFO[state.craft.classId];
  const steps = [
    { title: 'Craft', detail: `${craftInfo.label}, ${state.craft.weightGrams} g` },
    { title: 'Style', detail: `${STYLE_LABEL[state.style]} · ${SCOPE_LABEL[adapter.capabilities.pids ? state.scope : 'rates']}` },
    { title: 'Feel', detail: `${Math.round(tune.rates.roll.max)}°/s` },
    { title: 'Export', detail: `${adapter.name} ${state.version}` },
  ];
  const stepProps = { ...store };
  const go = (step: number) => {
    dispatch({ type: 'step', step });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>
            TuneForge <small>FPV</small>
          </span>
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-controls">
          <label className="toggle">
            <span className="sr-only">Firmware</span>
            <select className="select" value={state.firmware} onChange={(e) => dispatch({ type: 'firmware', firmware: e.target.value as FirmwareId })} aria-label="Firmware">
              {FIRMWARE_ADAPTERS.map((a) => (
                <option key={a.id} value={a.id} disabled={a.support === 'planned'}>
                  {a.name}
                  {a.support === 'experimental' ? ' (experimental)' : a.support === 'planned' ? ' (planned)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={state.expert} onChange={(e) => dispatch({ type: 'expert', expert: e.target.checked })} />
            Expert mode
          </label>
          <button type="button" className="btn small" onClick={() => dispatch({ type: 'reset' })}>
            Start over
          </button>
        </div>
      </header>

      <div className="layout">
        <main className="main-column">
          <nav aria-label="Wizard steps">
            <ol className="stepper">
              {steps.map((s, i) => (
                <li key={s.title}>
                  <button type="button" onClick={() => go(i)} aria-current={state.step === i ? 'step' : undefined} className={i < state.step ? 'done' : undefined}>
                    <span className="num">{i < state.step ? '✓' : i + 1}</span>
                    <span className="label">
                      <strong>{s.title}</strong>
                      <span>{s.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <div ref={headingRef} className="main-column" key={state.step}>
            {state.step === 0 && <CraftStep {...stepProps} />}
            {state.step === 1 && <StyleStep {...stepProps} />}
            {state.step === 2 && <FeelStep {...stepProps} />}
            {state.step === 3 && <ExportStep {...stepProps} />}
          </div>

          <div className="nav-buttons">
            <button type="button" className="btn" onClick={() => go(state.step - 1)} disabled={state.step === 0}>
              ← Back
            </button>
            {state.step < 3 ? (
              <button type="button" className="btn primary" onClick={() => go(state.step + 1)}>
                {state.step === 2 ? 'Get my tune →' : 'Next →'}
              </button>
            ) : (
              <span />
            )}
          </div>
        </main>

        <div className="side-column">
          <div className="side-sticky">
            <LivePreview tune={tune} config={config} adapter={adapter} />
          </div>
        </div>
      </div>

      <footer className="footer">
        TuneForge FPV generates starting points from your answers: fly a short test hover, check motor temperature, then refine. Not affiliated with the Betaflight or INAV projects.
      </footer>
    </>
  );
}
