import { D, type Dec } from '@lemma/math-core';

export type Dimension =
  | 'length' | 'mass' | 'time' | 'volume' | 'area' | 'speed' | 'data' | 'energy' | 'power' | 'pressure' | 'angle' | 'frequency' | 'temperature'
  /** Built on the fly from other units ("ft/s^2", "eV s"); see compound.ts. */
  | 'derived';

/** Exponents of length, mass, time, temperature, amount of substance. */
export type Dims = [number, number, number, number, number];

export interface UnitDef {
  id: string;
  dimension: Dimension;
  /** Display symbol. */
  symbol: string;
  singular: string;
  plural: string;
  /** Size in the dimension's base unit (m, kg, s, m³, m², m/s, byte, J, W, Pa, rad, Hz). Absent for affine units. */
  factor?: Dec;
  /** Affine conversion for temperature: base is kelvin. */
  toBase?: (x: Dec) => Dec;
  fromBase?: (x: Dec) => Dec;
  aliases: string[];
  note?: string;
  /** Dimension vector, set on derived units. */
  dims?: Dims;
}

const PI = D.acos(-1);
const n = (v: string | number) => new D(v);

type Spec = [id: string, symbol: string, singular: string, plural: string, factor: Dec, aliases?: string[], note?: string];

function family(dimension: Dimension, specs: Spec[]): UnitDef[] {
  return specs.map(([id, symbol, singular, plural, factor, aliases = [], note]) => ({
    id, dimension, symbol, singular, plural, factor, note,
    aliases: [id, symbol.toLowerCase(), singular, plural, ...aliases],
  }));
}

const US = 'US customary';

