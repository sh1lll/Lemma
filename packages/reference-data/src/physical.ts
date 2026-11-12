import { D, type Dec } from '@lemma/math-core';
import { CONSTANTS } from '@lemma/science-engine/src/constants';
import { EXTRA_CONSTANTS } from './data/math';

/**
 * Every physical constant: science-engine's CODATA 2018 list plus the extra CODATA values bundled here.
 * Kept out of index.ts because science-engine's constants module pulls in the unit engine.
 */
export interface PhysicalConstant {
  key: string;
  name: string;
  symbol: string;
  value: Dec;
  unit: string;
  uncertainty: string | null;
}

export const PHYSICAL_CONSTANTS: PhysicalConstant[] = [
  ...CONSTANTS.map((c) => ({ key: c.key, name: c.name, symbol: c.symbol, value: c.value, unit: c.unit, uncertainty: c.uncertainty })),
  ...EXTRA_CONSTANTS.map((c) => ({ key: c.key, name: c.name, symbol: c.symbol, value: new D(c.value), unit: c.unit, uncertainty: c.uncertainty })),
];
