import { Temporal } from 'temporal-polyfill';
import { easter } from './parse';

/**
 * Rule-based public-holiday calendars. Each country's rules come from its statute or official calendar
 * (cited per country below), including observed/substitute-day rules. Only nationwide holidays are listed;
 * regional ones (US states, German Länder, Canadian provinces, Australian states…) are not.
 */

export type CountryCode = 'US' | 'GB-EAW' | 'GB-SCT' | 'CA' | 'AU' | 'DE' | 'FR' | 'IN' | 'JP' | 'MX' | 'BR';

export interface Holiday {
  /** The day off (the observed day when the holiday is moved). */
  date: Temporal.PlainDate;
  name: string;
  /** Set when the day off differs from the holiday's own date. */
  actual?: Temporal.PlainDate;
}

export interface CountryInfo {
  code: CountryCode;
  name: string;
  /** "federal holidays", "bank holidays"… */
  noun: string;
  /** Said once alongside answers: what the calendar covers and leaves out. */
  scope: string;
  /** First year the rules here are valid for. */
  from: number;
}

export const COUNTRIES: Record<CountryCode, CountryInfo> = {
  US: { code: 'US', name: 'the US', noun: 'federal holidays', scope: 'US federal holidays (5 U.S.C. 6103); a Saturday holiday is observed on Friday, a Sunday one on Monday. State holidays are not included.', from: 1978 },
  'GB-EAW': { code: 'GB-EAW', name: 'England & Wales', noun: 'bank holidays', scope: 'Bank holidays in England & Wales, with substitute days and the one-off royal and millennium holidays.', from: 1978 },
  'GB-SCT': { code: 'GB-SCT', name: 'Scotland', noun: 'bank holidays', scope: 'Bank holidays in Scotland, with substitute days and the one-off royal holidays. Local holidays vary by council.', from: 2007 },
  CA: { code: 'CA', name: 'Canada', noun: 'federal statutory holidays', scope: 'General holidays under the Canada Labour Code (federally regulated workplaces); weekend days move to the next working day as in the federal public service. The Civic Holiday (first Monday in August) and provincial holidays are not included.', from: 1990 },
  AU: { code: 'AU', name: 'Australia', noun: 'national public holidays', scope: 'Holidays observed in every Australian state and territory; states add their own (King’s Birthday, Labour Day…) and some substitute rules differ by state.', from: 1994 },
  DE: { code: 'DE', name: 'Germany', noun: 'nationwide public holidays', scope: 'Holidays in all German states (bundesweit); states add more (e.g. Epiphany, Corpus Christi, Reformation Day). There are no substitute days.', from: 1991 },
  FR: { code: 'FR', name: 'France', noun: 'public holidays', scope: 'The 11 jours fériés of the Code du travail; Alsace-Moselle also has Good Friday and 26 December. There are no substitute days.', from: 2008 },
  IN: { code: 'IN', name: 'India', noun: 'national holidays', scope: 'Only the three fixed national holidays. Festivals that follow lunar or lunisolar calendars (Diwali, Holi, Eid…) and state holidays are not included.', from: 1950 },
  JP: { code: 'JP', name: 'Japan', noun: 'national holidays', scope: 'Japan’s national holidays (祝日法), including substitute holidays (振替休日) and citizens’ holidays (国民の休日). Equinox days use the standard astronomical formula.', from: 2000 },
  MX: { code: 'MX', name: 'Mexico', noun: 'statutory rest days', scope: 'Días de descanso obligatorio (Ley Federal del Trabajo, art. 74). Holy Thursday/Friday and 12 December are widely observed but not statutory.', from: 2007 },
  BR: { code: 'BR', name: 'Brazil', noun: 'national holidays', scope: 'National holidays (feriados nacionais). Carnival and Corpus Christi are optional days (ponto facultativo) and are not included; states and cities add their own.', from: 2002 },
};