export const UNITS: UnitDef[] = [
  ...family('length', [
    ['nm', 'nm', 'nanometer', 'nanometers', n('1e-9'), ['nanometre', 'nanometres']],
    ['um', 'µm', 'micrometer', 'micrometers', n('1e-6'), ['micron', 'microns', 'micrometre', 'micrometres']],
    ['mm', 'mm', 'millimeter', 'millimeters', n('0.001'), ['millimetre', 'millimetres']],
    ['cm', 'cm', 'centimeter', 'centimeters', n('0.01'), ['centimetre', 'centimetres']],
    ['m', 'm', 'meter', 'meters', n(1), ['metre', 'metres']],
    ['km', 'km', 'kilometer', 'kilometers', n(1000), ['kilometre', 'kilometres', 'kms', 'k']],
    ['in', 'in', 'inch', 'inches', n('0.0254'), ['"']],
    ['ft', 'ft', 'foot', 'feet', n('0.3048'), ["'"]],
    ['yd', 'yd', 'yard', 'yards', n('0.9144'), ['yds']],
    ['mi', 'mi', 'mile', 'miles', n('1609.344')],
    ['nmi', 'nmi', 'nautical mile', 'nautical miles', n(1852)],
    ['au', 'au', 'astronomical unit', 'astronomical units', n('149597870700'), ['aus']],
    ['ly', 'ly', 'light year', 'light years', n('9460730472580800'), ['light-year', 'light-years', 'lightyear', 'lightyears', 'lys'], 'Julian light year (365.25 days of light travel)'],
    ['pc', 'pc', 'parsec', 'parsecs', n('3.0856775814913673e16'), ['pcs']],
  ]),
  ...family('mass', [
    ['mg', 'mg', 'milligram', 'milligrams', n('1e-6'), ['milligramme', 'milligrammes']],
    ['g', 'g', 'gram', 'grams', n('0.001'), ['gramme', 'grammes', 'gm', 'gms']],
    ['kg', 'kg', 'kilogram', 'kilograms', n(1), ['kilo', 'kilos', 'kgs', 'kilogramme', 'kilogrammes']],
    ['t', 't', 'tonne', 'tonnes', n(1000), ['metric ton', 'metric tons']],
    ['oz', 'oz', 'ounce', 'ounces', n('0.028349523125')],
    ['lb', 'lb', 'pound', 'pounds', n('0.45359237'), ['lbs']],
    ['st', 'st', 'stone', 'stones', n('6.35029318')],
    ['ton', 'ton', 'short ton', 'short tons', n('907.18474'), ['ton', 'tons'], 'US short ton (2,000 lb)'],
  ]),
  ...family('time', [
    ['ms', 'ms', 'millisecond', 'milliseconds', n('0.001'), ['msec']],
    ['s', 's', 'second', 'seconds', n(1), ['sec', 'secs']],
    ['min', 'min', 'minute', 'minutes', n(60), ['mins']],
    ['h', 'h', 'hour', 'hours', n(3600), ['hr', 'hrs']],
    ['day', 'd', 'day', 'days', n(86400)],
    ['week', 'wk', 'week', 'weeks', n(604800), ['wks']],
    ['month', 'mo', 'month', 'months', n(2629746), [], 'Average Gregorian month (30.436875 days); calendar months have 28–31 days'],
    ['year', 'yr', 'year', 'years', n(31556952), ['yrs'], 'Average Gregorian year (365.2425 days); calendar years have 365 days, leap years 366'],
  ]),
  ...family('volume', [
    ['ml', 'mL', 'milliliter', 'milliliters', n('1e-6'), ['millilitre', 'millilitres', 'cc']],
    ['l', 'L', 'liter', 'liters', n('0.001'), ['litre', 'litres', 'ltr']],
    ['m3', 'm³', 'cubic meter', 'cubic meters', n(1), ['cubic metre', 'cubic metres']],
    ['cm3', 'cm³', 'cubic centimeter', 'cubic centimeters', n('1e-6'), ['cubic centimetre', 'cubic centimetres']],
    ['ft3', 'ft³', 'cubic foot', 'cubic feet', n('0.028316846592')],
    ['yd3', 'yd³', 'cubic yard', 'cubic yards', n('0.764554857984')],
    ['in3', 'in³', 'cubic inch', 'cubic inches', n('0.000016387064')],
    ['tsp', 'tsp', 'teaspoon', 'teaspoons', n('0.00000492892159375'), [], US],
    ['tbsp', 'tbsp', 'tablespoon', 'tablespoons', n('0.00001478676478125'), [], US],
    ['floz', 'fl oz', 'fluid ounce', 'fluid ounces', n('0.0000295735295625'), ['fl oz'], US],
    ['cup', 'cup', 'cup', 'cups', n('0.0002365882365'), [], US],
    ['pint', 'pt', 'pint', 'pints', n('0.000473176473'), [], US],
    ['quart', 'qt', 'quart', 'quarts', n('0.000946352946'), [], US],
    ['gal', 'gal', 'gallon', 'gallons', n('0.003785411784'), [], US],
    ['impgal', 'imp gal', 'imperial gallon', 'imperial gallons', n('0.00454609'), ['uk gallon', 'uk gallons']],
    ['imppint', 'imp pt', 'imperial pint', 'imperial pints', n('0.00056826125'), ['uk pint', 'uk pints']],
  ]),
  ...family('area', [
    ['mm2', 'mm²', 'square millimeter', 'square millimeters', n('1e-6'), ['sq mm']],
    ['cm2', 'cm²', 'square centimeter', 'square centimeters', n('1e-4'), ['sq cm']],
    ['m2', 'm²', 'square meter', 'square meters', n(1), ['sq m', 'square metre', 'square metres', 'sqm']],
    ['km2', 'km²', 'square kilometer', 'square kilometers', n(1e6), ['sq km', 'square kilometre', 'square kilometres']],
    ['in2', 'in²', 'square inch', 'square inches', n('0.00064516'), ['sq in']],
    ['ft2', 'ft²', 'square foot', 'square feet', n('0.09290304'), ['sq ft', 'sqft']],
    ['yd2', 'yd²', 'square yard', 'square yards', n('0.83612736'), ['sq yd']],
    ['mi2', 'mi²', 'square mile', 'square miles', n('2589988.110336'), ['sq mi']],
    ['acre', 'ac', 'acre', 'acres', n('4046.8564224')],
    ['ha', 'ha', 'hectare', 'hectares', n(10000)],
  ]),
  ...family('speed', [
    ['mps', 'm/s', 'meter per second', 'meters per second', n(1), ['metres per second', 'm per s', 'm per second']],
    ['kph', 'km/h', 'kilometer per hour', 'kilometers per hour', n(1000).div(3600), ['kmh', 'kph', 'kmph', 'kilometres per hour', 'km per hour', 'kms per hour', 'km an hour', 'kilometers an hour', 'kilometres an hour']],
    ['mph', 'mph', 'mile per hour', 'miles per hour', n('0.44704'), ['mi/h', 'miles an hour', 'mile an hour', 'mi per hour']],
    ['fps', 'ft/s', 'foot per second', 'feet per second', n('0.3048')],
    ['kn', 'kn', 'knot', 'knots', n(1852).div(3600), ['kt', 'kts']],
  ]),
  ...family('data', [
    ['bit', 'bit', 'bit', 'bits', n('0.125'), ['b']],
    ['byte', 'B', 'byte', 'bytes', n(1)],
    ['kb', 'KB', 'kilobyte', 'kilobytes', n(1e3)],
    ['mb', 'MB', 'megabyte', 'megabytes', n(1e6), ['megs']],
    ['gb', 'GB', 'gigabyte', 'gigabytes', n(1e9), ['gigs']],
    ['tb', 'TB', 'terabyte', 'terabytes', n(1e12)],
    ['pb', 'PB', 'petabyte', 'petabytes', n(1e15)],
    ['kib', 'KiB', 'kibibyte', 'kibibytes', n(1024)],
    ['mib', 'MiB', 'mebibyte', 'mebibytes', n(1024).pow(2)],
    ['gib', 'GiB', 'gibibyte', 'gibibytes', n(1024).pow(3)],
    ['tib', 'TiB', 'tebibyte', 'tebibytes', n(1024).pow(4)],
  ]),
  ...family('energy', [
    ['j', 'J', 'joule', 'joules', n(1)],
    ['kj', 'kJ', 'kilojoule', 'kilojoules', n(1000)],
    ['cal', 'cal', 'calorie', 'calories', n('4.184'), [], 'Thermochemical calorie'],
    ['kcal', 'kcal', 'kilocalorie', 'kilocalories', n(4184), ['food calorie', 'food calories', 'kcals']],
    ['wh', 'Wh', 'watt hour', 'watt hours', n(3600), ['watt-hour', 'watt-hours']],
    ['kwh', 'kWh', 'kilowatt hour', 'kilowatt hours', n(3.6e6), ['kilowatt-hour', 'kilowatt-hours']],
    ['ev', 'eV', 'electronvolt', 'electronvolts', n('1.602176634e-19'), ['electron volt', 'electron volts']],
    ['btu', 'BTU', 'british thermal unit', 'british thermal units', n('1055.05585262')],
  ]),
  ...family('power', [
    ['w', 'W', 'watt', 'watts', n(1)],
    ['kw', 'kW', 'kilowatt', 'kilowatts', n(1000)],
    ['megawatt', 'MW', 'megawatt', 'megawatts', n(1e6)],
    ['hp', 'hp', 'horsepower', 'horsepower', n('745.69987158227022'), [], 'Mechanical horsepower'],
  ]),
  ...family('pressure', [
    ['pa', 'Pa', 'pascal', 'pascals', n(1)],
    ['kpa', 'kPa', 'kilopascal', 'kilopascals', n(1000)],
    ['bar', 'bar', 'bar', 'bars', n(1e5)],
    ['atm', 'atm', 'atmosphere', 'atmospheres', n(101325)],
    ['psi', 'psi', 'pound per square inch', 'pounds per square inch', n('6894.757293168')],
    ['mmhg', 'mmHg', 'millimeter of mercury', 'millimeters of mercury', n('133.322387415')],
  ]),
  ...family('angle', [
    ['deg', '°', 'degree', 'degrees', PI.div(180), ['deg', 'degs']],
    ['rad', 'rad', 'radian', 'radians', n(1), ['rads']],
    ['grad', 'grad', 'gradian', 'gradians', PI.div(200), ['gon', 'gons', 'grads']],
    ['turn', 'turn', 'turn', 'turns', PI.mul(2), ['revolution', 'revolutions', 'rev', 'revs']],
  ]),
  ...family('frequency', [
    ['hz', 'Hz', 'hertz', 'hertz', n(1)],
    ['khz', 'kHz', 'kilohertz', 'kilohertz', n(1e3)],
    ['mhz', 'MHz', 'megahertz', 'megahertz', n(1e6)],
    ['ghz', 'GHz', 'gigahertz', 'gigahertz', n(1e9)],
    ['rpm', 'rpm', 'revolution per minute', 'revolutions per minute', n(1).div(60)],
  ]),
  {
    id: 'c', dimension: 'temperature', symbol: '°C', singular: 'degree Celsius', plural: 'degrees Celsius',
    toBase: (x) => x.plus('273.15'), fromBase: (x) => x.minus('273.15'),
    aliases: ['c', '°c', 'celsius', 'centigrade', 'degrees celsius', 'degree celsius', 'degrees c', 'deg c'],
  },
  {
    id: 'f', dimension: 'temperature', symbol: '°F', singular: 'degree Fahrenheit', plural: 'degrees Fahrenheit',
    toBase: (x) => x.minus(32).mul(5).div(9).plus('273.15'), fromBase: (x) => x.minus('273.15').mul(9).div(5).plus(32),
    aliases: ['f', '°f', 'fahrenheit', 'degrees fahrenheit', 'degree fahrenheit', 'degrees f', 'deg f'],
  },
  {
    id: 'k', dimension: 'temperature', symbol: 'K', singular: 'kelvin', plural: 'kelvin',
    toBase: (x) => x, fromBase: (x) => x,
    // "k" is also kilometres ("a 5k run"); the converter picks whichever reading matches the other side's dimension.
    aliases: ['kelvin', 'kelvins', 'degrees kelvin', 'k'],
  },
];

/** Longest aliases first so "square feet" wins over "feet" and "fl oz" over "oz". */
export const ALIASES: [alias: string, unit: UnitDef][] = UNITS.flatMap((u) => [...new Set(u.aliases)].map((a) => [a, u] as [string, UnitDef])).sort(
  (a, b) => b[0].length - a[0].length,
);

/** Every unit an alias can mean, in registry order ("k": kilometres, then kelvin). */
const ALL_BY_ALIAS = new Map<string, UnitDef[]>();
for (const [alias, unit] of ALIASES) {
  const list = ALL_BY_ALIAS.get(alias);
  if (!list) ALL_BY_ALIAS.set(alias, [unit]);
  else if (!list.includes(unit)) list.push(unit);
}
for (const list of ALL_BY_ALIAS.values()) list.sort((a, b) => UNITS.indexOf(a) - UNITS.indexOf(b));

/** The usual reading of a unit name or symbol. */
export function findUnit(text: string): UnitDef | undefined {
  return ALL_BY_ALIAS.get(text.trim().toLowerCase())?.[0];
}

/** All readings of a unit name or symbol, most usual first. */
export function findUnits(text: string): UnitDef[] {
  return ALL_BY_ALIAS.get(text.trim().toLowerCase()) ?? [];
}
