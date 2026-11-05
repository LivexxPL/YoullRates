// Step 4: output options, the CLI script, explanations, import/compare and direct write.
import { RATE_MODELS } from '../../core/rates/models';
import type { Reason } from '../../core/types';
import { Chips, Notice } from '../components/controls';
import { CliBlock } from '../panels/CliBlock';
import { ConnectPanel } from '../panels/ConnectPanel';
import { ExpertTable } from '../panels/ExpertTable';
import { ImportPanel } from '../panels/ImportPanel';
import type { StepProps } from './types';

function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="reasons">
      {reasons.map((r, i) => (
        <li key={i}>
          <span className="topic">{r.topic}</span>
          <span>
            {r.text}
            {r.factor !== undefined && Math.abs(r.factor - 1) > 0.005 && <span className="hint tabular"> (×{r.factor.toFixed(2)})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ExportStep(props: StepProps) {
  const { state, dispatch, adapter, tune, config, script } = props;
  const counts = adapter.profileCounts ?? { pid: 1, rate: 1 };
  const errors = config?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = config?.issues.filter((i) => i.severity === 'warning') ?? [];
  const fileName = `tuneforge-${state.style}-${adapter.id}-${state.version}.txt`.replace(/[^a-z0-9.+-]/gi, '_');

  return (
    <>
      <section className="panel" aria-labelledby="export-title">
        <h2 id="export-title" tabIndex={-1}>Your tune</h2>
        <p className="lede">Choose where it goes, then copy it into the CLI or write it directly.</p>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="fw-version">Firmware version</label>
            <select id="fw-version" className="select" value={state.version} onChange={(e) => dispatch({ type: 'output', patch: { version: e.target.value } })}>
              {adapter.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <p className="hint">{adapter.versions.find((v) => v.id === state.version)?.note ?? 'Check with the CLI command "version".'}</p>
          </div>
          <div className="field">
            <span className="field-label">Profiles to write</span>
            <div className="row">
              {tune.pids && (
                <label className="toggle">
                  PID
                  <select className="select" value={state.profileIndex} onChange={(e) => dispatch({ type: 'output', patch: { profileIndex: Number(e.target.value) } })}>
                    {Array.from({ length: counts.pid }, (_, i) => (
                      <option key={i} value={i}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="toggle">
                Rates
                <select className="select" value={state.rateProfileIndex} onChange={(e) => dispatch({ type: 'output', patch: { rateProfileIndex: Number(e.target.value) } })}>
                  {Array.from({ length: counts.rate }, (_, i) => (
                    <option key={i} value={i}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hint">The selected profiles become active after saving.</p>
          </div>
          {adapter.rateModels.length > 1 && (
            <div className="field">
              <span className="field-label">Rates type</span>
              <Chips label="Rates type" value={state.ratesType} onChange={(ratesType) => dispatch({ type: 'output', patch: { ratesType } })} options={adapter.rateModels.map((m) => ({ value: m, label: m === 'ACTUAL' ? 'Actual (recommended)' : RATE_MODELS[m].label }))} />
              {config?.rateFit.roll && state.ratesType !== 'ACTUAL' && <p className="hint">Closest {RATE_MODELS[state.ratesType].label} curve: within {Math.round(config.rateFit.roll.maxError)}°/s of the design.</p>}
            </div>
          )}
          {tune.pids && adapter.id === 'betaflight' && (
            <div className="field">
              <span className="field-label">PID format</span>
              <Chips
                label="PID format"
                value={state.pidMode}
                onChange={(pidMode) => dispatch({ type: 'output', patch: { pidMode } })}
                options={[
                  { value: 'sliders', label: 'Betaflight sliders' },
                  { value: 'raw', label: 'Raw gains' },
                ]}
              />
              <p className="hint">{state.pidMode === 'sliders' ? 'Writes slider positions plus the exact gains they produce, so the sliders stay usable for fine tuning.' : 'Writes the exact gains and switches the sliders off.'}</p>
            </div>
          )}
        </div>
        {errors.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {errors.map((e) => (
              <Notice key={e.name + e.message} kind="error">
                {e.message}
              </Notice>
            ))}
          </div>
        )}
        {(warnings.length > 0 || (config?.notes.length ?? 0) > 0) && (
          <div style={{ marginTop: 16 }}>
            {warnings.map((w) => (
              <Notice key={w.name} kind="warn">
                {w.message}
              </Notice>
            ))}
            {config?.notes.map((n) => (
              <Notice key={n} kind="info">
                {n}
              </Notice>
            ))}
          </div>
        )}
        <div style={{ marginTop: 20 }}>{script ? <CliBlock script={script} fileName={fileName} /> : <Notice kind="info">{adapter.name} has no exporter yet.</Notice>}</div>
      </section>

      <section className="panel">
        <details open>
          <summary>Why these numbers?</summary>
          <div style={{ marginTop: 12 }}>
            <Reasons reasons={tune.reasons} />
          </div>
        </details>
      </section>

      {state.expert && config && (
        <section className="panel" aria-label="Expert mode parameters">
          <ExpertTable config={config} adapter={adapter} overrides={state.overrides} imported={state.imported} onOverride={(name, value) => dispatch({ type: 'override', name, value })} />
        </section>
      )}

      <section className="panel">
        <details>
          <summary>Compare with your current setup (paste diff all)</summary>
          <div style={{ marginTop: 12 }}>
            <ImportPanel adapter={adapter} state={state} dispatch={dispatch} />
          </div>
        </details>
      </section>

      <section className="panel">
        <details>
          <summary>Write directly to the flight controller (USB)</summary>
          <div style={{ marginTop: 12 }}>
            <ConnectPanel adapter={adapter} script={script} version={state.version} blocked={errors.length > 0} />
          </div>
        </details>
      </section>
    </>
  );
}
