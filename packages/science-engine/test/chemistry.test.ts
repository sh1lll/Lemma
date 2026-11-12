import { describe, expect, it } from 'vitest';
import { answerScience, ELEMENTS, findElement, parseFormula } from '../src';
import { ask, expectNeed, failure, line, show, val } from './helpers';

describe('periodic table', () => {
  it('has all 118 elements in order', () => {
    expect(ELEMENTS).toHaveLength(118);
    ELEMENTS.forEach((e, i) => expect(e.z).toBe(i + 1));
    expect(new Set(ELEMENTS.map((e) => e.symbol)).size).toBe(118);
    expect(ELEMENTS[117]!.symbol).toBe('Og');
  });

  it.each([
    // IUPAC abridged standard atomic weights / conventional values
    ['H', '1.008'], ['C', '12.011'], ['N', '14.007'], ['O', '15.999'], ['Na', '22.990'], ['Cl', '35.45'], ['Ca', '40.078'],
    ['Fe', '55.845'], ['Cu', '63.546'], ['Ag', '107.87'], ['Au', '196.97'], ['Pb', '207.2'], ['U', '238.03'],
  ])('%s weighs %s', (sym, w) => {
    expect(findElement(sym)!.weightText).toBe(w);
  });

  it('uses mass numbers (flagged) for elements with no stable isotope', () => {
    for (const [sym, a] of [['Tc', 97], ['Pm', 145], ['Po', 209], ['Rn', 222], ['Pu', 244], ['Og', 294]] as const) {
      const e = findElement(sym)!;
      expect(e.massNumber).toBe(true);
      expect(e.weight.toNumber()).toBe(a);
    }
    expect(findElement('Bi')!.massNumber).toBe(false);
    expect(ask('atomic mass of technetium').notes.join(' ')).toMatch(/no stable isotope/);
  });

  it('places elements in the table', () => {
    expect([findElement('Fe')!.period, findElement('Fe')!.group]).toEqual([4, 8]);
    expect([findElement('Au')!.period, findElement('Au')!.group]).toEqual([6, 11]);
    expect([findElement('Rn')!.period, findElement('Rn')!.group]).toEqual([6, 18]);
    expect(findElement('Nd')!.group).toBeNull();
  });
});

describe('element lookup', () => {
  it.each([
    ['atomic number of iron', '26'],
    ['what is Fe', 'Iron (Fe)'],
    ['what is iron', 'Iron (Fe)'],
    ['atomic mass of gold', '196.97'],
    ['atomic weight of Cl', '35.45'],
    ['element 26', 'Iron (Fe)'],
    ['which element has atomic number 79', 'Gold (Au)'],
    ['symbol for sodium', 'Na'],
    ['what is the symbol of mercury', 'Hg'],
    ['Fe', 'Iron (Fe)'],
    ['aluminum', 'Aluminium (Al)'],
  ])('%s → %s', (q, expected) => {
    expect(show(q)).toBe(expected);
  });

  it('rejects element 119 and bare English-word symbols', () => {
    expect(failure('element 119').error.message).toMatch(/118/);
    expect(answerScience('He')).toBeNull();
    expect(show('what is He')).toBe('Helium (He)');
  });
});

describe('molar mass', () => {
  it.each([
    ['molar mass of H2O', 18.015],
    ['molar mass of Ca(OH)2', 74.092],
    ['molar mass of CuSO4·5H2O', 249.68],
    ['molar mass of CuSO4*5H2O', 249.68],
    ['molecular weight of NaCl', 58.44],
    ['molar mass of glucose', 180.156],
    ['molar mass of K4[Fe(CN)6]', 368.35],
    ['molar mass of CO2', 44.009],
    ['H2SO4 molar mass', 98.072],
  ])('%s ≈ %d g/mol', (q, expected) => {
    expect(val(q)).toBeCloseTo(expected, 2);
    expect(ask(q).primary.unit).toBe('g/mol');
  });

  it('breaks down the composition by mass', () => {
    const t = ask('molar mass of H2O').table!;
    expect(t.columns).toEqual(['Element', 'Count', 'Atomic weight', 'g/mol', 'Mass %']);
    expect(t.rows[0]).toEqual(['H (Hydrogen)', '2', '1.008', '2.016', '11.19%']);
    expect(t.rows[1]![4]).toBe('88.81%');
  });

  it('parses nested groups and hydrates', () => {
    expect(Object.fromEntries([...parseFormula('K4[Fe(CN)6]')!].map(([k, v]) => [k, Number(v)]))).toEqual({ K: 4, Fe: 1, C: 6, N: 6 });
    expect(Number(parseFormula('CuSO4·5H2O')!.get('O'))).toBe(9);
    expect(parseFormula('Xx2')).toBeNull();
    expect(parseFormula('Ca(OH')).toBeNull();
  });

  it('explains an unknown formula and asks for a missing one', () => {
    expect(failure('molar mass of xyz').error.message).toMatch(/case-sensitive/);
    expectNeed('molar mass of', /which substance/);
  });
});