const ALIASES: [RegExp, CountryCode, string?][] = [
  [/^(?:the )?(?:us|u\.s\.?|usa|u\.s\.a\.?|united states(?: of america)?|america|american|federal|us federal)$/, 'US'],
  [/^(?:england(?: (?:and|&) wales)?|wales|english|welsh)$/, 'GB-EAW'],
  [/^(?:the )?(?:uk|u\.k\.?|united kingdom|britain|great britain|british|gb)$/, 'GB-EAW', 'For the UK, England & Wales is shown; Scotland and Northern Ireland differ (try “holidays in Scotland”)'],
  [/^(?:scotland|scottish)$/, 'GB-SCT'],
  [/^(?:canada|canadian|ca)$/, 'CA'],
  [/^(?:australia|australian|aussie|au|oz)$/, 'AU'],
  [/^(?:germany|german|deutschland|de)$/, 'DE'],
  [/^(?:france|french|fr)$/, 'FR'],
  [/^(?:india|indian|in)$/, 'IN'],
  [/^(?:japan|japanese|jp|nippon)$/, 'JP'],
  [/^(?:mexico|méxico|mexican|mx)$/, 'MX'],
  [/^(?:brazil|brasil|brazilian|br)$/, 'BR'],
];

/** Words that name a supported country, for building regexes. */
export const COUNTRY_RE = String.raw`(?:the )?(?:u\.?s\.?a?\.?|united states(?: of america)?|america|american|federal|us federal|england(?: (?:and|&) wales)?|wales|english|welsh|u\.?k\.?|united kingdom|(?:great )?britain|british|scotland|scottish|canada|canadian|australia|australian|aussie|germany|german|deutschland|france|french|india|indian|japan|japanese|mexico|méxico|mexican|brazil|brasil|brazilian)`;

export function findCountry(word: string): { code: CountryCode; note?: string } | null {
  const w = word.trim().toLowerCase();
  for (const [re, code, note] of ALIASES) if (re.test(w)) return { code, note };
  return null;
}

// ---------- date helpers ----------
const D = (year: number, month: number, day: number) => Temporal.PlainDate.from({ year, month, day });

function nth(year: number, month: number, weekday: number, n: number): Temporal.PlainDate {
  const first = D(year, month, 1);
  return first.add({ days: ((weekday - first.dayOfWeek + 7) % 7) + 7 * (n - 1) });
}

function last(year: number, month: number, weekday: number): Temporal.PlainDate {
  const end = D(year, month, 1).add({ months: 1 }).subtract({ days: 1 });
  return end.subtract({ days: (end.dayOfWeek - weekday + 7) % 7 });
}

const MON = 1;
const THU = 4;
const isWeekend = (d: Temporal.PlainDate) => d.dayOfWeek >= 6;
const key = (d: Temporal.PlainDate) => d.toString();

interface Raw {
  date: Temporal.PlainDate;
  name: string;
  /** How a weekend date is moved. */
  shift?: 'us' | 'next-weekday';
}

/**
 * Applies weekend substitution. US: Saturday → Friday, Sunday → Monday. "next-weekday" (UK, Canada,
 * Australia): holidays already on a weekday keep their day; then each weekend holiday takes the next
 * weekday that isn't already a holiday (so Christmas on Saturday and Boxing Day on Sunday become Mon + Tue).
 */
function observe(raw: Raw[]): Holiday[] {
  const out: Holiday[] = [];
  const taken = new Set<string>();
  for (const r of raw) {
    if (r.shift === 'next-weekday' && isWeekend(r.date)) continue;
    if (r.shift === 'us' && isWeekend(r.date)) {
      const obs = r.date.add({ days: r.date.dayOfWeek === 6 ? -1 : 1 });
      out.push({ date: obs, name: `${r.name} (observed)`, actual: r.date });
      taken.add(key(obs));
      continue;
    }
    out.push({ date: r.date, name: r.name });
    taken.add(key(r.date));
  }
  for (const r of raw) {
    if (r.shift !== 'next-weekday' || !isWeekend(r.date)) continue;
    let d = r.date;
    while (isWeekend(d) || taken.has(key(d))) d = d.add({ days: 1 });
    taken.add(key(d));
    out.push({ date: d, name: `${r.name} (substitute day)`, actual: r.date });
  }
  return out;
}

// ---------- countries ----------
function us(y: number): Raw[] {
  const r: Raw[] = [{ date: D(y, 1, 1), name: "New Year's Day", shift: 'us' }];
  if (y >= 1986) r.push({ date: nth(y, 1, MON, 3), name: 'Birthday of Martin Luther King, Jr.' });
  r.push(
    { date: nth(y, 2, MON, 3), name: "Washington's Birthday (Presidents' Day)" },
    { date: last(y, 5, MON), name: 'Memorial Day' },
  );
  if (y >= 2021) r.push({ date: D(y, 6, 19), name: 'Juneteenth National Independence Day', shift: 'us' });
  r.push(
    { date: D(y, 7, 4), name: 'Independence Day', shift: 'us' },
    { date: nth(y, 9, MON, 1), name: 'Labor Day' },
    { date: nth(y, 10, MON, 2), name: 'Columbus Day' },
    { date: D(y, 11, 11), name: 'Veterans Day', shift: 'us' },
    { date: nth(y, 11, THU, 4), name: 'Thanksgiving Day' },
    { date: D(y, 12, 25), name: 'Christmas Day', shift: 'us' },
  );
  return r;
}

