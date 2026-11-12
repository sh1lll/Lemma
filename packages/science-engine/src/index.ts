import { MathError, type AnswerResult } from '@lemma/math-core';
import { balance } from './balance';
import { bases } from './bases';
import { elementLookup, molarMassH, moles } from './chemistry';
import { CONSTANT_NAMES_SRC, CONSTANT_SYMBOLS_SRC, constantLookup } from './constants';
import { ELEMENT_NAMES_SRC } from './elements';
import { hypotenuse, points, shapes, triangle } from './geometry';
import { electrical, monomialHandlers, projectile, suvat } from './physics';
import { dilution, idealGas, molarity, ph } from './solutions';
import { normalise, type Ctx, type Handler, type Kind } from './util';

export { ELEMENTS, findElement, type Element } from './elements';
export { CONSTANTS, type PhysConst } from './constants';
export { parseFormula, molarMass, resolveSubstance } from './formula';
export { solveTriangle } from './geometry';

// Order matters: whole-phrase lookups and unmistakable syntax first, broad keyword handlers last.
const HANDLERS: [Kind, Handler][] = [
  ['bases', bases],
  ['physics', constantLookup],
  ['chemistry', molarMassH],
  ['chemistry', dilution],
  ['chemistry', balance],
  ['chemistry', ph],
  ['chemistry', idealGas],
  ['chemistry', molarity],
  ['chemistry', moles],
  ['geometry', points],
  ['geometry', hypotenuse],
  ['physics', projectile],
  ...monomialHandlers.map((h) => ['physics', h] as [Kind, Handler]),
  ['physics', electrical],
  ['physics', suvat],
  ['geometry', triangle],
  ['geometry', shapes],
  ['chemistry', elementLookup],
];

/**
 * Number bases, chemistry, physics and geometry questions. Returns null when the input is none of these,
 * so plain arithmetic ("5 + 5"), percentages and unit conversions fall through to their own engines.
 */
export function answerScience(input: string): AnswerResult | null {
  // Science questions are sentences; very long inputs (pasted data, digit runs) are never ours, and declining
  // them bounds the cost of the many pattern matches below.
  if (input.length > 1500) return null;
  const t = normalise(input);
  if (!t) return null;
  const c: Ctx = { input, t, s: t.toLowerCase() };
  if (c.s.length !== t.length) c.s = t.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  for (const [kind, h] of HANDLERS) {
    try {
      const r = h(c);
      if (r) return r;
    } catch (e) {
      return { ok: false, kind, input, error: new MathError('domain', e instanceof Error ? e.message : String(e)) };
    }
  }
  return null;
}

/** Cheap pre-check: true for every phrasing {@link answerScience} supports (and some it doesn't). */
export const LOOKS_LIKE_SCIENCE = new RegExp(
  [
    // bases
    String.raw`\b(?:hex|hexadecimal|binary|bin|octal|oct|decimal|dec|base[\s-]?\d{1,2})\b|\b0[xbo][0-9a-f]`,
    // chemistry
    String.raw`\d\s*(?:m|mm|molar)\b|\b[a-z]{1,2}[12]?\s*=\s*[-+.\d]|\b(?:molar|molarity|mol|mols|moles?|mmol|millimoles?|molecules?|atoms?|particles?|formula units?|ions?|molecular|formula|balance|equation|ph|poh|hydronium|hydroxide|concentration|solution|dilut\w*|stock|c1\s*v1|c1v1|m1v1|ideal gas|gas|stp|pv|atomic|element|symbol|protons?|period|group|mass number|weight|mw)\b|->|→|⟶|=>|⇌|\[h|\[oh|h\+|oh-`,
    // physics
    String.raw`\b(?:speed|velocity|light|constant|charge|mass|energy|kinetic|potential|ke|pe|gpe|force|weigh\w*|momentum|ohm\w*|volt\w*|voltage|current|resist\w*|power|watts?|amps?|amperes?|waves?|wavelength|frequency|lambda|density|rho|accelerat\w*|decelerat\w*|rest|stops?|brakes?|braking|displacement|distance|travel\w*|reach\w*|fall\w*|falls|dropped|free.?fall|suvat|kinematics?|projectile|launch\w*|thrown|throws?|fired|kicked|shot|cannon|range|how long|how far|how fast|how high|newton\w*|joules?|hertz|gravity|gravitational|permittivity|permeability|planck\w*|avogadro\w*|boltzmann|faraday\w*|rydberg|stefan|atmosphere|electron|proton|neutron|epsilon|mu|hbar|h bar)\b|[ΩΩλρμεħσ]|\b(?:what(?:'s| is)|value of)\s+\S{1,7}$`,
    // geometry
    String.raw`\b(?:area|perimeter|circumference|volume|surface|diagonal|lateral|hypotenuse|pythag\w*|legs?|midpoint|slope|gradient|line|triangle|circle|disc|disk|square|rectangle|trapezoid|trapezium|parallelogram|ellipse|oval|polygon|pentagon|hexagon|heptagon|septagon|octagon|nonagon|decagon|hendecagon|dodecagon|sphere|hemisphere|ball|cylinder|cone|cube|cuboid|prism|box|pyramid|radius|diameter|sides?|angles?)\b|\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)`,
    // elements by name, constants by phrase, and bare symbols like "Fe"
    `\\b(?:${ELEMENT_NAMES_SRC})\\b`,
    `\\b(?:${CONSTANT_NAMES_SRC})\\b`,
    // a constant's symbol converted to other units: "g in ft/s^2", "c in km/h"
    `^\\s*(?:(?:what(?:'s| is)|value of)\\s+)?(?:${CONSTANT_SYMBOLS_SRC})\\s+(?:in|to|into|as)\\s`,
    String.raw`^\s*[A-Z][a-z]?\s*$`,
  ].join('|'),
  'i',
);
