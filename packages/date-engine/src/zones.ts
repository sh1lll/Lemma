/** Resolves "tokyo", "new york", "pst", "UTC", "India", "Europe/Paris" to an IANA zone. */

const ALIASES: Record<string, [zone: string, note?: string]> = {
  utc: ['UTC'], gmt: ['UTC', 'GMT treated as UTC'], z: ['UTC'], zulu: ['UTC'],
  est: ['America/New_York', 'EST read as New York time (switches to EDT in summer)'], edt: ['America/New_York'], et: ['America/New_York'], eastern: ['America/New_York'],
  cst: ['America/Chicago', 'CST read as Chicago time (switches to CDT in summer)'], cdt: ['America/Chicago'], ct: ['America/Chicago'], central: ['America/Chicago'],
  mst: ['America/Denver', 'MST read as Denver time (Arizona stays on MST all year)'], mdt: ['America/Denver'], mountain: ['America/Denver'],
  pst: ['America/Los_Angeles', 'PST read as Los Angeles time (switches to PDT in summer)'], pdt: ['America/Los_Angeles'], pt: ['America/Los_Angeles'], pacific: ['America/Los_Angeles'],
  akst: ['America/Anchorage'], hst: ['Pacific/Honolulu'],
  bst: ['Europe/London'], cet: ['Europe/Paris'], cest: ['Europe/Paris'], eet: ['Europe/Athens'], wet: ['Europe/Lisbon'],
  ist: ['Asia/Kolkata', 'IST read as India Standard Time'], jst: ['Asia/Tokyo'], kst: ['Asia/Seoul'], hkt: ['Asia/Hong_Kong'], sgt: ['Asia/Singapore'],
  aest: ['Australia/Sydney'], aedt: ['Australia/Sydney'], awst: ['Australia/Perth'], nzst: ['Pacific/Auckland'], nzdt: ['Pacific/Auckland'],
  nyc: ['America/New_York'], 'new york city': ['America/New_York'], la: ['America/Los_Angeles'], 'san francisco': ['America/Los_Angeles'], sf: ['America/Los_Angeles'],
  seattle: ['America/Los_Angeles'], boston: ['America/New_York'], miami: ['America/New_York'], washington: ['America/New_York'], dc: ['America/New_York'],
  atlanta: ['America/New_York'], dallas: ['America/Chicago'], houston: ['America/Chicago'], austin: ['America/Chicago'], 'las vegas': ['America/Los_Angeles'],
  montreal: ['America/Toronto'], beijing: ['Asia/Shanghai'], delhi: ['Asia/Kolkata'], 'new delhi': ['Asia/Kolkata'], mumbai: ['Asia/Kolkata'], bangalore: ['Asia/Kolkata'],
  'ho chi minh city': ['Asia/Ho_Chi_Minh'], saigon: ['Asia/Ho_Chi_Minh'], 'tel aviv': ['Asia/Jerusalem'], munich: ['Europe/Berlin'], milan: ['Europe/Rome'],
  barcelona: ['Europe/Madrid'], geneva: ['Europe/Zurich'], edinburgh: ['Europe/London'], manchester: ['Europe/London'], 'rio de janeiro': ['America/Sao_Paulo'], rio: ['America/Sao_Paulo'],
  'cape town': ['Africa/Johannesburg'],
  // Zones renamed since the ICU data many runtimes ship ("Asia/Calcutta"), so the city index alone misses them.
  kolkata: ['Asia/Kolkata'], calcutta: ['Asia/Kolkata'], kathmandu: ['Asia/Kathmandu'], kyiv: ['Europe/Kyiv'], kiev: ['Europe/Kyiv'],
  yangon: ['Asia/Yangon'], rangoon: ['Asia/Yangon'], nuuk: ['America/Nuuk'], asmara: ['Africa/Asmara'], 'ho chi minh': ['Asia/Ho_Chi_Minh'],
  faroe: ['Atlantic/Faroe'], 'faroe islands': ['Atlantic/Faroe'], arizona: ['America/Phoenix', 'Most of Arizona stays on MST all year'], hawaii: ['Pacific/Honolulu'], alaska: ['America/Anchorage'], osaka: ['Asia/Tokyo'], kyoto: ['Asia/Tokyo'], melbourne: ['Australia/Melbourne'], 'hong kong': ['Asia/Hong_Kong'],
  // Countries with one zone (or an obvious main one).
  japan: ['Asia/Tokyo'], india: ['Asia/Kolkata'], china: ['Asia/Shanghai'], 'south korea': ['Asia/Seoul'], korea: ['Asia/Seoul'], singapore: ['Asia/Singapore'],
  uk: ['Europe/London'], 'united kingdom': ['Europe/London'], england: ['Europe/London'], britain: ['Europe/London'], ireland: ['Europe/Dublin'],
  france: ['Europe/Paris'], germany: ['Europe/Berlin'], spain: ['Europe/Madrid'], italy: ['Europe/Rome'], netherlands: ['Europe/Amsterdam'], switzerland: ['Europe/Zurich'],
  sweden: ['Europe/Stockholm'], norway: ['Europe/Oslo'], poland: ['Europe/Warsaw'], greece: ['Europe/Athens'], turkey: ['Europe/Istanbul'], israel: ['Asia/Jerusalem'],
  uae: ['Asia/Dubai'], egypt: ['Africa/Cairo'], nigeria: ['Africa/Lagos'], kenya: ['Africa/Nairobi'], 'south africa': ['Africa/Johannesburg'], philippines: ['Asia/Manila'],
  thailand: ['Asia/Bangkok'], vietnam: ['Asia/Ho_Chi_Minh'], indonesia: ['Asia/Jakarta', 'Indonesia has three zones; using Jakarta'], pakistan: ['Asia/Karachi'], bangladesh: ['Asia/Dhaka'],
  'new zealand': ['Pacific/Auckland'], argentina: ['America/Argentina/Buenos_Aires'], colombia: ['America/Bogota'], peru: ['America/Lima'], chile: ['America/Santiago'],
  usa: ['America/New_York', 'The US has several zones; using Eastern'], us: ['America/New_York', 'The US has several zones; using Eastern'],
  canada: ['America/Toronto', 'Canada has several zones; using Toronto'], australia: ['Australia/Sydney', 'Australia has several zones; using Sydney'],
  brazil: ['America/Sao_Paulo', 'Brazil has several zones; using São Paulo'], mexico: ['America/Mexico_City'], russia: ['Europe/Moscow', 'Russia has many zones; using Moscow'],
};