/** England & Wales one-offs and moved holidays (gov.uk bank-holidays). Keyed by year. */
const EAW_SPECIAL: Record<number, { replace?: Record<string, Temporal.PlainDate>; add?: Raw[] }> = {
  1981: { add: [{ date: D(1981, 7, 29), name: 'Royal wedding' }] },
  1995: { replace: { 'Early May bank holiday': D(1995, 5, 8) } },
  1999: { add: [{ date: D(1999, 12, 31), name: 'Millennium celebrations' }] },
  2002: { replace: { 'Spring bank holiday': D(2002, 6, 4) }, add: [{ date: D(2002, 6, 3), name: 'Queen’s Golden Jubilee' }] },
  2011: { add: [{ date: D(2011, 4, 29), name: 'Royal wedding' }] },
  2012: { replace: { 'Spring bank holiday': D(2012, 6, 4) }, add: [{ date: D(2012, 6, 5), name: 'Queen’s Diamond Jubilee' }] },
  2020: { replace: { 'Early May bank holiday': D(2020, 5, 8) } },
  2022: { replace: { 'Spring bank holiday': D(2022, 6, 2) }, add: [{ date: D(2022, 6, 3), name: 'Platinum Jubilee bank holiday' }, { date: D(2022, 9, 19), name: 'State Funeral of Queen Elizabeth II' }] },
  2023: { add: [{ date: D(2023, 5, 8), name: 'Bank holiday for the coronation of King Charles III' }] },
};
const SCT_SPECIAL: typeof EAW_SPECIAL = {
  2011: EAW_SPECIAL[2011]!,
  2012: { add: [{ date: D(2012, 6, 5), name: 'Queen’s Diamond Jubilee' }] },
  2020: EAW_SPECIAL[2020]!,
  2022: EAW_SPECIAL[2022]!,
  2023: EAW_SPECIAL[2023]!,
};

function applySpecial(r: Raw[], y: number, table: typeof EAW_SPECIAL): Raw[] {
  const s = table[y];
  if (!s) return r;
  const out = r.map((h) => (s.replace?.[h.name] ? { ...h, date: s.replace[h.name]! } : h));
  return [...out, ...(s.add ?? [])];
}

function eaw(y: number): Raw[] {
  const e = easter(y);
  return applySpecial(
    [
      { date: D(y, 1, 1), name: "New Year's Day", shift: 'next-weekday' },
      { date: e.subtract({ days: 2 }), name: 'Good Friday' },
      { date: e.add({ days: 1 }), name: 'Easter Monday' },
      { date: nth(y, 5, MON, 1), name: 'Early May bank holiday' },
      { date: last(y, 5, MON), name: 'Spring bank holiday' },
      { date: last(y, 8, MON), name: 'Summer bank holiday' },
      { date: D(y, 12, 25), name: 'Christmas Day', shift: 'next-weekday' },
      { date: D(y, 12, 26), name: 'Boxing Day', shift: 'next-weekday' },
    ],
    y,
    EAW_SPECIAL,
  );
}

function sct(y: number): Raw[] {
  const e = easter(y);
  return applySpecial(
    [
      { date: D(y, 1, 1), name: "New Year's Day", shift: 'next-weekday' },
      { date: D(y, 1, 2), name: '2nd January', shift: 'next-weekday' },
      { date: e.subtract({ days: 2 }), name: 'Good Friday' },
      { date: nth(y, 5, MON, 1), name: 'Early May bank holiday' },
      { date: last(y, 5, MON), name: 'Spring bank holiday' },
      { date: nth(y, 8, MON, 1), name: 'Summer bank holiday' },
      { date: D(y, 11, 30), name: "St Andrew's Day", shift: 'next-weekday' },
      { date: D(y, 12, 25), name: 'Christmas Day', shift: 'next-weekday' },
      { date: D(y, 12, 26), name: 'Boxing Day', shift: 'next-weekday' },
    ],
    y,
    SCT_SPECIAL,
  );
}

