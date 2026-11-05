// The four size categories of the wizard, with the defaults and ranges each one offers.
import type { CraftClassId, CraftSpec, FlightStyle, FrameType } from '../types';

export interface PropOption {
  inches: number;
  label: string;
}

export interface CraftClassInfo {
  id: CraftClassId;
  label: string;
  tagline: string;
  description: string;
  props: readonly PropOption[];
  defaultProp: number;
  cells: readonly number[];
  defaultCells: number;
  /** All-up weight slider range and default (grams). */
  weight: { min: number; max: number; step: number; default: number };
  frames: readonly FrameType[];
  defaultFrame: FrameType;
  defaultMotorPoles: number;
  defaultStyle: FlightStyle;
}

const mm = (millimetres: number): PropOption => ({ inches: Math.round((millimetres / 25.4) * 100) / 100, label: `${millimetres} mm` });
const inch = (inches: number): PropOption => ({ inches, label: `${inches}"` });

export const CRAFT_CLASSES_INFO: Record<CraftClassId, CraftClassInfo> = {
  tinywhoop: {
    id: 'tinywhoop',
    label: 'Tinywhoop',
    tagline: '65–75 mm, 1S–2S',
    description: 'Ducted indoor whoops on 31–40 mm props. Light, bouncy, high motor RPM.',
    props: [mm(31), mm(35), mm(40), mm(45)],
    defaultProp: 1.22,
    cells: [1, 2],
    defaultCells: 1,
    weight: { min: 15, max: 60, step: 1, default: 28 },
    frames: ['ducted'],
    defaultFrame: 'ducted',
    defaultMotorPoles: 12,
    defaultStyle: 'freestyle',
  },
  micro: {
    id: 'micro',
    label: 'Micro / Cinewhoop',
    tagline: '2.5"–3.5"',
    description: 'Ducted cinewhoops carrying a camera, or open-prop micros and toothpicks.',
    props: [inch(2.5), inch(3), inch(3.5)],
    defaultProp: 3,
    cells: [3, 4, 6],
    defaultCells: 4,
    weight: { min: 80, max: 700, step: 5, default: 380 },
    frames: ['ducted', 'open'],
    defaultFrame: 'ducted',
    defaultMotorPoles: 14,
    defaultStyle: 'cinematic',
  },
  mini: {
    id: 'mini',
    label: 'Standard 5"',
    tagline: '4"–6" freestyle and racing',
    description: 'The classic miniquad: 2207-class motors on 4S–6S, freestyle or race builds.',
    props: [inch(4), inch(5), inch(5.1), inch(5.5), inch(6)],
    defaultProp: 5.1,
    cells: [4, 6],
    defaultCells: 6,
    weight: { min: 300, max: 1000, step: 5, default: 650 },
    frames: ['open'],
    defaultFrame: 'open',
    defaultMotorPoles: 14,
    defaultStyle: 'freestyle',
  },
  macro: {
    id: 'macro',
    label: 'Macro / Long range',
    tagline: '7" and above',
    description: 'Long-range and X-class quads: big slow props, heavy batteries, lots of inertia.',
    props: [inch(7), inch(8), inch(9), inch(10), inch(13)],
    defaultProp: 7,
    cells: [4, 6, 8],
    defaultCells: 6,
    weight: { min: 600, max: 4000, step: 10, default: 1000 },
    frames: ['open'],
    defaultFrame: 'open',
    defaultMotorPoles: 14,
    defaultStyle: 'cinematic',
  },
};

/** Typical weight for a style within a class (racers are lighter, freestyle carries a camera). */
export function suggestedWeight(classId: CraftClassId, style: FlightStyle, frame: FrameType): number {
  switch (classId) {
    case 'tinywhoop':
      return 28;
    case 'micro':
      return frame === 'ducted' ? (style === 'racing' ? 300 : 380) : style === 'cinematic' ? 220 : 160;
    case 'mini':
      return style === 'racing' ? 520 : style === 'cinematic' ? 720 : 650;
    case 'macro':
      return style === 'racing' ? 850 : 1000;
  }
}

export function defaultCraft(classId: CraftClassId): CraftSpec {
  const info = CRAFT_CLASSES_INFO[classId];
  return {
    classId,
    propInches: info.defaultProp,
    frame: info.defaultFrame,
    weightGrams: info.weight.default,
    cells: info.defaultCells,
    motorKv: undefined,
    motorPoles: info.defaultMotorPoles,
    rpmFilter: true,
    noise: 2,
    linkRateHz: 500,
  };
}