let cityIndex: Map<string, string> | null = null;

function cities(): Map<string, string> {
  if (cityIndex) return cityIndex;
  cityIndex = new Map();
  const zones: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  for (const z of zones) {
    const city = z.split('/').pop()!.replace(/_/g, ' ').toLowerCase();
    if (!cityIndex.has(city)) cityIndex.set(city, z);
    cityIndex.set(z.toLowerCase(), z);
  }
  return cityIndex;
}

export function resolveZone(raw: string): { zone: string; label: string; note?: string } | null {
  const t = raw.trim().toLowerCase().replace(/[?.!]+$/, '').replace(/^the /, '').replace(/ time$/, '');
  if (!t) return null;
  const alias = ALIASES[t];
  if (alias) return { zone: alias[0], label: titleCase(raw.trim()), note: alias[1] };
  const z = cities().get(t) ?? ianaId(raw.trim());
  if (z) return { zone: z, label: placeName(t.includes('/') ? z.split('/').pop()!.replace(/_/g, ' ') : t) };
  // UTC offsets: utc+5:30, gmt-8.
  const m = /^(?:utc|gmt) ?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(t);
  if (m) {
    const off = `${m[1]}${m[2]!.padStart(2, '0')}:${m[3] ?? '00'}`;
    return { zone: off, label: `UTC${off}` };
  }
  return null;
}

const SHORT_PLACES = new Set(['kyiv', 'kiev', 'nuuk', 'rio']);

/** Abbreviations ("pst", "nyc", "uk") are upper-cased; place names are title-cased. */
function titleCase(s: string): string {
  return s.length <= 4 && !/\s/.test(s) && !SHORT_PLACES.has(s.toLowerCase()) ? s.toUpperCase() : placeName(s);
}

const placeName = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** An IANA id the runtime accepts even when its own list spells it differently ("Asia/Kolkata" vs "Asia/Calcutta"). */
function ianaId(raw: string): string | null {
  if (!/^[a-z]+(?:\/[a-z0-9_+-]+)+$/i.test(raw)) return null;
  const id = raw
    .split('/')
    .map((p) => p.split('_').map((w) => (w.length > 2 || p === raw.split('/')[0] ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w)).join('_'))
    .join('/');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id });
    return id;
  } catch {
    return null;
  }
}