function ca(y: number): Raw[] {
  const e = easter(y);
  return [
    { date: D(y, 1, 1), name: "New Year's Day", shift: 'next-weekday' },
    { date: e.subtract({ days: 2 }), name: 'Good Friday' },
    // The Monday before 25 May.
    { date: D(y, 5, 24).subtract({ days: (D(y, 5, 24).dayOfWeek - MON + 7) % 7 }), name: 'Victoria Day' },
    { date: D(y, 7, 1), name: 'Canada Day', shift: 'next-weekday' },
    { date: nth(y, 9, MON, 1), name: 'Labour Day' },
    ...(y >= 2021 ? [{ date: D(y, 9, 30), name: 'National Day for Truth and Reconciliation', shift: 'next-weekday' as const }] : []),
    { date: nth(y, 10, MON, 2), name: 'Thanksgiving' },
    { date: D(y, 11, 11), name: 'Remembrance Day', shift: 'next-weekday' },
    { date: D(y, 12, 25), name: 'Christmas Day', shift: 'next-weekday' },
    { date: D(y, 12, 26), name: 'Boxing Day', shift: 'next-weekday' },
  ];
}

function au(y: number): Raw[] {
  const e = easter(y);
  return [
    { date: D(y, 1, 1), name: "New Year's Day", shift: 'next-weekday' },
    { date: D(y, 1, 26), name: 'Australia Day', shift: 'next-weekday' },
    { date: e.subtract({ days: 2 }), name: 'Good Friday' },
    { date: e.add({ days: 1 }), name: 'Easter Monday' },
    // Not moved when it falls on a weekend in most states.
    { date: D(y, 4, 25), name: 'Anzac Day' },
    { date: D(y, 12, 25), name: 'Christmas Day', shift: 'next-weekday' },
    { date: D(y, 12, 26), name: 'Boxing Day', shift: 'next-weekday' },
  ];
}

function de(y: number): Raw[] {
  const e = easter(y);
  const r: Raw[] = [
    { date: D(y, 1, 1), name: 'Neujahr (New Year’s Day)' },
    { date: e.subtract({ days: 2 }), name: 'Karfreitag (Good Friday)' },
    { date: e.add({ days: 1 }), name: 'Ostermontag (Easter Monday)' },
    { date: D(y, 5, 1), name: 'Tag der Arbeit (Labour Day)' },
    { date: e.add({ days: 39 }), name: 'Christi Himmelfahrt (Ascension Day)' },
    { date: e.add({ days: 50 }), name: 'Pfingstmontag (Whit Monday)' },
    { date: D(y, 10, 3), name: 'Tag der Deutschen Einheit (German Unity Day)' },
    { date: D(y, 12, 25), name: '1. Weihnachtstag (Christmas Day)' },
    { date: D(y, 12, 26), name: '2. Weihnachtstag (St Stephen’s Day)' },
  ];
  if (y === 2017) r.push({ date: D(2017, 10, 31), name: 'Reformationstag (500th anniversary, nationwide)' });
  return r;
}

function fr(y: number): Raw[] {
  const e = easter(y);
  return [
    { date: D(y, 1, 1), name: 'Jour de l’an (New Year’s Day)' },
    { date: e.add({ days: 1 }), name: 'Lundi de Pâques (Easter Monday)' },
    { date: D(y, 5, 1), name: 'Fête du Travail (Labour Day)' },
    { date: D(y, 5, 8), name: 'Victoire 1945 (Victory in Europe Day)' },
    { date: e.add({ days: 39 }), name: 'Ascension' },
    { date: e.add({ days: 50 }), name: 'Lundi de Pentecôte (Whit Monday)' },
    { date: D(y, 7, 14), name: 'Fête nationale (Bastille Day)' },
    { date: D(y, 8, 15), name: 'Assomption (Assumption)' },
    { date: D(y, 11, 1), name: 'Toussaint (All Saints’ Day)' },
    { date: D(y, 11, 11), name: 'Armistice 1918' },
    { date: D(y, 12, 25), name: 'Noël (Christmas Day)' },
  ];
}

function ind(y: number): Raw[] {
  return [
    { date: D(y, 1, 26), name: 'Republic Day' },
    { date: D(y, 8, 15), name: 'Independence Day' },
    { date: D(y, 10, 2), name: 'Gandhi Jayanti' },
  ];
}

/** Vernal/autumnal equinox day in Japan (standard formula, valid 1980–2099). */
function equinox(y: number, autumn: boolean): Temporal.PlainDate {
  const base = autumn ? 23.2488 : 20.8431;
  return D(y, autumn ? 9 : 3, Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)));
}