describe('grams, moles and particles', () => {
  it.each([
    ['moles in 10 g of NaCl', 10 / 58.44],
    ['how many moles in 10 grams of salt', 10 / 58.44],
    ['10 g of NaCl to moles', 10 / 58.44],
    ['grams in 2 mol of H2O', 36.03],
    ['mass of 2 moles of CO2', 88.018],
    ['grams in 500 mmol of glucose', 90.078],
  ])('%s', (q, expected) => {
    expect(val(q)).toBeCloseTo(expected, 3);
  });

  it('counts molecules and atoms with N_A', () => {
    // 1 g / 18.015 g/mol × 6.02214076e23 ≈ 3.343e22
    expect(val('molecules in 1 g of water') / 1e22).toBeCloseTo(3.3429, 3);
    expect(val('how many atoms in 12 g of carbon') / 1e23).toBeCloseTo(6.0166, 3);
    expect(val('atoms in 1 mol of water') / 1e24).toBeCloseTo(1.80664, 4);
    expect(val('moles in 6.02214076e23 molecules of CO2')).toBeCloseTo(1, 10);
  });

  it('leaves plain mass conversions to the unit engine', () => {
    expect(answerScience('50 g to kg')).toBeNull();
    expect(answerScience('2 kg of flour in grams')).toBeNull();
  });
});

