import type { Dec } from '@lemma/math-core';
import { ELEMENTS as BASE } from '@lemma/science-engine/src/elements';

/** Source note shared by every element answer. */
export const ELEMENT_SOURCE = {
  name: 'PubChem Periodic Table; IUPAC standard atomic weights; CRC Handbook of Chemistry and Physics',
  url: 'https://pubchem.ncbi.nlm.nih.gov/periodic-table/',
  asOf: '2021',
};

export type ElementCategory =
  | 'alkali metal'
  | 'alkaline earth metal'
  | 'transition metal'
  | 'post-transition metal'
  | 'metalloid'
  | 'nonmetal'
  | 'halogen'
  | 'noble gas'
  | 'lanthanide'
  | 'actinide';

export interface ElementInfo {
  z: number;
  symbol: string;
  name: string;
  /** Standard atomic weight (or the mass number of the longest-lived isotope, see {@link massNumber}). */
  mass: Dec;
  massText: string;
  massNumber: boolean;
  category: ElementCategory;
  group: number | null;
  period: number;
  block: 's' | 'p' | 'd' | 'f';
  /** Short (noble-gas core) ground-state configuration, plain digits: "[Ar] 3d6 4s2". */
  config: string;
  /** Configuration is a prediction (superheavy elements). */
  configPredicted: boolean;
  /** Pauling electronegativity, when an established value exists. */
  en?: string;
  /** g/cm³ for solids and liquids near room temperature; g/L at 0 °C and 1 atm for gases. */
  density?: string;
  /** Kelvin, at 1 atm. */
  mp?: string;
  bp?: string;
  /** Sublimation point in kelvin, for elements with no liquid phase at 1 atm. */
  sub?: string;
  state?: 'solid' | 'liquid' | 'gas';
  year?: number;
  note?: string;
}

const CAT: Record<string, ElementCategory> = {
  a: 'alkali metal', b: 'alkaline earth metal', t: 'transition metal', p: 'post-transition metal', m: 'metalloid',
  n: 'nonmetal', h: 'halogen', g: 'noble gas', l: 'lanthanide', c: 'actinide',
};

