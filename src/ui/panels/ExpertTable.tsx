// Expert mode: every generated parameter, editable and validated against the firmware version.
import { useState } from 'react';
import { validateParam } from '../../firmware/betaflight/versions';
import type { CompiledConfig, FirmwareAdapter, ParamDef, ParamGroup, ParamValue, ParsedDump } from '../../firmware/types';

const GROUP_LABEL: Record<ParamGroup, string> = {
  meta: 'Names',
  rates: 'Rates',
  throttle: 'Throttle',
  pids: 'PID gains',
  feedforward: 'Feedforward',
  'pid-extras': 'I-term relax, anti-gravity, TPA',
  filters: 'Filters',
  motors: 'Motors',
  'rc-link': 'RC link',
};

function rangeText(def?: ParamDef): string {
  if (!def) return '';
  if (def.kind === 'range') return `${def.min} … ${def.max}`;
  if (def.kind === 'string') return `≤ ${def.maxLength} chars`;
  return '';
}

function ValueInput({ def, value, onChange, label }: { def?: ParamDef; value: ParamValue; onChange: (v: ParamValue) => void; label: string }) {
  if (def?.kind === 'lookup') {
    return (
      <select aria-label={label} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {def.values?.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    );
  }
  if (def?.kind === 'range') {
    return <input aria-label={label} type="number" value={String(value)} min={def.min} max={def.max} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
  }
  return <input aria-label={label} type="text" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
}

export function ExpertTable({ config, adapter, overrides, imported, onOverride }: { config: CompiledConfig; adapter: FirmwareAdapter; overrides: Record<string, ParamValue>; imported?: ParsedDump; onOverride: (name: string, value?: ParamValue) => void }) {
  const schema = adapter.paramSchema?.(config.version);
  const [newName, setNewName] = useState('');
  const current = (name: string, scope: string): string | undefined => {
    if (!imported) return undefined;
    if (scope === 'profile') return imported.profiles[config.profileIndex]?.[name];
    if (scope === 'rateprofile') return imported.rateProfiles[config.rateProfileIndex]?.[name];
    return imported.master[name];
  };
  const scopes: { scope: 'master' | 'profile' | 'rateprofile'; label: string }[] = [
    { scope: 'master', label: 'Global' },
    { scope: 'profile', label: `PID profile ${config.profileIndex + 1}` },
    { scope: 'rateprofile', label: `Rate profile ${config.rateProfileIndex + 1}` },
  ];
  const overriddenCount = Object.keys(overrides).length;

  return (
    <div>
      <div className="cli-toolbar">
        <strong className="grow">All parameters ({config.params.length})</strong>
        {overriddenCount > 0 && (
          <button type="button" className="btn small" onClick={() => Object.keys(overrides).forEach((n) => onOverride(n))}>
            Reset {overriddenCount} edit{overriddenCount > 1 ? 's' : ''}
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table className="param-table">
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              {imported && <th scope="col">Current</th>}
              <th scope="col">Value</th>
              <th scope="col">Range</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {scopes.flatMap(({ scope, label }) => {
              const rows = config.params.filter((p) => p.scope === scope);
              if (!rows.length) return [];
              return [
                <tr key={scope} className="group-row">
                  <td colSpan={imported ? 5 : 4}>{label}</td>
                </tr>,
                ...rows.map((p) => {
                  const def = schema?.params[p.name];
                  const problem = validateParam(def, p.name, p.value);
                  const was = current(p.name, scope);
                  const changed = was !== undefined && was !== String(p.value);
                  return (
                    <tr key={p.name} className={`${p.overridden ? 'overridden' : ''} ${problem ? 'invalid' : ''}`} title={problem}>
                      <td>
                        <code>{p.name}</code>
                        <div className="hint" style={{ margin: 0 }}>
                          {GROUP_LABEL[p.group]}
                        </div>
                      </td>
                      {imported && <td className="tabular">{was ?? <span className="hint">default</span>}</td>}
                      <td className={changed ? 'changed' : undefined}>
                        <ValueInput def={def} value={p.value} label={p.name} onChange={(v) => onOverride(p.name, v)} />
                        {p.overridden && (
                          <button type="button" className="btn small" style={{ marginLeft: 6 }} onClick={() => onOverride(p.name)} aria-label={`Reset ${p.name}`}>
                            ↺
                          </button>
                        )}
                      </td>
                      <td className="hint tabular">{rangeText(def)}</td>
                      <td className="hint">{problem ?? p.note ?? ''}</td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      {schema && (
        <form
          className="row"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            const def = schema.params[newName];
            if (!def) return;
            onOverride(newName, def.kind === 'lookup' ? (def.values?.[0] ?? '') : def.kind === 'range' ? (def.min ?? 0) : '');
            setNewName('');
          }}
        >
          <label htmlFor="add-param" className="hint" style={{ margin: 0 }}>
            Add a parameter:
          </label>
          <input id="add-param" className="select" list="param-names" value={newName} onChange={(e) => setNewName(e.target.value.trim())} placeholder="e.g. tpa_low_rate" />
          <datalist id="param-names">
            {Object.keys(schema.params)
              .filter((n) => !config.params.some((p) => p.name === n))
              .map((n) => (
                <option key={n} value={n} />
              ))}
          </datalist>
          <button type="submit" className="btn small" disabled={!schema.params[newName]}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}