function jpNational(y: number): Raw[] {
  const r: Raw[] = [
    { date: D(y, 1, 1), name: '元日 New Year’s Day' },
    { date: nth(y, 1, MON, 2), name: '成人の日 Coming of Age Day' },
    { date: D(y, 2, 11), name: '建国記念の日 National Foundation Day' },
    { date: equinox(y, false), name: '春分の日 Vernal Equinox Day' },
    { date: D(y, 4, 29), name: y >= 2007 ? '昭和の日 Shōwa Day' : 'みどりの日 Greenery Day' },
    { date: D(y, 5, 3), name: '憲法記念日 Constitution Memorial Day' },
    { date: D(y, 5, 5), name: 'こどもの日 Children’s Day' },
    { date: equinox(y, true), name: '秋分の日 Autumnal Equinox Day' },
    { date: D(y, 11, 3), name: '文化の日 Culture Day' },
    { date: D(y, 11, 23), name: '勤労感謝の日 Labour Thanksgiving Day' },
  ];
  if (y >= 2007) r.push({ date: D(y, 5, 4), name: 'みどりの日 Greenery Day' });
  if (y >= 2020) r.push({ date: D(y, 2, 23), name: '天皇誕生日 Emperor’s Birthday' });
  else if (y <= 2018) r.push({ date: D(y, 12, 23), name: '天皇誕生日 Emperor’s Birthday' });
  // Marine Day, Mountain Day and Sports Day were moved for the Tokyo Olympics in 2020 and 2021.
  const marine = y === 2020 ? D(2020, 7, 23) : y === 2021 ? D(2021, 7, 22) : y >= 2003 ? nth(y, 7, MON, 3) : D(y, 7, 20);
  r.push({ date: marine, name: '海の日 Marine Day' });
  if (y >= 2016) r.push({ date: y === 2020 ? D(2020, 8, 10) : y === 2021 ? D(2021, 8, 8) : D(y, 8, 11), name: '山の日 Mountain Day' });
  r.push({ date: y >= 2003 ? nth(y, 9, MON, 3) : D(y, 9, 15), name: '敬老の日 Respect for the Aged Day' });
  const sports = y === 2020 ? D(2020, 7, 24) : y === 2021 ? D(2021, 7, 23) : nth(y, 10, MON, 2);
  r.push({ date: sports, name: y >= 2020 ? 'スポーツの日 Sports Day' : '体育の日 Health and Sports Day' });
  if (y === 2019) {
    r.push({ date: D(2019, 5, 1), name: '即位の日 Enthronement Day' }, { date: D(2019, 10, 22), name: '即位礼正殿の儀 Enthronement Ceremony Day' });
  }
  return r;
}

function jp(y: number): Holiday[] {
  const national = jpNational(y);
  const isNat = new Set(national.map((h) => key(h.date)));
  const out: Holiday[] = national.map((h) => ({ date: h.date, name: h.name }));
  // 国民の休日: a day sandwiched between two national holidays (and not itself a Sunday) is a holiday.
  for (const h of national) {
    const mid = h.date.add({ days: 1 });
    if (!isNat.has(key(mid)) && isNat.has(key(mid.add({ days: 1 }))) && mid.dayOfWeek !== 7) {
      out.push({ date: mid, name: '国民の休日 Citizens’ Holiday' });
      isNat.add(key(mid));
    }
  }
  // 振替休日: a national holiday on a Sunday moves to the next day that isn't a holiday (from 2007; before, Monday only).
  for (const h of national) {
    if (h.date.dayOfWeek !== 7) continue;
    let d = h.date.add({ days: 1 });
    if (y >= 2007) while (isNat.has(key(d))) d = d.add({ days: 1 });
    else if (isNat.has(key(d))) continue;
    isNat.add(key(d));
    out.push({ date: d, name: `振替休日 Substitute holiday (for ${h.name.replace(/^\S+ /, '')})`, actual: h.date });
  }
  return out;
}