// category;configuration;electronegativity;density;melting K;boiling K;year discovered — one row per element, in order.
// Empty fields are values that are unknown, only predicted, or not well established; they are left out rather than guessed.
const ROWS =
  'n;1s1;2.20;0.08988;13.99;20.271;1766|g;1s2;;0.1786;;4.222;1868|a;[He] 2s1;0.98;0.534;453.65;1603;1817|' +
  'b;[He] 2s2;1.57;1.85;1560;2742;1798|m;[He] 2s2 2p1;2.04;2.34;2349;4200;1808|n;[He] 2s2 2p2;2.55;2.267;;;|' +
  'n;[He] 2s2 2p3;3.04;1.2506;63.15;77.355;1772|n;[He] 2s2 2p4;3.44;1.429;54.36;90.188;1774|' +
  'h;[He] 2s2 2p5;3.98;1.696;53.48;85.03;1886|g;[He] 2s2 2p6;;0.9002;24.56;27.104;1898|' +
  'a;[Ne] 3s1;0.93;0.968;370.944;1156.090;1807|b;[Ne] 3s2;1.31;1.738;923;1363;1755|' +
  'p;[Ne] 3s2 3p1;1.61;2.70;933.47;2743;1825|m;[Ne] 3s2 3p2;1.90;2.329;1687;3538;1824|' +
  'n;[Ne] 3s2 3p3;2.19;1.823;317.3;553.7;1669|n;[Ne] 3s2 3p4;2.58;2.07;388.36;717.8;|' +
  'h;[Ne] 3s2 3p5;3.16;3.2;171.6;239.11;1774|g;[Ne] 3s2 3p6;;1.784;83.81;87.302;1894|' +
  'a;[Ar] 4s1;0.82;0.862;336.7;1032;1807|b;[Ar] 4s2;1.00;1.55;1115;1757;1808|' +
  't;[Ar] 3d1 4s2;1.36;2.985;1814;3109;1879|t;[Ar] 3d2 4s2;1.54;4.506;1941;3560;1791|' +
  't;[Ar] 3d3 4s2;1.63;6.0;2183;3680;1801|t;[Ar] 3d5 4s1;1.66;7.19;2180;2944;1797|' +
  't;[Ar] 3d5 4s2;1.55;7.21;1519;2334;1774|t;[Ar] 3d6 4s2;1.83;7.874;1811;3134;|' +
  't;[Ar] 3d7 4s2;1.88;8.90;1768;3200;1735|t;[Ar] 3d8 4s2;1.91;8.908;1728;3003;1751|' +
  't;[Ar] 3d10 4s1;1.90;8.96;1357.77;2835;|t;[Ar] 3d10 4s2;1.65;7.14;692.68;1180;|' +
  'p;[Ar] 3d10 4s2 4p1;1.81;5.91;302.9146;2673;1875|m;[Ar] 3d10 4s2 4p2;2.01;5.323;1211.40;3106;1886|' +
  'm;[Ar] 3d10 4s2 4p3;2.18;5.727;;;|n;[Ar] 3d10 4s2 4p4;2.55;4.81;494;958;1817|' +
  'h;[Ar] 3d10 4s2 4p5;2.96;3.1028;265.8;332.0;1826|g;[Ar] 3d10 4s2 4p6;3.00;3.749;115.78;119.93;1898|' +
  'a;[Kr] 5s1;0.82;1.532;312.45;961;1861|b;[Kr] 5s2;0.95;2.64;1050;1655;1790|' +
  't;[Kr] 4d1 5s2;1.22;4.472;1799;3203;1794|t;[Kr] 4d2 5s2;1.33;6.52;2128;4650;1789|' +
  't;[Kr] 4d4 5s1;1.6;8.57;2750;5017;1801|t;[Kr] 4d5 5s1;2.16;10.28;2896;4912;1778|' +
  't;[Kr] 4d5 5s2;1.9;11;2430;4538;1937|t;[Kr] 4d7 5s1;2.2;12.45;2607;4423;1844|' +
  't;[Kr] 4d8 5s1;2.28;12.41;2237;3968;1803|t;[Kr] 4d10;2.20;12.023;1828.05;3236;1803|' +
  't;[Kr] 4d10 5s1;1.93;10.49;1234.93;2435;|t;[Kr] 4d10 5s2;1.69;8.65;594.22;1040;1817|' +
  'p;[Kr] 4d10 5s2 5p1;1.78;7.31;429.7485;2345;1863|p;[Kr] 4d10 5s2 5p2;1.96;7.265;505.08;2875;|' +
  'm;[Kr] 4d10 5s2 5p3;2.05;6.697;903.78;1908;|m;[Kr] 4d10 5s2 5p4;2.1;6.24;722.66;1261;1782|' +
  'h;[Kr] 4d10 5s2 5p5;2.66;4.933;386.85;457.4;1811|g;[Kr] 4d10 5s2 5p6;2.6;5.894;161.40;165.051;1898|' +
  'a;[Xe] 6s1;0.79;1.93;301.7;944;1860|b;[Xe] 6s2;0.89;3.51;1000;2118;1808|' +
  'l;[Xe] 5d1 6s2;1.10;6.162;1193;3737;1839|l;[Xe] 4f1 5d1 6s2;1.12;6.770;1068;3716;1803|' +
  'l;[Xe] 4f3 6s2;1.13;6.77;1208;3403;1885|l;[Xe] 4f4 6s2;1.14;7.01;1297;3347;1885|' +
  'l;[Xe] 4f5 6s2;;7.26;1315;3273;1945|l;[Xe] 4f6 6s2;1.17;7.52;1345;2173;1879|' +
  'l;[Xe] 4f7 6s2;;5.264;1099;1802;1901|l;[Xe] 4f7 5d1 6s2;1.20;7.90;1585;3546;1880|' +
  'l;[Xe] 4f9 6s2;;8.23;1629;3396;1843|l;[Xe] 4f10 6s2;1.22;8.540;1680;2840;1886|' +
  'l;[Xe] 4f11 6s2;1.23;8.79;1734;2873;1878|l;[Xe] 4f12 6s2;1.24;9.066;1802;3141;1843|' +
  'l;[Xe] 4f13 6s2;1.25;9.32;1818;2223;1879|l;[Xe] 4f14 6s2;;6.90;1097;1469;1878|' +
  'l;[Xe] 4f14 5d1 6s2;1.27;9.841;1925;3675;1907|t;[Xe] 4f14 5d2 6s2;1.3;13.31;2506;4876;1923|' +
  't;[Xe] 4f14 5d3 6s2;1.5;16.69;3290;5731;1802|t;[Xe] 4f14 5d4 6s2;2.36;19.25;3695;6203;1783|' +
  't;[Xe] 4f14 5d5 6s2;1.9;21.02;3459;5869;1925|t;[Xe] 4f14 5d6 6s2;2.2;22.59;3306;5285;1803|' +
  't;[Xe] 4f14 5d7 6s2;2.20;22.56;2719;4403;1803|t;[Xe] 4f14 5d9 6s1;2.28;21.45;2041.4;4098;|' +
  't;[Xe] 4f14 5d10 6s1;2.54;19.3;1337.33;3243;|t;[Xe] 4f14 5d10 6s2;2.00;13.534;234.3210;629.88;|' +
  'p;[Xe] 4f14 5d10 6s2 6p1;1.62;11.85;577;1746;1861|p;[Xe] 4f14 5d10 6s2 6p2;2.33;11.34;600.61;2022;|' +
  'p;[Xe] 4f14 5d10 6s2 6p3;2.02;9.78;544.7;1837;|m;[Xe] 4f14 5d10 6s2 6p4;2.0;9.196;527;1235;1898|' +
  'h;[Xe] 4f14 5d10 6s2 6p5;2.2;;;;1940|g;[Xe] 4f14 5d10 6s2 6p6;;9.73;202;211.5;1900|' +
  'a;[Rn] 7s1;;;;;1939|b;[Rn] 7s2;0.9;5.5;973;2010;1898|c;[Rn] 6d1 7s2;1.1;10.07;;;1899|' +
  'c;[Rn] 6d2 7s2;1.3;11.7;2023;5061;1829|c;[Rn] 5f2 6d1 7s2;1.5;15.37;1841;;1913|' +
  'c;[Rn] 5f3 6d1 7s2;1.38;19.1;1405.3;4404;1789|c;[Rn] 5f4 6d1 7s2;1.36;20.45;912;;1940|' +
  'c;[Rn] 5f6 7s2;1.28;19.816;912.5;3505;1940|c;[Rn] 5f7 7s2;;;1449;;1944|c;[Rn] 5f7 6d1 7s2;;13.51;1613;3383;1944|' +
  'c;[Rn] 5f9 7s2;;14.78;1259;;1949|c;[Rn] 5f10 7s2;;15.1;1173;;1950|c;[Rn] 5f11 7s2;;;1133;;1952|' +
  'c;[Rn] 5f12 7s2;;;;;1952|c;[Rn] 5f13 7s2;;;;;1955|c;[Rn] 5f14 7s2;;;;;1958|c;[Rn] 5f14 7s2 7p1;;;;;1961|' +
  't;[Rn] 5f14 6d2 7s2;;;;;|t;[Rn] 5f14 6d3 7s2;;;;;|t;[Rn] 5f14 6d4 7s2;;;;;1974|t;[Rn] 5f14 6d5 7s2;;;;;1981|' +
  't;[Rn] 5f14 6d6 7s2;;;;;1984|t;[Rn] 5f14 6d7 7s2;;;;;1982|t;[Rn] 5f14 6d8 7s2;;;;;1994|' +
  't;[Rn] 5f14 6d9 7s2;;;;;1994|t;[Rn] 5f14 6d10 7s2;;;;;1996|p;[Rn] 5f14 6d10 7s2 7p1;;;;;|' +
  'p;[Rn] 5f14 6d10 7s2 7p2;;;;;|p;[Rn] 5f14 6d10 7s2 7p3;;;;;|p;[Rn] 5f14 6d10 7s2 7p4;;;;;|' +
  'h;[Rn] 5f14 6d10 7s2 7p5;;;;;2010|g;[Rn] 5f14 6d10 7s2 7p6;;;;;';

