// Small numeric helpers shared by the core modules.

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Rounds to the nearest multiple of `step` (0.5 steps round away from zero like C's lrintf for our ranges). */
export const roundTo = (value: number, step: number): number => Math.round(value / step) * step;

/** Linear interpolation in a table of [x, y] points sorted by x; clamps outside the table. */
export function interpolate(table: readonly (readonly [number, number])[], x: number): number {
  const first = table[0];
  const last = table[table.length - 1];
  if (!first || !last) throw new Error('interpolate: empty table');
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const hi = table[i];
    const lo = table[i - 1];
    if (hi && lo && x <= hi[0]) return lerp(lo[1], hi[1], (x - lo[0]) / (hi[0] - lo[0]));
  }
  return last[1];
}

/** Interpolation with log-scaled x and y (power-law segments): suited to sizes and frequencies. */
export function interpolateLogLog(table: readonly (readonly [number, number])[], x: number): number {
  const logTable = table.map(([tx, ty]) => [Math.log(tx), Math.log(ty)] as const);
  return Math.exp(interpolate(logTable, Math.log(x)));
}

/** Interpolates along an array indexed 0..n-1 at a fractional index (clamped). */
export function interpolateIndex(values: readonly number[], index: number): number {
  return interpolate(
    values.map((v, i) => [i, v] as const),
    index,
  );
}

/** exp(k * s): maps a -1…+1 slider to a symmetric multiplicative factor. */
export const sliderFactor = (slider: number, strength: number): number => Math.exp(strength * clamp(slider, -1, 1));

/** Golden-section minimisation of a unimodal function on [a, b]. */
export function goldenSectionMinimize(f: (x: number) => number, a: number, b: number, tolerance = 1e-4): number {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let lo = a;
  let hi = b;
  let x1 = hi - ratio * (hi - lo);
  let x2 = lo + ratio * (hi - lo);
  let f1 = f(x1);
  let f2 = f(x2);
  while (hi - lo > tolerance) {
    if (f1 < f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - ratio * (hi - lo);
      f1 = f(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + ratio * (hi - lo);
      f2 = f(x2);
    }
  }
  return (lo + hi) / 2;
}

export const formatPercentChange = (factor: number): string => {
  const pct = Math.round((factor - 1) * 100);
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct)} %`;
};
