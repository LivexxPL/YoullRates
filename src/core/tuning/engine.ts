// Wizard answers → firmware-agnostic tune ("canonical tune"). Firmware adapters compile it.
import { estimatePhysics, type PhysicsEstimate } from '../craft/physics';
import { CRAFT_CLASSES_INFO } from '../craft/classes';
import { designRates } from '../rates/designer';
import type { RateSet, Reason, TuneInput } from '../types';
import { planDynamics, type DynamicsPlan } from './dynamics';
import { planFilters, type FilterPlan } from './filters';
import { planPids, STYLE_GAINS, type PidPlan } from './pid';

export interface CanonicalTune {
  input: TuneInput;
  physics: PhysicsEstimate;
  rates: RateSet;
  /** Present for scope 'rates+pids' and 'full'. */
  pids?: PidPlan;
  dynamics?: DynamicsPlan;
  /** Present for scope 'full'. */
  filters?: FilterPlan;
  reasons: Reason[];
  warnings: string[];
}

/**
 * @param customRates rates edited by hand or imported from the pilot's current setup; when given,
 *   PID-side settings that depend on rates (D boost, I-term relax, feedforward limit) follow them.
 */
export function generateTune(input: TuneInput, customRates?: RateSet): CanonicalTune {
  const { craft, style, sliders, rateFeel, scope } = input;
  const physics = estimatePhysics(craft);
  const design = designRates(style, craft.propInches, rateFeel);
  const rates = customRates ?? design.rates;
  const reasons: Reason[] = customRates ? [{ topic: 'Rates', text: 'Using your own rates; the PID side is matched to them.' }] : [...design.reasons];
  const warnings = sanityWarnings(input, physics);

  if (scope === 'rates') return { input, physics, rates, reasons, warnings };

  const pids = planPids(craft, physics, style, sliders, rates);
  const dynamics = planDynamics(craft, physics, style, sliders, rates);
  reasons.push(...pids.reasons, ...dynamics.reasons);
  warnings.push(...pids.warnings);
  if (scope === 'rates+pids') return { input, physics, rates, pids, dynamics, reasons, warnings };

  const filters = planFilters(craft, sliders, STYLE_GAINS[style].d);
  reasons.push(...filters.reasons);
  return { input, physics, rates, pids, dynamics, filters, reasons, warnings };
}

function sanityWarnings(input: TuneInput, physics: PhysicsEstimate): string[] {
  const { craft, style } = input;
  const warnings: string[] = [];
  const info = CRAFT_CLASSES_INFO[craft.classId];
  if (craft.weightGrams < info.weight.min || craft.weightGrams > info.weight.max) {
    warnings.push(`${craft.weightGrams} g is unusual for a ${info.label}; double-check the all-up weight (battery included).`);
  }
  if (physics.twr < 2.5) warnings.push(`Estimated thrust-to-weight is only ${physics.twr.toFixed(1)}:1. Expect sluggish response and little headroom; consider lighter batteries.`);
  if (physics.twr > 20) warnings.push(`Estimated thrust-to-weight is ${physics.twr.toFixed(1)}:1, very high. If the quad feels twitchy, move the lock-in slider left.`);
  if (!craft.rpmFilter && (craft.classId === 'tinywhoop' || craft.classId === 'micro')) {
    warnings.push('Most current whoop and micro ESCs run Bluejay or AM32 with bidirectional DShot; enabling it allows the RPM filter and a much cleaner tune.');
  }
  if (style === 'racing' && craft.linkRateHz < 250) warnings.push(`A ${craft.linkRateHz} Hz radio link adds latency; racing tunes work best at 250 Hz or faster.`);
  if (craft.classId === 'tinywhoop' && craft.motorPoles === 14) warnings.push('Most whoop motors (0702–1103) are 9N12 with 12 magnets; check the motor spec, the RPM filter depends on it.');
  return warnings;
}
