// Line-art illustrations (currentColor, so they follow the theme and selection state).
import type { CraftClassId, FlightStyle } from '../../core/types';

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="8" cy="8" r="5.5" />
        <circle cx="24" cy="8" r="5.5" />
        <circle cx="8" cy="24" r="5.5" />
        <circle cx="24" cy="24" r="5.5" />
        <path d="M11.5 11.5l9 9M20.5 11.5l-9 9" />
      </g>
      <rect x="12.5" y="12.5" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function Prop({ cx, cy, r, ducted }: { cx: number; cy: number; r: number; ducted: boolean }) {
  const blade = r * 0.78;
  return (
    <g>
      {ducted ? <circle cx={cx} cy={cy} r={r} strokeWidth="3" /> : <circle cx={cx} cy={cy} r={r} strokeDasharray="3 3" opacity="0.55" />}
      <path d={`M${cx - blade} ${cy + blade * 0.25} L${cx + blade} ${cy - blade * 0.25}`} strokeWidth="2.4" />
      <circle cx={cx} cy={cy} r={2.4} fill="currentColor" />
    </g>
  );
}

export function CraftArt({ classId, ducted }: { classId: CraftClassId; ducted?: boolean }) {
  const layouts: Record<CraftClassId, { dx: number; dy: number; r: number; body: [number, number]; ducted: boolean; camera?: boolean; gps?: boolean }> = {
    tinywhoop: { dx: 19, dy: 19, r: 15, body: [14, 14], ducted: true },
    micro: { dx: 25, dy: 21, r: 18, body: [18, 16], ducted: ducted ?? true, camera: true },
    mini: { dx: 30, dy: 24, r: 18, body: [14, 26], ducted: false, camera: true },
    macro: { dx: 38, dy: 25, r: 22, body: [14, 32], ducted: false, camera: true, gps: true },
  };
  const l = layouts[classId];
  const cx = 60;
  const cy = 42;
  const motors = [
    [cx - l.dx, cy - l.dy],
    [cx + l.dx, cy - l.dy],
    [cx - l.dx, cy + l.dy],
    [cx + l.dx, cy + l.dy],
  ] as const;
  return (
    <svg viewBox="0 0 120 84" width="120" height="84" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {!l.ducted && motors.map(([x, y]) => <path key={`${x}${y}`} d={`M${cx} ${cy} L${x} ${y}`} strokeWidth="3.2" />)}
        {motors.map(([x, y]) => (
          <Prop key={`p${x}${y}`} cx={x} cy={y} r={l.r} ducted={l.ducted} />
        ))}
        <rect x={cx - l.body[0] / 2} y={cy - l.body[1] / 2} width={l.body[0]} height={l.body[1]} rx="3" fill="var(--surface)" />
        {l.camera && <rect x={cx - 5} y={cy - l.body[1] / 2 - 6} width="10" height="7" rx="2" fill="currentColor" />}
        {l.gps && <circle cx={cx} cy={cy + 6} r="4" />}
      </g>
    </svg>
  );
}

export function StyleArt({ style }: { style: FlightStyle }) {
  return (
    <svg viewBox="0 0 120 70" width="120" height="70" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {style === 'freestyle' && (
          <>
            <path d="M14 56 C 34 56, 40 14, 60 14 C 82 14, 84 46, 66 46 C 50 46, 54 22, 76 22 C 92 22, 100 40, 108 56" />
            <path d="M101 50 l7 6 l-9 2" />
          </>
        )}
        {style === 'cinematic' && (
          <>
            <rect x="26" y="24" width="48" height="30" rx="5" />
            <path d="M74 33 l18 -9 v30 l-18 -9" />
            <circle cx="40" cy="16" r="7" />
            <circle cx="60" cy="16" r="7" />
            <path d="M8 62 C 40 58, 80 58, 112 62" opacity="0.6" />
          </>
        )}
        {style === 'racing' && (
          <>
            <rect x="40" y="12" width="40" height="44" rx="3" />
            <path d="M8 34 H 112" strokeDasharray="6 5" />
            <path d="M98 26 l12 8 l-12 8" />
            <path d="M40 62 v-6 M80 62 v-6" />
          </>
        )}
      </g>
    </svg>
  );
}