function mx(y: number): Raw[] {
  const r: Raw[] = [
    { date: D(y, 1, 1), name: 'Año Nuevo (New Year’s Day)' },
    { date: nth(y, 2, MON, 1), name: 'Día de la Constitución (Constitution Day)' },
    { date: nth(y, 3, MON, 3), name: 'Natalicio de Benito Juárez (Benito Juárez’s Birthday)' },
    { date: D(y, 5, 1), name: 'Día del Trabajo (Labour Day)' },
    { date: D(y, 9, 16), name: 'Día de la Independencia (Independence Day)' },
    { date: nth(y, 11, MON, 3), name: 'Día de la Revolución (Revolution Day)' },
    { date: D(y, 12, 25), name: 'Navidad (Christmas Day)' },
  ];
  // Transfer of federal executive power, every six years: 1 December until 2018, 1 October from 2024.
  if (y >= 2024 && (y - 2024) % 6 === 0) r.push({ date: D(y, 10, 1), name: 'Transmisión del Poder Ejecutivo Federal (presidential inauguration)' });
  if (y <= 2018 && (2018 - y) % 6 === 0) r.push({ date: D(y, 12, 1), name: 'Transmisión del Poder Ejecutivo Federal (presidential inauguration)' });
  return r;
}

function br(y: number): Raw[] {
  const e = easter(y);
  const r: Raw[] = [
    { date: D(y, 1, 1), name: 'Confraternização Universal (New Year’s Day)' },
    { date: e.subtract({ days: 2 }), name: 'Paixão de Cristo (Good Friday)' },
    { date: D(y, 4, 21), name: 'Tiradentes' },
    { date: D(y, 5, 1), name: 'Dia do Trabalho (Labour Day)' },
    { date: D(y, 9, 7), name: 'Independência do Brasil (Independence Day)' },
    { date: D(y, 10, 12), name: 'Nossa Senhora Aparecida' },
    { date: D(y, 11, 2), name: 'Finados (All Souls’ Day)' },
    { date: D(y, 11, 15), name: 'Proclamação da República (Republic Day)' },
    { date: D(y, 12, 25), name: 'Natal (Christmas Day)' },
  ];
  // Lei 14.759/2023 made Black Consciousness Day a national holiday from 2024.
  if (y >= 2024) r.push({ date: D(y, 11, 20), name: 'Dia Nacional de Zumbi e da Consciência Negra (Black Consciousness Day)' });
  return r;
}

const RULES: Record<CountryCode, (y: number) => Holiday[]> = {
  US: (y) => observe(us(y)),
  'GB-EAW': (y) => observe(eaw(y)),
  'GB-SCT': (y) => observe(sct(y)),
  CA: (y) => observe(ca(y)),
  AU: (y) => observe(au(y)),
  DE: (y) => observe(de(y)),
  FR: (y) => observe(fr(y)),
  IN: (y) => observe(ind(y)),
  JP: jp,
  MX: (y) => observe(mx(y)),
  BR: (y) => observe(br(y)),
};

export const HOLIDAY_YEARS = { max: 2099 };

const cache = new Map<string, Holiday[]>();

/** Days off in `year`, sorted. A holiday observed in an adjacent year (US New Year's Day on 31 Dec) is listed in the year of its day off. */
export function holidaysIn(country: CountryCode, year: number): Holiday[] {
  const info = COUNTRIES[country];
  if (year < info.from || year > HOLIDAY_YEARS.max) throw new RangeError(`Lemma's ${info.name} holiday rules cover ${info.from}–${HOLIDAY_YEARS.max}`);
  const k = `${country}:${year}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const near = [year - 1, year, year + 1].filter((y) => y >= info.from && y <= HOLIDAY_YEARS.max);
  const all = near.flatMap((y) => RULES[country](y)).filter((h) => h.date.year === year);
  all.sort((a, b) => Temporal.PlainDate.compare(a.date, b.date));
  cache.set(k, all);
  return all;
}

/** The holidays whose day off is `date` (usually zero or one). */
export function holidaysOn(country: CountryCode, date: Temporal.PlainDate): Holiday[] {
  return holidaysIn(country, date.year).filter((h) => h.date.equals(date));
}

/** Holidays whose own date is `date` but which are observed on another day. */
export function movedFrom(country: CountryCode, date: Temporal.PlainDate): Holiday[] {
  return [date.year - 1, date.year, date.year + 1]
    .filter((y) => y >= COUNTRIES[country].from && y <= HOLIDAY_YEARS.max)
    .flatMap((y) => holidaysIn(country, y))
    .filter((h) => h.actual?.equals(date));
}

export function isBusinessDay(country: CountryCode | null, d: Temporal.PlainDate): boolean {
  if (d.dayOfWeek >= 6) return false;
  return !country || holidaysOn(country, d).length === 0;
}
