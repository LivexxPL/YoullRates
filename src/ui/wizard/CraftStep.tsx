// Step 1: what are you flying?
import { CRAFT_CLASSES_INFO } from '../../core/craft/classes';
import { typicalKv } from '../../core/craft/physics';
import { CRAFT_CLASSES, type NoiseLevel } from '../../core/types';
import { ChoiceCards, Chips, NumberInput } from '../components/controls';
import { CraftArt } from '../components/Icons';
import type { StepProps } from './types';

const BUILD_OPTIONS: { value: NoiseLevel; label: string }[] = [
  { value: 0, label: 'Brand new, stiff frame' },
  { value: 1, label: 'Good condition' },
  { value: 2, label: 'Average' },
  { value: 3, label: 'Some wear' },
  { value: 4, label: 'Rough (bent bells, soft frame)' },
];

const LINK_OPTIONS = [
  { value: 50, label: '50 Hz', hint: 'long-range modes' },
  { value: 150, label: '150 Hz', hint: 'Crossfire, ELRS 150' },
  { value: 250, label: '250 Hz', hint: 'ELRS, Tracer' },
  { value: 500, label: '500 Hz', hint: 'ELRS' },
  { value: 1000, label: '1000 Hz', hint: 'ELRS F1000' },
];

export function CraftStep({ state, dispatch }: StepProps) {
  const craft = state.craft;
  const info = CRAFT_CLASSES_INFO[craft.classId];
  const patch = (p: Partial<typeof craft>, weightTouched = false) => dispatch({ type: 'craft', patch: p, weightTouched });
  return (
    <section className="panel" aria-labelledby="craft-title">
      <h2 id="craft-title" tabIndex={-1}>What are you flying?</h2>
      <p className="lede">Pick the size class, then tell us a little about the build. Every answer has a sensible default.</p>

      <ChoiceCards
        label="Size class"
        value={craft.classId}
        onChange={(classId) => dispatch({ type: 'craftClass', classId })}
        options={CRAFT_CLASSES.map((id) => {
          const c = CRAFT_CLASSES_INFO[id];
          return { value: id, label: c.label, tag: c.tagline, description: c.description, art: <CraftArt classId={id} ducted={id === 'micro' ? (craft.classId === 'micro' ? craft.frame === 'ducted' : true) : undefined} /> };
        })}
      />

      <div className="grid-2">
        <div className="field">
          <span className="field-label" id="prop-label">
            Prop size
          </span>
          <Chips label="Prop size" value={craft.propInches} onChange={(propInches) => patch({ propInches })} options={info.props.map((p) => ({ value: p.inches, label: p.label }))} />
        </div>
        {info.frames.length > 1 && (
          <div className="field">
            <span className="field-label">Frame</span>
            <Chips
              label="Frame"
              value={craft.frame}
              onChange={(frame) => patch({ frame })}
              options={[
                { value: 'ducted', label: 'Ducted (cinewhoop)' },
                { value: 'open', label: 'Open props' },
              ]}
            />
          </div>
        )}
        <div className="field">
          <span className="field-label">Battery</span>
          <Chips label="Battery cells" value={craft.cells} onChange={(cells) => patch({ cells })} options={info.cells.map((c) => ({ value: c, label: `${c}S` }))} />
        </div>
        <div className="field">
          <label htmlFor="weight">Weight, ready to fly</label>
          <div className="row">
            <input
              aria-label="Weight slider"
              type="range"
              min={info.weight.min}
              max={info.weight.max}
              step={info.weight.step}
              value={craft.weightGrams}
              onChange={(e) => patch({ weightGrams: Number(e.target.value) }, true)}
              style={{ flex: 1, minWidth: 140 }}
            />
            <NumberInput id="weight" value={craft.weightGrams} unit="g" min={1} onChange={(v) => v && patch({ weightGrams: Math.max(1, Math.round(v)) }, true)} />
          </div>
          <p className="hint">Battery, camera and straps included. Weight sets the thrust-to-weight, the main driver of how much P, I, D and FF the quad needs.</p>
        </div>
      </div>

      <details style={{ marginTop: 20 }}>
        <summary>Motors, ESC and radio (optional, improves the estimate)</summary>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="kv">Motor KV</label>
            <NumberInput id="kv" value={craft.motorKv} unit="KV" min={100} max={60000} step={50} placeholder={String(typicalKv(craft.propInches, craft.cells))} onChange={(motorKv) => patch({ motorKv: motorKv && motorKv > 0 ? motorKv : undefined })} />
            <p className="hint">Leave empty to assume a typical {typicalKv(craft.propInches, craft.cells)} KV for {craft.propInches < 2 ? `${Math.round(craft.propInches * 25.4)} mm` : `${craft.propInches}"`} on {craft.cells}S.</p>
          </div>
          <div className="field">
            <span className="field-label">Motor magnets (poles)</span>
            <Chips
              label="Motor poles"
              value={craft.motorPoles}
              onChange={(motorPoles) => patch({ motorPoles })}
              options={[
                { value: 12, label: '12', disabled: false },
                { value: 14, label: '14' },
              ]}
            />
            <p className="hint">From the motor spec: 9N12 → 12, 12N14 → 14. The RPM filter needs the right count.</p>
          </div>
          <div className="field">
            <span className="field-label">ESC firmware</span>
            <Chips
              label="ESC firmware"
              value={craft.rpmFilter ? 'bidir' : 'none'}
              onChange={(v) => patch({ rpmFilter: v === 'bidir' })}
              options={[
                { value: 'bidir', label: 'Bluejay / BLHeli_32 / AM32' },
                { value: 'none', label: 'BLHeli_S (stock) / not sure' },
              ]}
            />
            <p className="hint">Bidirectional DShot enables the RPM filter: far less filter delay, cooler motors.</p>
          </div>
          <div className="field">
            <span className="field-label">Radio link rate</span>
            <Chips label="Radio link rate" value={craft.linkRateHz} onChange={(linkRateHz) => patch({ linkRateHz })} options={LINK_OPTIONS.map((o) => ({ value: o.value, label: <>{o.label}<small>{o.hint}</small></> }))} />
          </div>
        </div>
      </details>

      <div className="field">
        <span className="field-label">How clean is the build?</span>
        <Chips label="Build condition" value={craft.noise} onChange={(noise) => patch({ noise })} options={BUILD_OPTIONS} />
        <p className="hint">Bent motor bells, chipped props, a loose stack or a flexy frame all add gyro noise, which needs more filtering.</p>
      </div>
    </section>
  );
}