const GASES = new Set([1, 2, 7, 8, 9, 10, 17, 18, 36, 54, 86]);
const LIQUIDS = new Set([35, 80]);
const SUBLIMES: Record<number, string> = { 6: '3915', 33: '887' };
const NOTES: Record<number, string> = {
  2: 'Helium does not solidify at normal pressure',
  6: 'Density of graphite; carbon sublimes rather than melts at normal pressure',
  15: 'Values for white phosphorus',
  16: 'Values for rhombic (alpha) sulfur',
  33: 'Grey arsenic; it sublimes at normal pressure',
  50: 'White (beta) tin',
};

export const ELEMENTS: ElementInfo[] = ROWS.split('|').map((row, i) => {
  const base = BASE[i]!;
  const [cat = 'n', config = '', en, density, mp, bp, year] = row.split(';');
  const z = i + 1;
  const e: ElementInfo = {
    z,
    symbol: base.symbol,
    name: base.name,
    mass: base.weight,
    massText: base.weightText,
    massNumber: base.massNumber,
    category: CAT[cat]!,
    group: base.group,
    period: base.period,
    block: base.block,
    config,
    configPredicted: z >= 104,
  };
  if (en) e.en = en;
  if (density) e.density = density;
  if (mp) e.mp = mp;
  if (bp) e.bp = bp;
  if (year) e.year = Number(year);
  if (SUBLIMES[z]) e.sub = SUBLIMES[z];
  if (NOTES[z]) e.note = NOTES[z];
  if (z < 100) e.state = GASES.has(z) ? 'gas' : LIQUIDS.has(z) ? 'liquid' : 'solid';
  return e;
});

export const ELEMENT_ALIASES: Record<string, string> = { aluminum: 'Al', sulphur: 'S', cesium: 'Cs', wolfram: 'W' };
