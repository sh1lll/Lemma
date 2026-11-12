import type { Dec } from '@lemma/math-core';
import { molarMass, parseFormula } from '@lemma/science-engine/src/formula';

export const COMPOUND_SOURCE = {
  name: 'PubChem compound records; CRC Handbook of Chemistry and Physics',
  url: 'https://pubchem.ncbi.nlm.nih.gov/',
  asOf: '2024',
};

export interface CompoundInfo {
  name: string;
  formula: string;
  aliases: string[];
  /** Computed from IUPAC standard atomic weights. */
  molarMass: Dec;
  /** g/cm³ for solids and liquids, g/L for gases (see {@link gas}). */
  density?: string;
  densityNote?: string;
  /** °C at 1 atm. */
  mp?: string;
  bp?: string;
  /** Sublimation point in °C at 1 atm. */
  sub?: string;
  gas: boolean;
  note?: string;
}

// name|formula|aliases (comma-separated)|density|density note|melting °C|boiling °C|flags (g = gas at room temperature)|note
const ROWS = [
  'Water|H2O|h2o,dihydrogen monoxide,ice|0.9970|at 25 °C|0|100||Boils at 99.97 °C at exactly 1 atm',
  'Carbon dioxide|CO2|co2,dry ice|1.977|at 0 °C, 1 atm|||g|Sublimes at −78.5 °C at 1 atm; it only melts under pressure',
  'Carbon monoxide|CO||1.250|at 0 °C, 1 atm|−205.0|−191.5|g|',
  'Sodium chloride|NaCl|nacl,salt,table salt,common salt,halite|2.165||801|1465||',
  'Glucose|C6H12O6|dextrose,d-glucose,blood sugar|1.54||146|||Decomposes before boiling',
  'Sucrose|C12H22O11|table sugar,cane sugar,saccharose|1.587||186|||Decomposes on melting',
  'Ethanol|C2H6O|ethyl alcohol,alcohol,grain alcohol|0.789|at 20 °C|−114.1|78.37||',
  'Methanol|CH4O|methyl alcohol,wood alcohol|0.792|at 20 °C|−97.6|64.7||',
  'Methane|CH4|ch4,natural gas|0.717|at 0 °C, 1 atm|−182.5|−161.5|g|',
  'Ethane|C2H6|c2h6|1.356|at 0 °C, 1 atm|−182.8|−88.5|g|',
  'Propane|C3H8|c3h8||  |−187.7|−42.1|g|',
  'Butane|C4H10|n-butane,c4h10|||−138.3|−0.5|g|',
  'Ammonia|NH3|nh3|0.769|at 0 °C, 1 atm|−77.73|−33.34|g|',
  'Caffeine|C8H10N4O2|c8h10n4o2|1.23||235|||Sublimes at about 178 °C',
  'Sulfuric acid|H2SO4|h2so4,sulphuric acid,oil of vitriol|1.8302|at 20 °C|10.31|337||',
  'Hydrogen chloride|HCl|hcl,hydrochloric acid|||−114.2|−85.05|g|Hydrochloric acid is its solution in water',
  'Sodium hydroxide|NaOH|naoh,lye,caustic soda|2.13||323|1388||',
  'Calcium carbonate|CaCO3|caco3,calcite,limestone,chalk|2.71|calcite||||Decomposes at about 825 °C instead of melting',
  'Oxygen gas|O2|o2,dioxygen,oxygen molecule|1.429|at 0 °C, 1 atm|−218.79|−182.96|g|',
  'Nitrogen gas|N2|n2,dinitrogen,nitrogen molecule|1.2506|at 0 °C, 1 atm|−210.0|−195.79|g|',
  'Hydrogen gas|H2|h2,dihydrogen,hydrogen molecule|0.08988|at 0 °C, 1 atm|−259.16|−252.879|g|',
  'Ozone|O3|o3|2.144|at 0 °C, 1 atm|−192.2|−112|g|',
  'Benzene|C6H6|c6h6|0.8765|at 20 °C|5.53|80.1||',
  'Toluene|C7H8|c7h8,methylbenzene|0.87|at 20 °C|−95|110.6||',
  'Acetone|C3H6O|propanone,dimethyl ketone|0.7845|at 25 °C|−94.7|56.05||',
  'Aspirin|C9H8O4|acetylsalicylic acid,c9h8o4|1.40||136|||Decomposes at about 140 °C',
  'Paracetamol|C8H9NO2|acetaminophen,tylenol|1.263||169||',
  'Ibuprofen|C13H18O2|c13h18o2|1.03||76||',
  'Acetic acid|C2H4O2|ethanoic acid,ch3cooh,glacial acetic acid|1.049|at 25 °C|16.6|118||',
  'Hydrogen peroxide|H2O2|h2o2|1.45|at 20 °C|−0.43|150.2||',
  'Sodium bicarbonate|NaHCO3|nahco3,baking soda,sodium hydrogen carbonate|2.20|||||Decomposes when heated above about 50 °C',
  'Sodium carbonate|Na2CO3|na2co3,washing soda,soda ash|2.54||851||',
  'Potassium chloride|KCl|kcl|1.984||770|1420||',
  'Calcium chloride|CaCl2|cacl2|2.15||772|1935||',
  'Nitric acid|HNO3|hno3|1.51|at 20 °C|−42|83||',
  'Phosphoric acid|H3PO4|h3po4,orthophosphoric acid|1.885||42.35|||',
  'Sulfur dioxide|SO2|so2,sulphur dioxide|2.6288|at 0 °C, 1 atm|−72|−10|g|',
  'Nitrous oxide|N2O|n2o,laughing gas|1.977|at 0 °C, 1 atm|−90.86|−88.48|g|',
  'Hydrogen sulfide|H2S|h2s,hydrogen sulphide|1.539|at 0 °C, 1 atm|−82|−60|g|',
  'Glycerol|C3H8O3|glycerin,glycerine,c3h8o3|1.261|at 20 °C|17.8|290||',
  'Ethylene glycol|C2H6O2|antifreeze|1.1132|at 20 °C|−12.9|197.3||',
  'Urea|CH4N2O|carbamide|1.32||133|||Decomposes before boiling',
  'Silicon dioxide|SiO2|sio2,silica,quartz|2.648|quartz|1713|2950||',
  'Aluminium oxide|Al2O3|al2o3,aluminum oxide,alumina,corundum|3.987||2072|2977||',
  'Magnesium oxide|MgO|mgo,magnesia|3.58||2852|3600||',
  'Silver nitrate|AgNO3|agno3|4.35||209.7|||Decomposes at about 440 °C',
  'Ammonium nitrate|NH4NO3|nh4no3|1.725||169.6|||Decomposes at about 210 °C',
  'Ethylene|C2H4|ethene,c2h4|||−169.2|−103.7|g|',
];

export const COMPOUNDS: CompoundInfo[] = ROWS.map((row) => {
  const [name = '', formula = '', aliases = '', density, densityNote, mp, bp, flags = '', note] = row.split('|');
  if (flags !== '' && flags !== 'g') throw new Error(`bad row ${name}`);
  const counts = parseFormula(formula);
  if (!counts) throw new Error(`bad formula ${formula}`);
  const c: CompoundInfo = {
    name,
    formula,
    aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
    molarMass: molarMass(counts),
    gas: flags.includes('g'),
  };
  const ascii = (v: string) => v.trim().replace(/−/g, '-');
  if (density?.trim()) c.density = density.trim();
  if (densityNote?.trim()) c.densityNote = densityNote.trim();
  if (mp?.trim()) c.mp = ascii(mp);
  if (bp?.trim()) c.bp = ascii(bp);
  if (note?.trim()) c.note = note.trim();
  if (formula === 'CO2') c.sub = '-78.5';
  if (formula === 'C8H10N4O2') c.sub = '178';
  return c;
});
