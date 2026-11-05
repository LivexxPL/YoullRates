// The always-visible side panel: rate curves as the firmware will run them, the craft estimate,
// the gains being written, motor heat risk and warnings.
import type { CanonicalTune } from '../../core/tuning/engine';
import type { HeatRisk } from '../../core/tuning/filters';
import { AXES, type Axis } from '../../core/types';
import { flownRate } from '../../firmware/flownRates';
import type { CompiledConfig, FirmwareAdapter } from '../../firmware/types';
import { Notice } from '../components/controls';
import { RateChart, type CurveSeries } from '../components/RateChart';

export interface GainRow {
  axis: Axis;
  p: number;
  i: number;
  d: number;
  dMax: number;
  ff: number;
}

/** Gains as written to the flight controller (Betaflight naming differs by version). */
export function writtenGains(tune: CanonicalTune, config?: CompiledConfig): GainRow[] | undefined {
  if (!tune.pids) return undefined;
  const value = (name: string) => {
    const v = config?.params.find((p) => p.name === name)?.value;
    return typeof v === 'number' ? v : undefined;
  };
  return AXES.map((axis) => {
    const g = tune.pids!.gains[axis];
    const dIsBase = value(`d_max_${axis}`) !== undefined;
    const d = value(`d_${axis}`);
    const rest = dIsBase ? d : value(`d_min_${axis}`);
    const boosted = dIsBase ? value(`d_max_${axis}`) : d;
    return {
      axis,
      p: value(`p_${axis}`) ?? Math.round(g.p),
      i: value(`i_${axis}`) ?? Math.round(g.i),
      d: rest ?? Math.round(g.dMin),
      dMax: boosted ?? Math.round(g.dMax),
      ff: value(`f_${axis}`) ?? Math.round(g.ff),
    };
  });
}

export function HeatMeter({ risk }: { risk: HeatRisk }) {
  const label = { low: 'Low', moderate: 'Moderate', high: 'High' }[risk.level];
  return (
    <div className="meter">
      <div className="meter-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(risk.score * 100)} aria-label="Motor heat risk">
        <div className="meter-thumb" style={{ left: `${risk.score * 100}%` }} />
      </div>
      <div className="meter-label">
        <span>Motor heat risk</span>
        <strong>{label}</strong>
      </div>
      <p className="hint">{risk.advice}</p>
    </div>
  );
}

export function LivePreview({ tune, config, adapter }: { tune: CanonicalTune; config?: CompiledConfig; adapter: FirmwareAdapter }) {
  const series: CurveSeries[] = [
    { label: 'Roll/Pitch', color: 'var(--curve-rp)', rate: flownRate('roll', tune, config) },
    { label: 'Yaw', color: 'var(--curve-yaw)', rate: flownRate('yaw', tune, config) },
  ];
  const gains = writtenGains(tune, config);
  const roll = tune.rates.roll;
  const errors = config?.issues.filter((i) => i.severity === 'error') ?? [];
  return (
    <aside className="panel" aria-label="Live preview">
      <h3>Rates as the flight controller will fly them</h3>
      <RateChart title="Rate curves" series={series} />
      <div className="stats" style={{ marginTop: 14 }}>
        <div className="stat">
          <span>Max rate</span>
          <strong>{Math.round(series[0]!.rate(1))}°/s</strong>
        </div>
        <div className="stat">
          <span>Center</span>
          <strong>{Math.round(roll.center)}°/s</strong>
        </div>
        <div className="stat">
          <span>Expo</span>
          <strong>{roll.expo.toFixed(2)}</strong>
        </div>
        <div className="stat">
          <span>Thrust/weight</span>
          <strong>{tune.physics.twr.toFixed(1)}:1</strong>
        </div>
        <div className="stat">
          <span>Hover</span>
          <strong>{Math.round(tune.physics.hoverThrottle * 100)}%</strong>
        </div>
        <div className="stat">
          <span>Motor at hover</span>
          <strong>{tune.physics.hoverMotorHz} Hz</strong>
        </div>
      </div>

      {gains && (
        <>
          <h3 style={{ marginTop: 18 }}>PID gains written ({adapter.name} scale)</h3>
          <table className="gain-table">
            <thead>
              <tr>
                <th scope="col">Axis</th>
                <th scope="col">P</th>
                <th scope="col">I</th>
                <th scope="col" title="Resting D">D</th>
                <th scope="col" title="D during fast moves and propwash">D max</th>
                <th scope="col">FF</th>
              </tr>
            </thead>
            <tbody>
              {gains.map((g) => (
                <tr key={g.axis}>
                  <td style={{ textTransform: 'capitalize' }}>{g.axis}</td>
                  <td>{g.p}</td>
                  <td>{g.i}</td>
                  <td>{g.d}</td>
                  <td>{g.dMax}</td>
                  <td>{g.ff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tune.filters && <HeatMeter risk={tune.filters.heatRisk} />}

      {(tune.warnings.length > 0 || errors.length > 0) && (
        <div style={{ marginTop: 14 }}>
          {errors.map((e) => (
            <Notice key={e.name + e.message} kind="error">
              {e.message}
            </Notice>
          ))}
          {tune.warnings.map((w) => (
            <Notice key={w} kind="warn">
              {w}
            </Notice>
          ))}
        </div>
      )}
    </aside>
  );
}
