// Radio / gamepad setup: which axis is roll, pitch and yaw, direction, and end-point calibration.
// Detection works by moving the stick the way the prompt asks, so channel order and direction are
// found in one step whatever the radio's mixer or the operating system's HID ordering is.
import { useEffect, useRef, useState } from 'react';
import {
  applyCalibration,
  defaultMapping,
  detectAxis,
  startCalibration,
  STICK_AXES,
  updateCalibration,
  type Calibration,
  type GamepadMapping,
  type StickAxis,
} from '../../sim/input/gamepad';
import { Notice } from '../components/controls';

const PROMPT: Record<StickAxis, string> = {
  roll: 'Push the roll stick fully right and hold it',
  pitch: 'Push the pitch stick fully forward (up) and hold it',
  yaw: 'Push the yaw stick fully right and hold it',
};
const LABEL: Record<StickAxis, string> = { roll: 'Roll', pitch: 'Pitch', yaw: 'Yaw' };

export interface RadioSetupProps {
  pad: { id: string; mapping: string; axes: number };
  mapping: GamepadMapping;
  /** Latest raw axis values of the pad, refreshed by the simulator loop. */
  readAxes: () => readonly number[];
  onMapping: (mapping: GamepadMapping) => void;
}

export function RadioSetup({ pad, mapping, readAxes, onMapping }: RadioSetupProps) {
  const [axes, setAxes] = useState<readonly number[]>([]);
  const [detecting, setDetecting] = useState<{ axis: StickAxis; baseline: readonly number[]; until: number }>();
  const [calibration, setCalibration] = useState<'center' | 'sweep'>();
  const run = useRef<Calibration | undefined>(undefined);
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn' | 'info'; text: string }>();

  // Sample the raw axes ten times a second for the bars, detection and calibration.
  useEffect(() => {
    const timer = setInterval(() => {
      const current = readAxes();
      setAxes(current);
      if (run.current && calibration === 'sweep') updateCalibration(run.current, current);
      if (detecting) {
        const found = detectAxis(detecting.baseline, current, 0.6);
        if (found) {
          onMapping({ ...mapping, [detecting.axis]: { axis: found.axis, invert: found.invert, min: -1, center: 0, max: 1 } });
          setMessage({ kind: 'ok', text: `${LABEL[detecting.axis]} → axis ${found.axis + 1}${found.invert ? ', inverted' : ''}. Run the calibration once all three are set.` });
          setDetecting(undefined);
        } else if (Date.now() > detecting.until) {
          setMessage({ kind: 'warn', text: 'No stick movement seen. Is the radio in USB joystick mode, and was the stick pushed all the way?' });
          setDetecting(undefined);
        }
      }
    }, 100);
    return () => clearInterval(timer);
  }, [readAxes, detecting, calibration, mapping, onMapping]);

  const detect = (axis: StickAxis) => {
    setMessage({ kind: 'info', text: `${PROMPT[axis]}…` });
    setDetecting({ axis, baseline: [...readAxes()], until: Date.now() + 10000 });
  };

  const calibrate = () => {
    if (!calibration) {
      setCalibration('center');
      setMessage({ kind: 'info', text: 'Center all sticks (throttle anywhere), then press Next.' });
    } else if (calibration === 'center') {
      run.current = startCalibration(readAxes());
      setCalibration('sweep');
      setMessage({ kind: 'info', text: 'Move both sticks around every corner a few times, then press Done.' });
    } else {
      if (run.current) onMapping(applyCalibration(mapping, run.current));
      run.current = undefined;
      setCalibration(undefined);
      setMessage({ kind: 'ok', text: 'Calibrated: stick centers read 0 and full deflection reads ±100 %.' });
    }
  };

  return (
    <div className="radio-setup">
      <p className="hint" style={{ marginTop: 0 }}>
        Turn off expo, dual rates and reduced end points on the radio’s model for this, so the simulator sees the raw stick like Betaflight would.
      </p>
      <div className="raw-axes" aria-label="Raw axes">
        {axes.map((v, i) => (
          <div key={i} className="raw-axis">
            <span className="tabular">{i + 1}</span>
            <div className="raw-track">
              <div className="raw-fill" style={{ left: `${Math.min(50, 50 + v * 50)}%`, width: `${Math.abs(v) * 50}%` }} />
            </div>
            <span className="tabular">{v.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <table className="param-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th scope="col">Stick</th>
            <th scope="col">Axis</th>
            <th scope="col">Invert</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {STICK_AXES.map((key) => (
            <tr key={key}>
              <td>{LABEL[key]}</td>
              <td>
                <select aria-label={`${LABEL[key]} axis`} value={mapping[key].axis} onChange={(e) => onMapping({ ...mapping, [key]: { ...mapping[key], axis: Number(e.target.value), min: -1, center: 0, max: 1 } })}>
                  {Array.from({ length: Math.max(pad.axes, mapping[key].axis + 1) }, (_, i) => (
                    <option key={i} value={i}>
                      Axis {i + 1}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="checkbox" aria-label={`Invert ${LABEL[key]}`} checked={mapping[key].invert} onChange={(e) => onMapping({ ...mapping, [key]: { ...mapping[key], invert: e.target.checked } })} />
              </td>
              <td>
                <button type="button" className="btn small" onClick={() => detect(key)} disabled={!!detecting || !!calibration}>
                  Detect
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn small" onClick={calibrate} disabled={!!detecting}>
          {calibration === 'center' ? 'Next' : calibration === 'sweep' ? 'Done' : 'Calibrate'}
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            onMapping(defaultMapping(pad));
            setMessage({ kind: 'info', text: 'Back to the default mapping.' });
          }}
        >
          Reset mapping
        </button>
      </div>
      {message && (
        <div style={{ marginTop: 10 }}>
          <Notice kind={message.kind}>{message.text}</Notice>
        </div>
      )}
    </div>
  );
}
