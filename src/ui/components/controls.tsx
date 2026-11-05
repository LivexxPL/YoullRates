// Accessible form controls: radio-group cards and chips, bipolar intent sliders, number inputs.
import { useId, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

interface Option<T> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/** Arrow-key navigation for role="radiogroup" containers. */
function onRadioKeys<T>(event: KeyboardEvent, options: readonly Option<T>[], value: T, onChange: (v: T) => void) {
  const enabled = options.filter((o) => !o.disabled);
  const index = enabled.findIndex((o) => o.value === value);
  const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
  if (!delta) return;
  event.preventDefault();
  const next = enabled[(index + delta + enabled.length) % enabled.length];
  if (next) {
    onChange(next.value);
    const group = event.currentTarget as HTMLElement;
    requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
}

export function Chips<T extends string | number>({ label, options, value, onChange }: { label: string; options: readonly Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label} onKeyDown={(e) => onRadioKeys(e, options, value, onChange)}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" className="chip" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface CardOption<T> extends Option<T> {
  art?: ReactNode;
  tag?: string;
  description?: string;
}

export function ChoiceCards<T extends string>({ label, options, value, onChange }: { label: string; options: readonly CardOption<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="choice-grid" role="radiogroup" aria-label={label} onKeyDown={(e) => onRadioKeys(e, options, value, onChange)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" className="choice" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.art && <span className="art">{o.art}</span>}
          <strong>{o.label}</strong>
          {o.tag && <span className="tag">{o.tag}</span>}
          {o.description && <p>{o.description}</p>}
        </button>
      ))}
    </div>
  );
}

/** A -1…+1 intent slider with words at both ends instead of numbers. */
export function IntentSlider({ label, left, right, value, onChange, readout }: { label: string; left: string; right: string; value: number; onChange: (v: number) => void; readout?: string }) {
  const id = useId();
  const words = value < -0.6 ? `strongly ${left.toLowerCase()}` : value < -0.15 ? left.toLowerCase() : value > 0.6 ? `strongly ${right.toLowerCase()}` : value > 0.15 ? right.toLowerCase() : 'balanced';
  // The fill grows from the center toward the thumb: the neutral position shows no bias.
  const pos = ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100;
  const lo = Math.min(50, pos);
  const hi = Math.max(50, pos);
  const fill = { '--fill': `linear-gradient(90deg, var(--border) 0 ${lo}%, var(--accent) ${lo}% ${hi}%, var(--border) ${hi}% 100%)` } as CSSProperties;
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>
          <strong>{label}</strong>
        </label>
        <output htmlFor={id}>{readout ?? words}</output>
      </div>
      <div className="intent-track">
        <input
          id={id}
          className="intent"
          style={fill}
          type="range"
          min={-100}
          max={100}
          step={5}
          value={Math.round(value * 100)}
          aria-valuetext={`${words}${readout ? `, ${readout}` : ''}`}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          onDoubleClick={() => onChange(0)}
        />
      </div>
      <div className="slider-ends" aria-hidden="true">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

export function NumberInput({ id, value, onChange, unit, min, max, step = 1, placeholder }: { id?: string; value: number | undefined; onChange: (v: number | undefined) => void; unit: string; min?: number; max?: number; step?: number; placeholder?: string }) {
  return (
    <span className="number-input">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(undefined);
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      <span>{unit}</span>
    </span>
  );
}

export function Notice({ kind, children }: { kind: 'warn' | 'error' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  );
}