describe('balancing equations', () => {
  it.each([
    ['balance Fe + O2 -> Fe2O3', '4Fe + 3O2 → 2Fe2O3'],
    ['balance C3H8 + O2 = CO2 + H2O', 'C3H8 + 5O2 → 3CO2 + 4H2O'],
    ['C3H8 + O2 → CO2 + H2O', 'C3H8 + 5O2 → 3CO2 + 4H2O'],
    ['balance H2 + O2 -> H2O', '2H2 + O2 → 2H2O'],
    ['balance Al + O2 → Al2O3', '4Al + 3O2 → 2Al2O3'],
    ['balance KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2', '2KMnO4 + 16HCl → 2KCl + 2MnCl2 + 8H2O + 5Cl2'],
    ['balance C6H12O6 + O2 -> CO2 + H2O', 'C6H12O6 + 6O2 → 6CO2 + 6H2O'],
    ['balance Ca(OH)2 + H3PO4 -> Ca3(PO4)2 + H2O', '3Ca(OH)2 + 2H3PO4 → Ca3(PO4)2 + 6H2O'],
    ['balance 2Fe + O2 -> Fe2O3', '4Fe + 3O2 → 2Fe2O3'],
  ])('%s', (q, plain) => {
    expect(ask(q).primary.plain).toBe(plain);
  });

  it('balances charge as well as atoms', () => {
    expect(ask('balance Cu + Ag+ -> Cu2+ + Ag').primary.plain).toBe('Cu + 2Ag+ → Cu2+ + 2Ag');
    expect(show('balance Cu + Ag+ -> Cu2+ + Ag')).toBe('Cu + 2Ag⁺ → Cu²⁺ + 2Ag');
  });

  it('shows atom counts per side', () => {
    const t = ask('balance Fe + O2 -> Fe2O3').table!;
    expect(t.rows).toEqual([['Fe', '4', '4'], ['O', '6', '6']]);
  });

  it('says clearly when an equation cannot be balanced', () => {
    expect(failure('balance H2O -> H2O2').error.message).toMatch(/can't be balanced/);
    expect(failure('balance H2 + O2 -> H2O + NaCl').error.message).toMatch(/can't be balanced/);
    expect(failure('balance H2 + O2 -> H2O + H2O2').error.message).toMatch(/more than one/);
    expect(failure('balance Fe + Qq -> FeQq').error.message).toMatch(/isn't a chemical formula/);
  });

  it('ignores equations that are not reactions', () => {
    expect(answerScience('x = 5')).toBeNull();
  });
});

describe('pH at 25 °C', () => {
  it.each([
    ['pH of 1e-3 M H+', 3],
    ['pH of 0.001 M HCl', 3],
    ['ph of 1.5 x 10^-4 M H+', 3.8239],
    ['pH of 0.01 M NaOH', 12],
    ['pOH of 0.01 M NaOH', 2],
    ['pH of 0.005 M Ca(OH)2', 12],
    ['pH when [OH-] = 1e-4', 10],
    ['pOH 4', 10], // pH = 14 − pOH
  ])('%s → %d', (q, expected) => {
    expect(val(q)).toBeCloseTo(expected, 4);
  });

  it('converts a pH back to concentrations', () => {
    expect(val('[H+] at pH 4.5')).toBeCloseTo(3.1623e-5, 9);
    expect(val('what is [OH-] at pH 9')).toBeCloseTo(1e-5, 12);
    expect(line('pH 3', '[OH⁻]')).toBe('1 × 10⁻¹¹ M');
  });

  it('states the 25 °C assumption and asks about weak acids', () => {
    expect(ask('pH of 0.001 M HCl').notes.join(' ')).toMatch(/25 °C/);
    expectNeed('pH of 0.1 M acetic acid', /Ka/);
  });
});

describe('molarity', () => {
  it.each([
    ['molarity of 0.5 mol in 2 L', 0.25],
    ['molarity of 10 g NaCl in 500 mL', 10 / 58.44 / 0.5],
    ['moles in 2 L of 0.5 M', 1],
    ['grams of NaCl needed for 500 mL of 0.1 M solution', 2.922],
    ['volume of 0.5 M solution containing 2 mol', 4],
  ])('%s', (q, expected) => {
    expect(val(q)).toBeCloseTo(expected, 4);
  });

  it('asks for the missing quantity', () => {
    expectNeed('molarity of 2 mol', /volume/);
  });
});

describe('dilution C1V1 = C2V2', () => {
  it.each([
    ['dilute 50 mL of 2 M to 0.5 M', 200, 'mL'],
    ['how much 12 M HCl to make 1 L of 1 M', 1 / 12, 'L'],
    ['dilute 100 mL of 6 M HCl to 500 mL', 1.2, 'M'],
    ['c1=2 v1=50 mL c2=0.5', 200, 'mL'],
  ])('%s', (q, expected, unit) => {
    expect(val(q)).toBeCloseTo(expected, 6);
    expect(ask(q).primary.unit).toBe(unit);
  });

  it('needs three of the four values', () => {
    expectNeed('dilute 2 M to 0.5 M', /three of the four/);
  });
});

describe('ideal gas law', () => {
  it.each([
    // 22.414 L/mol at 0 °C and 1 atm; nRT/V with R = 0.082057 L·atm/(mol·K)
    ['volume of 1 mol of gas at STP', 22.414, 'L'],
    ['pressure of 2 mol of gas at 300 K in 10 L', (2 * 0.0820574 * 300) / 10, 'atm'],
    ['volume of 2 mol gas at 25 °C and 1 atm', 2 * 0.0820574 * 298.15, 'L'],
    ['ideal gas n with P=1 atm V=22.4 L T=273.15 K', 22.4 / (0.0820574 * 273.15), 'mol'],
    ['temperature of 1 mol gas at 101.325 kPa in 22.4 L', 22.4 / 0.0820574, 'K'],
    ['moles of gas in 500 mL at 760 torr and 0 °C', 0.5 / 22.414, 'mol'],
  ])('%s', (q, expected, unit) => {
    expect(val(q)).toBeCloseTo(expected, 2);
    expect(ask(q).primary.unit).toBe(unit);
  });

  it('records the units used', () => {
    expect(ask('volume of 2 mol gas at 25 °C and 1 atm').notes.join(' ')).toMatch(/25 °C = 298.15 K/);
  });

  it('asks when more than one variable is missing', () => {
    expectNeed('volume of gas at 300 K', /three of P, V, n and T/);
  });
});
