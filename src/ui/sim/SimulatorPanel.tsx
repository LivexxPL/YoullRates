// The rate simulator: fly the compiled rates with a USB radio, the on-screen sticks or the keyboard.
//
// Every animation frame:
//   1. poll the input (Gamepad API snapshot, touch sticks, keyboard ramp)  → sticks in [-1, 1]
//   2. Betaflight stick pipeline + rate formula on the stored integers     → setpoints in deg/s
//   3. integrate the body rates over the frame time dt (exact rotation)    → attitude quaternion
//   4. render (only when something changed) and refresh the HUD ~20 times a second
// The loop lives outside React state: refs carry the per-frame data, so a frame costs no re-render.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from '../../core/math';
import { AXES, type PerAxis } from '../../core/types';
import type { AxisRate, Deadbands } from '../../firmware/flownRates';
import { connectedPads, loadMapping, readSticks, saveMapping, type GamepadMapping } from '../../sim/input/gamepad';
import { KeyboardSticks } from '../../sim/input/keyboard';
import { bodyOmega, IDENTITY, integrateBodyRate, type Quat } from '../../sim/kinematics';
import { CENTERED, setpoints, type StickInput } from '../../sim/rcPipeline';
import { createSimScene, type SimScene, type ViewMode } from '../../sim/scene';
import { RadioSetup } from './RadioSetup';

export interface SimulatorPanelProps {
  /** Setpoint (deg/s) per axis for a normalised RC command, as the firmware computes it. */
  rates: PerAxis<AxisRate>;
  deadbands: Deadbands;
  ducted: boolean;
  /** FPV camera uptilt to start with, degrees. */
  defaultUptilt: number;
}

type Source = 'auto' | 'screen' | number;
interface PadInfo {
  index: number;
  id: string;
  mapping: string;
  axes: number;
}
type Side = 'left' | 'right';

interface Runtime {
  rates: PerAxis<AxisRate>;
  deadbands: Deadbands;
  source: Source;
  padId?: string;
  mapping?: GamepadMapping;
  rawAxes: number[];
  touch: Record<Side, { x: number; y: number; on: boolean }>;
  keyboard: KeyboardSticks;
  attitude: Quat;
  /** Something other than motion needs a redraw (resize, camera change, reset). */
  dirty: boolean;
  inputLabel: string;
  /** Knob travel from center to edge of the on-screen pads, px (measured on resize). */
  knobTravel: number;
}

const VIEW_KEY = 'tuneforge:sim-view';
const KNOB_PX = 26;
const MAX_DT = 0.05; // a background tab or a long frame must not fling the model

const padInfo = (p: Gamepad): PadInfo => ({ index: p.index, id: p.id, mapping: p.mapping, axes: p.axes.length });
const signed = (v: number, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'fpv' ? 'fpv' : 'chase';
  } catch {
    return 'chase';
  }
}

/** Picks the input that drives this frame: touch while dragging, then keys, then the radio. */
function readInput(r: Runtime, pads: readonly Gamepad[], dt: number, onPadChange: (pad?: Gamepad, mapping?: GamepadMapping) => void): StickInput {
  const pad = r.source === 'screen' ? undefined : typeof r.source === 'number' ? pads.find((p) => p.index === r.source) : pads[0];
  if (pad?.id !== r.padId) {
    r.padId = pad?.id;
    r.mapping = pad ? loadMapping(pad) : undefined;
    onPadChange(pad, r.mapping);
  }
  r.rawAxes = pad ? Array.from(pad.axes) : [];
  const keys = r.keyboard.update(dt);
  const { left, right } = r.touch;
  if (left.on || right.on) {
    r.inputLabel = 'on-screen sticks';
    return { roll: right.x, pitch: right.y, yaw: left.x };
  }
  if (r.keyboard.active) {
    r.inputLabel = 'keyboard';
    return keys;
  }
  if (pad && r.mapping) {
    r.inputLabel = pad.id;
    return readSticks(pad, r.mapping);
  }
  r.inputLabel = 'none';
  return { ...CENTERED };
}

