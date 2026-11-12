import type { PluginManifest } from './manifest';

/**
 * Curated extensions shipped with Lemma (off until installed). Formula extensions run no code; the one
 * script example demonstrates the sandbox. A hosted marketplace would serve the same manifest format.
 */
const base = { format: 'lemma-plugin' as const, version: 1 as const, author: 'Lemma', release: '1.0.0' };

export const CATALOG: PluginManifest[] = [
  {
    ...base,
    id: 'lemma.bmi',
    name: 'BMI',
    description: 'Body-mass index from weight and height, with the WHO adult category.',
    kind: 'formula',
    templates: ['bmi {weight} kg {height} m', 'bmi for {weight} kg and {height} m', 'bmi {weight} {height}', 'body mass index {weight} kg {height} m'],
    inputs: [
      { name: 'weight', label: 'Weight', unit: 'kg', min: 1, max: 700 },
      { name: 'height', label: 'Height', unit: 'm', min: 0.3, max: 3 },
    ],
    formula: 'weight / height^2',
    output: { label: 'BMI', unit: 'kg/m²', decimals: 1, bands: [{ max: 18.4999, label: 'Underweight' }, { max: 24.9999, label: 'Healthy weight' }, { max: 29.9999, label: 'Overweight' }, { max: 1e9, label: 'Obese' }] },
    examples: [{ input: 'bmi 70 kg 1.75 m', expect: '22.9' }],
  },
  {
    ...base,
    id: 'lemma.trip-fuel-metric',
    name: 'Trip fuel cost (metric)',
    description: 'Fuel cost of a trip from distance, consumption (L/100 km) and price per litre.',
    kind: 'formula',
    templates: ['fuel cost {distance} km at {consumption} l/100km {price} per litre', 'fuel for {distance} km {consumption} l/100km at {price}', 'trip fuel {distance} km {consumption} {price}'],
    inputs: [
      { name: 'distance', label: 'Distance', unit: 'km', min: 0 },
      { name: 'consumption', label: 'Consumption', unit: 'L/100 km', min: 0 },
      { name: 'price', label: 'Fuel price', unit: 'per L', min: 0 },
    ],
    formula: 'distance * consumption / 100 * price',
    output: { label: 'Cost', decimals: 2 },
    lines: [{ label: 'Fuel used', formula: 'distance * consumption / 100', decimals: 1, unit: 'L' }],
    examples: [{ input: 'fuel cost 420 km at 6.5 l/100km 1.85 per litre', expect: '50.51' }],
  },
  {
    ...base,
    id: 'lemma.trip-fuel-us',
    name: 'Trip gas cost (US)',
    description: 'Gas cost of a trip from miles, miles per gallon and price per gallon.',
    kind: 'formula',
    templates: ['gas cost {miles} miles at {mpg} mpg {price} per gallon', 'gas for {miles} miles {mpg} mpg at {price}', 'trip gas {miles} {mpg} {price}'],
    inputs: [
      { name: 'miles', label: 'Distance', unit: 'mi', min: 0 },
      { name: 'mpg', label: 'Fuel economy', unit: 'mpg', min: 0.1 },
      { name: 'price', label: 'Gas price', unit: '$/gal', min: 0 },
    ],
    formula: 'miles / mpg * price',
    output: { label: 'Cost', unit: '$', decimals: 2 },
    lines: [{ label: 'Gas used', formula: 'miles / mpg', decimals: 1, unit: 'gal' }],
    examples: [{ input: 'gas cost 300 miles at 28 mpg 3.49 per gallon', expect: '37.39' }],
  },
  {
    ...base,
    id: 'lemma.paint',
    name: 'Paint needed',
    description: 'Litres of paint for a wall area, number of coats and coverage per litre.',
    kind: 'formula',
    templates: ['paint for {area} m2 {coats} coats at {coverage} m2 per litre', 'paint {area} m2 {coats} coats {coverage}', 'paint needed {area} {coats} {coverage}'],
    inputs: [
      { name: 'area', label: 'Area', unit: 'm²', min: 0 },
      { name: 'coats', label: 'Coats', min: 1, max: 10, default: 2 },
      { name: 'coverage', label: 'Coverage', unit: 'm²/L', min: 0.1, default: 10 },
    ],
    formula: 'area * coats / coverage',
    output: { label: 'Paint', unit: 'L', decimals: 1 },
    lines: [{ label: 'With 10% spare', formula: 'area * coats / coverage * 1.1', decimals: 1, unit: 'L' }],
    examples: [{ input: 'paint for 45 m2 2 coats at 12 m2 per litre', expect: '7.5' }],
  },
  {
    ...base,
    id: 'lemma.power-cost',
    name: 'Appliance running cost',
    description: 'Monthly electricity cost of a device from watts, hours per day and price per kWh.',
    kind: 'formula',
    templates: ['running cost {watts} w {hours} hours a day at {price} per kwh', 'power cost {watts} w {hours} h {price}', 'electricity {watts} watts {hours} hours {price} kwh'],
    inputs: [
      { name: 'watts', label: 'Power', unit: 'W', min: 0 },
      { name: 'hours', label: 'Use', unit: 'h/day', min: 0, max: 24 },
      { name: 'price', label: 'Price', unit: 'per kWh', min: 0 },
    ],
    formula: 'watts / 1000 * hours * 30 * price',
    output: { label: 'Per month (30 days)', decimals: 2 },
    lines: [
      { label: 'Energy per month', formula: 'watts / 1000 * hours * 30', decimals: 1, unit: 'kWh' },
      { label: 'Per year', formula: 'watts / 1000 * hours * 365 * price', decimals: 2 },
    ],
    examples: [{ input: 'running cost 150 w 8 hours a day at 0.30 per kwh', expect: '10.80' }],
  },
  {
    ...base,
    id: 'lemma.download-time',
    name: 'Download time',
    description: 'How long a download takes from file size (GB) and connection speed (Mbps).',
    kind: 'formula',
    templates: ['download {size} gb at {speed} mbps', 'download time {size} gb {speed} mbps', 'how long to download {size} gb at {speed} mbps'],
    inputs: [
      { name: 'size', label: 'Size', unit: 'GB', min: 0 },
      { name: 'speed', label: 'Speed', unit: 'Mbps', min: 0.001 },
    ],
    formula: 'size * 8000 / speed / 60',
    output: { label: 'Time', unit: 'min', decimals: 1 },
    lines: [{ label: 'Seconds', formula: 'size * 8000 / speed', decimals: 0, unit: 's' }],
    examples: [{ input: 'download 50 gb at 300 mbps', expect: '22.2' }],
  },
  {
    ...base,
    id: 'lemma.roman',
    name: 'Roman numerals',
    description: 'Writes a whole number from 1 to 3999 in Roman numerals. (Example of a sandboxed script extension.)',
    kind: 'script',
    templates: ['{n} in roman numerals', 'roman numerals for {n}', '{n} in roman'],
    inputs: [{ name: 'n', label: 'Number' }],
    permissions: [],
    script: `function run(inputs) {
  const n = Number(inputs.n);
  if (!Number.isInteger(n) || n < 1 || n > 3999) return { display: 'Roman numerals cover 1 to 3999', notes: ['Whole numbers only'] };
  const table = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let left = n, out = '';
  for (const [v, s] of table) while (left >= v) { out += s; left -= v; }
  return { display: out, value: n };
}`,
    examples: [{ input: '2026 in roman numerals', expect: 'MMXXVI' }],
  },
];
