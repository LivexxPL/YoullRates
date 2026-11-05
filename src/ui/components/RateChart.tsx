// Rate curves (deg/s against stick deflection) with a draggable stick-position readout.
import { useMemo, useState, type PointerEvent } from 'react';

export interface CurveSeries {
  label: string;
  color: string;
  rate: (stick: number) => number;
  dashed?: boolean;
}

const W = 360;
const H = 220;
const PAD = { left: 44, right: 22, top: 12, bottom: 28 };
const SAMPLES = 80;

function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
}

export function RateChart({ series, title }: { series: CurveSeries[]; title: string }) {
  const [stick, setStick] = useState<number | null>(null);
  const { paths, yMax, step } = useMemo(() => {
    const maxRate = Math.max(100, ...series.map((s) => Math.abs(s.rate(1))));
    const st = niceStep(maxRate);
    const top = Math.ceil(maxRate / st) * st;
    const x = (v: number) => PAD.left + v * (W - PAD.left - PAD.right);
    const y = (v: number) => H - PAD.bottom - (v / top) * (H - PAD.top - PAD.bottom);
    return {
      yMax: top,
      step: st,
      paths: series.map((s) => {
        let d = '';
        for (let i = 0; i <= SAMPLES; i++) {
          const sx = i / SAMPLES;
          d += `${i ? 'L' : 'M'}${x(sx).toFixed(1)} ${y(s.rate(sx)).toFixed(1)}`;
        }
        return d;
      }),
    };
  }, [series]);

  const x = (v: number) => PAD.left + v * (W - PAD.left - PAD.right);
  const y = (v: number) => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom);
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);

  const track = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setStick(Math.min(1, Math.max(0, (px - PAD.left) / (W - PAD.left - PAD.right))));
  };

  const readout = stick ?? 0.5;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${series.map((s) => `${s.label} ${Math.round(s.rate(1))}°/s at full stick`).join(', ')}`} onPointerMove={track} onPointerDown={track} onPointerLeave={() => setStick(null)}>
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1={PAD.top} y2={H - PAD.bottom} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((t) => (
            <text key={t} x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle">
              {Math.round(t * 100)}%
            </text>
          ))}
        </g>
        {paths.map((d, i) => {
          const s = series[i];
          return s ? <path key={s.label} className="curve" d={d} stroke={s.color} strokeDasharray={s.dashed ? '6 5' : undefined} opacity={s.dashed ? 0.8 : 1} /> : null;
        })}
        <line x1={x(readout)} x2={x(readout)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeDasharray="3 3" opacity={stick === null ? 0.35 : 0.9} />
        {series.map((s) => (
          <circle key={s.label} cx={x(readout)} cy={y(s.rate(readout))} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />
        ))}
      </svg>
      <figcaption className="legend">
        <span className="tabular">Stick {Math.round(readout * 100)}%:</span>
        {series.map((s) => (
          <span key={s.label} className="tabular">
            <i style={{ background: s.color }} />
            {s.label} {Math.round(s.rate(readout))}°/s
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