export default function SimulatorPanel({ rates, deadbands, ducted, defaultUptilt }: SimulatorPanelProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hud = useRef<Record<string, HTMLElement | null>>({});
  const knobs = useRef<Record<Side, HTMLElement | null>>({ left: null, right: null });
  const sceneRef = useRef<SimScene | undefined>(undefined);
  const runtimeRef = useRef<Runtime | null>(null);
  runtimeRef.current ??= {
    rates,
    deadbands,
    source: 'auto',
    rawAxes: [],
    touch: { left: { x: 0, y: 0, on: false }, right: { x: 0, y: 0, on: false } },
    keyboard: new KeyboardSticks(),
    attitude: IDENTITY,
    dirty: true,
    inputLabel: 'none',
    knobTravel: 39,
  };
  const runtime = runtimeRef as { current: Runtime };

  const [view, setView] = useState<ViewMode>(readView);
  const [uptilt, setUptilt] = useState(defaultUptilt);
  const [source, setSource] = useState<Source>('auto');
  const [pads, setPads] = useState<PadInfo[]>([]);
  const [activePad, setActivePad] = useState<PadInfo>();
  const [mapping, setMapping] = useState<GamepadMapping>();
  const [glError, setGlError] = useState<string>();
  const [fullscreen, setFullscreen] = useState(false);
  const viewRef = useRef(view);
  const uptiltRef = useRef(uptilt);

  // Rate or deadband edits apply to the running loop immediately.
  useEffect(() => {
    runtime.current.rates = rates;
    runtime.current.deadbands = deadbands;
  }, [rates, deadbands, runtime]);
  useEffect(() => {
    runtime.current.source = source;
  }, [source, runtime]);

  // Scene and frame loop. Recreated only when the model changes (open ↔ ducted).
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const r = runtime.current;
    let scene: SimScene | undefined;
    try {
      scene = createSimScene(canvas, { ducted });
      scene.setView(viewRef.current);
      scene.setUptilt(uptiltRef.current);
      setGlError(undefined);
    } catch {
      setGlError('3D view unavailable: this browser could not start WebGL. The numbers below still follow your sticks.');
    }
    sceneRef.current = scene;
    r.dirty = true;

    const resize = () => {
      const box = wrap.getBoundingClientRect();
      scene?.resize(Math.max(1, box.width), Math.max(1, box.height), window.devicePixelRatio || 1);
      const pad = knobs.current.right?.parentElement;
      if (pad) r.knobTravel = Math.max(10, (pad.clientWidth - KNOB_PX) / 2);
      r.dirty = true;
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);
    let onScreen = true;
    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
    });
    visibility.observe(wrap);

    const onPadChange = (pad?: Gamepad, padMapping?: GamepadMapping) => {
      setActivePad(pad ? padInfo(pad) : undefined);
      setMapping(padMapping);
    };
    const drawKnob = (side: Side, x: number, y: number) => {
      const knob = knobs.current[side];
      if (knob) knob.style.transform = `translate(-50%, -50%) translate(${(x * r.knobTravel).toFixed(1)}px, ${(-y * r.knobTravel).toFixed(1)}px)`;
    };
    const drawHud = (sticks: StickInput, sp: StickInput) => {
      for (const axis of AXES) {
        const max = Math.max(1, Math.abs(r.rates[axis](1)));
        const share = clamp(Math.abs(sp[axis]) / max, 0, 1) * 50;
        const bar = hud.current[`${axis}-bar`];
        if (bar) {
          bar.style.left = `${sp[axis] < 0 ? 50 - share : 50}%`;
          bar.style.width = `${share}%`;
        }
        const stick = hud.current[`${axis}-stick`];
        if (stick) stick.textContent = `${signed(sticks[axis] * 100)}%`;
        const rate = hud.current[`${axis}-rate`];
        if (rate) rate.textContent = `${signed(sp[axis])}°/s`;
        wrap.dataset[`${axis}Rate`] = sp[axis].toFixed(1);
      }
      const label = hud.current.input;
      if (label) label.textContent = `Input: ${r.inputLabel}`;
      const q = r.attitude;
      wrap.dataset.attitude = [q.x, q.y, q.z, q.w].map((v) => v.toFixed(4)).join(',');
      wrap.dataset.input = r.inputLabel;
    };

    let last = performance.now();
    let hudClock = 1;
    let padClock = 1;
    let padSignature = '';
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
      last = now;
      if (!onScreen || document.hidden) return;

      const all = connectedPads();
      padClock += dt;
      if (padClock >= 1) {
        padClock = 0;
        const signature = all.map((p) => `${p.index}:${p.id}`).join('|');
        if (signature !== padSignature) {
          padSignature = signature;
          setPads(all.map(padInfo));
        }
      }

      const sticks = readInput(r, all, dt, onPadChange);
      const sp = setpoints(sticks, r.rates, r.deadbands);
      const moving = sp.roll !== 0 || sp.pitch !== 0 || sp.yaw !== 0;
      if (moving) r.attitude = integrateBodyRate(r.attitude, bodyOmega(sp), dt);
      if (scene && (moving || r.dirty)) {
        scene.setAttitude(r.attitude);
        scene.render();
        r.dirty = false;
      }
      drawKnob('left', sticks.yaw, 0);
      drawKnob('right', sticks.roll, sticks.pitch);
      hudClock += dt;
      if (hudClock >= 0.05) {
        hudClock = 0;
        drawHud(sticks, sp);
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibility.disconnect();
      scene?.dispose();
      sceneRef.current = undefined;
    };
  }, [ducted, runtime]);

  useEffect(() => {
    viewRef.current = view;
    sceneRef.current?.setView(view);
    runtime.current.dirty = true;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Not remembered; still applies now.
    }
  }, [view, runtime]);

  useEffect(() => {
    uptiltRef.current = uptilt;
    sceneRef.current?.setUptilt(uptilt);
    runtime.current.dirty = true;
  }, [uptilt, runtime]);

  // Connection events make a radio appear at once instead of at the next once-a-second check.
  useEffect(() => {
    const refresh = () => setPads(connectedPads().map(padInfo));
    window.addEventListener('gamepadconnected', refresh);
    window.addEventListener('gamepaddisconnected', refresh);
    return () => {
      window.removeEventListener('gamepadconnected', refresh);
      window.removeEventListener('gamepaddisconnected', refresh);
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const reset = useCallback(() => {
    runtime.current.attitude = IDENTITY;
    runtime.current.dirty = true;
  }, [runtime]);

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  const onKey = (down: boolean) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (down && e.code === 'KeyR') {
      reset();
      e.preventDefault();
      return;
    }
    if (runtime.current.keyboard.handle(e.code, down)) e.preventDefault();
  };

  const stickPointer = (side: Side) => {
    const move = (e: PointerEvent<HTMLDivElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      const t = runtime.current.touch[side];
      t.x = clamp(((e.clientX - box.left) / box.width) * 2 - 1, -1, 1);
      t.y = clamp(1 - ((e.clientY - box.top) / box.height) * 2, -1, 1);
    };
    const release = () => Object.assign(runtime.current.touch[side], { x: 0, y: 0, on: false });
    return {
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
        try {
          // Keeps the drag when the finger leaves the pad; best-effort (it throws for stale pointers).
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // The stick still works while the pointer stays over the pad.
        }
        runtime.current.touch[side].on = true;
        move(e);
        e.preventDefault();
      },
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
        if (runtime.current.touch[side].on) move(e);
      },
      onPointerUp: release,
      onPointerCancel: release,
      onLostPointerCapture: release,
    };
  };

  const onMapping = useCallback(
    (next: GamepadMapping) => {
      const r = runtime.current;
      r.mapping = next;
      if (r.padId) saveMapping(r.padId, next);
      setMapping(next);
    },
    [runtime],
  );
  const readAxes = useCallback(() => runtime.current.rawAxes, [runtime]);

  const maxRates = useMemo(() => ({ roll: Math.abs(rates.roll(1)), pitch: Math.abs(rates.pitch(1)), yaw: Math.abs(rates.yaw(1)) }), [rates]);
  const flip = (axis: keyof typeof maxRates) => (maxRates[axis] > 0 ? (360 / maxRates[axis]).toFixed(2) : '–');
  const gamepadApi = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  const status = !gamepadApi
    ? 'This browser has no Gamepad API: fly with the on-screen sticks or the keyboard.'
    : activePad
      ? `Radio: ${activePad.id} (${activePad.axes} axes). Sticks not matching? Open “Radio setup” below.`
      : 'No radio yet: connect it by USB, pick USB Joystick (HID) on the radio, then move a stick so the browser lists it. Meanwhile, drag the on-screen sticks or use the keyboard.';

  return (
    <div className="sim">
      <div
        ref={wrapRef}
        className="sim-view"
        tabIndex={0}
        role="group"
        aria-label="Rate simulator. Arrow keys roll and pitch, A and D yaw, R levels the quad."
        onKeyDown={onKey(true)}
        onKeyUp={onKey(false)}
        onBlur={() => runtime.current.keyboard.release()}
      >
        <canvas ref={canvasRef} className="sim-canvas" onDoubleClick={reset} aria-hidden="true" />
        {glError && <div className="sim-error">{glError}</div>}

        <div className="sim-hud" aria-hidden="true">
          {AXES.map((axis) => (
            <div className="sim-hud-row" key={axis}>
              <span className="sim-hud-axis">{axis}</span>
              <span className="tabular" ref={(el) => void (hud.current[`${axis}-stick`] = el)}>
                0%
              </span>
              <span className="sim-bar">
                <i ref={(el) => void (hud.current[`${axis}-bar`] = el)} />
              </span>
              <span className="tabular sim-hud-rate" ref={(el) => void (hud.current[`${axis}-rate`] = el)}>
                0°/s
              </span>
            </div>
          ))}
          <div className="sim-hud-input" ref={(el) => void (hud.current.input = el)}>
            Input: none
          </div>
        </div>

        <div className="sim-toolbar">
          <div className="sim-seg" role="radiogroup" aria-label="Camera">
            <button type="button" role="radio" aria-checked={view === 'chase'} onClick={() => setView('chase')}>
              Chase
            </button>
            <button type="button" role="radio" aria-checked={view === 'fpv'} onClick={() => setView('fpv')}>
              FPV
            </button>
          </div>
          <button type="button" className="sim-button" onClick={reset} title="Level the quad (R, or double-click the view)">
            Level
          </button>
          <button type="button" className="sim-button" onClick={toggleFullscreen}>
            {fullscreen ? 'Exit full screen' : 'Full screen'}
          </button>
        </div>

        <div className="sim-pad left" aria-label="On-screen yaw stick" {...stickPointer('left')}>
          <i className="sim-knob" ref={(el) => void (knobs.current.left = el)} />
        </div>
        <div className="sim-pad right" aria-label="On-screen roll and pitch stick" {...stickPointer('right')}>
          <i className="sim-knob" ref={(el) => void (knobs.current.right = el)} />
        </div>
      </div>

      <div className="sim-controls">
        <label className="toggle">
          Input
          <select
            className="select"
            value={String(source)}
            onChange={(e) => {
              const v = e.target.value;
              setSource(v === 'auto' || v === 'screen' ? v : Number(v));
            }}
          >
            <option value="auto">Radio / gamepad (first found)</option>
            {pads.map((p) => (
              <option key={p.index} value={p.index}>
                {p.id}
              </option>
            ))}
            <option value="screen">On-screen sticks & keyboard only</option>
          </select>
        </label>
        {view === 'fpv' && (
          <label className="toggle sim-uptilt">
            Camera uptilt
            <input type="range" min={0} max={60} step={1} value={uptilt} onChange={(e) => setUptilt(Number(e.target.value))} />
            <span className="tabular">{uptilt}°</span>
          </label>
        )}
      </div>
      <p className="hint">{status}</p>
      <p className="hint tabular">
        Full-stick flip: roll {flip('roll')} s, pitch {flip('pitch')} s · yaw turn {flip('yaw')} s · deadband {deadbands.rollPitch} µs, yaw {deadbands.yaw} µs · keys: arrows, A/D, R to level
      </p>
      {activePad && mapping && (
        <details className="sim-setup">
          <summary>Radio setup: {activePad.id}</summary>
          <RadioSetup pad={activePad} mapping={mapping} readAxes={readAxes} onMapping={onMapping} />
        </details>
      )}
    </div>
  );
}
