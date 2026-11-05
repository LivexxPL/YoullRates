// Keyboard fallback: arrows for roll/pitch, A/D for yaw. Keys are digital, so each axis ramps
// toward full deflection and back to center, which still lets you feel the shape of the curve.
import { clamp } from '../../core/math';
import { CENTERED, type StickInput } from '../rcPipeline';

const KEYS: Record<string, { axis: keyof StickInput; dir: 1 | -1 }> = {
  ArrowRight: { axis: 'roll', dir: 1 },
  ArrowLeft: { axis: 'roll', dir: -1 },
  ArrowUp: { axis: 'pitch', dir: 1 },
  ArrowDown: { axis: 'pitch', dir: -1 },
  KeyD: { axis: 'yaw', dir: 1 },
  KeyA: { axis: 'yaw', dir: -1 },
};

/** Stick travel per second while a key is held (full deflection in about 0.4 s). */
const RAMP_PER_SECOND = 2.5;

export class KeyboardSticks {
  private held = new Set<string>();
  private value: StickInput = { ...CENTERED };

  /** Returns true when the key belongs to the simulator (so the caller can preventDefault). */
  handle(code: string, down: boolean): boolean {
    if (!(code in KEYS)) return false;
    if (down) this.held.add(code);
    else this.held.delete(code);
    return true;
  }

  release(): void {
    this.held.clear();
  }

  get active(): boolean {
    return this.held.size > 0 || Object.values(this.value).some((v) => v !== 0);
  }

  update(dt: number): StickInput {
    const target: StickInput = { ...CENTERED };
    for (const code of this.held) {
      const k = KEYS[code];
      if (k) target[k.axis] += k.dir;
    }
    const step = RAMP_PER_SECOND * dt;
    for (const axis of ['roll', 'pitch', 'yaw'] as const) {
      const goal = clamp(target[axis], -1, 1);
      const current = this.value[axis];
      this.value[axis] = current < goal ? Math.min(goal, current + step) : Math.max(goal, current - step);
    }
    return { ...this.value };
  }
}
