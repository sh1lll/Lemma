import { D, type Dec } from '@lemma/math-core';

export interface Element {
  z: number;
  symbol: string;
  name: string;
  /** Standard atomic weight (IUPAC abridged / conventional value), or the mass number of the longest-lived isotope. */
  weight: Dec;
  weightText: string;
  /** True when {@link weight} is a mass number because the element has no stable isotope and no standard atomic weight. */
  massNumber: boolean;
  period: number;
  /** IUPAC group 1–18; null for the lanthanides and actinides (f-block). */
  group: number | null;
  block: 's' | 'p' | 'd' | 'f';
}

// Symbol, name, weight. Bracketed values are mass numbers of the longest-lived isotope (no standard atomic weight).
// Weights: IUPAC abridged standard atomic weights (conventional values for interval elements: H, Li, B, C, N, O, Mg, Si, S, Cl, Br, Tl).
const DATA =
  'H Hydrogen 1.008|He Helium 4.0026|Li Lithium 6.94|Be Beryllium 9.0122|B Boron 10.81|C Carbon 12.011|N Nitrogen 14.007|O Oxygen 15.999|' +
  'F Fluorine 18.998|Ne Neon 20.180|Na Sodium 22.990|Mg Magnesium 24.305|Al Aluminium 26.982|Si Silicon 28.085|P Phosphorus 30.974|' +
  'S Sulfur 32.06|Cl Chlorine 35.45|Ar Argon 39.95|K Potassium 39.098|Ca Calcium 40.078|Sc Scandium 44.956|Ti Titanium 47.867|' +
  'V Vanadium 50.942|Cr Chromium 51.996|Mn Manganese 54.938|Fe Iron 55.845|Co Cobalt 58.933|Ni Nickel 58.693|Cu Copper 63.546|' +
  'Zn Zinc 65.38|Ga Gallium 69.723|Ge Germanium 72.630|As Arsenic 74.922|Se Selenium 78.971|Br Bromine 79.904|Kr Krypton 83.798|' +
  'Rb Rubidium 85.468|Sr Strontium 87.62|Y Yttrium 88.906|Zr Zirconium 91.224|Nb Niobium 92.906|Mo Molybdenum 95.95|Tc Technetium [97]|' +
  'Ru Ruthenium 101.07|Rh Rhodium 102.91|Pd Palladium 106.42|Ag Silver 107.87|Cd Cadmium 112.41|In Indium 114.82|Sn Tin 118.71|' +
  'Sb Antimony 121.76|Te Tellurium 127.60|I Iodine 126.90|Xe Xenon 131.29|Cs Caesium 132.91|Ba Barium 137.33|La Lanthanum 138.91|' +
  'Ce Cerium 140.12|Pr Praseodymium 140.91|Nd Neodymium 144.24|Pm Promethium [145]|Sm Samarium 150.36|Eu Europium 151.96|' +
  'Gd Gadolinium 157.25|Tb Terbium 158.93|Dy Dysprosium 162.50|Ho Holmium 164.93|Er Erbium 167.26|Tm Thulium 168.93|Yb Ytterbium 173.05|' +
  'Lu Lutetium 174.97|Hf Hafnium 178.49|Ta Tantalum 180.95|W Tungsten 183.84|Re Rhenium 186.21|Os Osmium 190.23|Ir Iridium 192.22|' +
  'Pt Platinum 195.08|Au Gold 196.97|Hg Mercury 200.59|Tl Thallium 204.38|Pb Lead 207.2|Bi Bismuth 208.98|Po Polonium [209]|' +
  'At Astatine [210]|Rn Radon [222]|Fr Francium [223]|Ra Radium [226]|Ac Actinium [227]|Th Thorium 232.04|Pa Protactinium 231.04|' +
  'U Uranium 238.03|Np Neptunium [237]|Pu Plutonium [244]|Am Americium [243]|Cm Curium [247]|Bk Berkelium [247]|Cf Californium [251]|' +
  'Es Einsteinium [252]|Fm Fermium [257]|Md Mendelevium [258]|No Nobelium [259]|Lr Lawrencium [266]|Rf Rutherfordium [267]|' +
  'Db Dubnium [268]|Sg Seaborgium [269]|Bh Bohrium [270]|Hs Hassium [269]|Mt Meitnerium [278]|Ds Darmstadtium [281]|' +
  'Rg Roentgenium [282]|Cn Copernicium [285]|Nh Nihonium [286]|Fl Flerovium [289]|Mc Moscovium [290]|Lv Livermorium [293]|' +
  'Ts Tennessine [294]|Og Oganesson [294]';

const PERIOD_ENDS = [2, 10, 18, 36, 54, 86, 118];

function position(z: number): Pick<Element, 'period' | 'group' | 'block'> {
  const period = PERIOD_ENDS.findIndex((end) => z <= end) + 1;
  const start = period === 1 ? 1 : PERIOD_ENDS[period - 2]! + 1;
  const p = z - start + 1;
  if (period === 1) return { period, group: z === 1 ? 1 : 18, block: 's' };
  if (period <= 3) return { period, group: p <= 2 ? p : p + 10, block: p <= 2 ? 's' : 'p' };
  if (period <= 5) return { period, group: p, block: p <= 2 ? 's' : p <= 12 ? 'd' : 'p' };
  // Periods 6–7: La–Lu / Ac–Lr form the f-block row.
  if (p <= 2) return { period, group: p, block: 's' };
  if (p <= 17) return { period, group: null, block: 'f' };
  const group = p - 14;
  return { period, group, block: group <= 12 ? 'd' : 'p' };
}

export const ELEMENTS: Element[] = DATA.split('|').map((row, i) => {
  const [symbol = '', name = '', w = ''] = row.split(' ');
  const massNumber = w.startsWith('[');
  const weightText = massNumber ? w.slice(1, -1) : w;
  return { z: i + 1, symbol, name, weight: new D(weightText), weightText, massNumber, ...position(i + 1) };
});

export const BY_SYMBOL = new Map(ELEMENTS.map((e) => [e.symbol, e]));

const ALT_NAMES: Record<string, string> = { aluminum: 'Al', sulphur: 'S', cesium: 'Cs', wolfram: 'W' };
export const BY_NAME = new Map<string, Element>([
  ...ELEMENTS.map((e) => [e.name.toLowerCase(), e] as const),
  ...Object.entries(ALT_NAMES).map(([n, s]) => [n, BY_SYMBOL.get(s)!] as const),
]);

export const ELEMENT_NAMES_SRC = [...BY_NAME.keys()].sort((a, b) => b.length - a.length).join('|');

/** By name (any case) or symbol (exact case). */
export function findElement(text: string): Element | undefined {
  const t = text.trim();
  return BY_NAME.get(t.toLowerCase()) ?? BY_SYMBOL.get(t);
}
