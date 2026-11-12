import { classify, TOPICS, type Topic } from '@lemma/practice-engine';

/** Topic ids in the practice engine's order (used to break ties deterministically). */
export const TOPIC_IDS: readonly Topic[] = TOPICS.map((t) => t.id);

export function topicLabel(t: Topic): string {
  return TOPICS.find((x) => x.id === t)?.label ?? t;
}

/** Lower-case noun for sentences: "Review integrals today". */
export function topicNoun(t: Topic): string {
  const nouns: Partial<Record<Topic, string>> = {
    arithmetic: 'order of operations',
    units: 'unit conversion',
    money: 'money and tips',
    system: 'systems of equations',
    linear: 'linear equations',
    quadratic: 'quadratic equations',
  };
  return nouns[t] ?? topicLabel(t).toLowerCase();
}

/** Singular form before "problems": "5 integral problems". */
export function topicAdjective(t: Topic): string {
  const adj: Record<Topic, string> = {
    arithmetic: 'order-of-operations',
    fractions: 'fraction',
    percent: 'percentage',
    linear: 'linear equation',
    quadratic: 'quadratic',
    system: 'systems',
    exponents: 'exponent',
    derivative: 'derivative',
    integral: 'integral',
    units: 'unit conversion',
    stats: 'statistics',
    geometry: 'geometry',
    money: 'money',
  };
  return adj[t];
}

/** Words in a task or event that name a topic. Checked in order; a phrase can name several topics. */
const KEYWORDS: [Topic, RegExp][] = [
  ['derivative', /\bderivatives?\b|\bdifferentiat\w*|\bchain rule\b|\bproduct rule\b|\bquotient rule\b|\btangent lines?\b|\brelated rates\b|\boptimi[sz]ation\b|\bl'?h[oô]pital\w*/],
  ['integral', /\bintegra(?:l|ls|te|tes|tion)\b|\bantiderivatives?\b|\bu-?sub(?:stitution)?\b|\briemann\b|\barea under\b/],
  ['quadratic', /\bquadratics?\b|\bparabolas?\b|\bfactoring\b|\bcompleting the square\b/],
  ['system', /\bsystems? of (?:linear )?equations\b|\bsimultaneous equations\b|\bsystems\b/],
  ['linear', /\blinear (?:equations?|functions?|inequalit\w+)\b|\bslopes?\b|\bsolving equations\b/],
  ['exponents', /\bexponents?\b|\bexponentials?\b|\bpowers\b|\bradicals?\b|\blogarithms?\b|\blogs\b/],
  ['fractions', /\bfractions?\b|\brational numbers\b/],
  ['percent', /\bpercent(?:ages?)?\b|%/],
  ['stats', /\bstat(?:s|istics)\b|\bprobability\b|\bmean\b|\bmedian\b|\bstandard deviation\b|\bregression\b|\bdistributions?\b/],
  ['geometry', /\bgeometry\b|\btriangles?\b|\bcircles?\b|\bpythag\w*|\bvolumes?\b|\bperimeters?\b|\btrig(?:onometry)?\b|\bangles\b/],
  ['units', /\bunit conversions?\b|\bconverting units\b|\bdimensional analysis\b|\bconversions\b/],
  ['money', /\binterest\b|\bfinance\b|\bmoney\b|\bbudget\w*|\btips\b/],
  ['arithmetic', /\barithmetic\b|\border of operations\b|\bpemdas\b|\bbodmas\b/],
];

/** Subjects that imply topics when none are named. Order matters: "precalc" before "calc". */
const SUBJECTS: [RegExp, Topic[]][] = [
  [/\bpre-?calc(?:ulus)?\b/, ['exponents', 'quadratic']],
  [/\bcalc(?:ulus)?\b|\bap calc\b/, ['derivative', 'integral']],
  [/\balgebra\b|\balg ?[12i]+\b/, ['linear', 'quadratic', 'system', 'exponents']],
];

/** Topics named in free text, in practice-engine order, without duplicates. */
export function topicsIn(text: string): Topic[] {
  const low = text.toLowerCase();
  const found = new Set<Topic>();
  for (const [t, re] of KEYWORDS) if (re.test(low)) found.add(t);
  return TOPIC_IDS.filter((t) => found.has(t));
}

export function subjectTopics(text: string): Topic[] {
  const low = text.toLowerCase();
  for (const [re, ts] of SUBJECTS) if (re.test(low)) return [...ts];
  return [];
}

/** Maps whatever the app passes as a topic (id, label, keyword, or a problem) to a Topic, or undefined. */
export function normalizeTopic(raw: string | undefined | null): Topic | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const low = s.toLowerCase();
  const byId = TOPIC_IDS.find((t) => t === low);
  if (byId) return byId;
  const byLabel = TOPICS.find((t) => t.label.toLowerCase() === low);
  if (byLabel) return byLabel.id;
  return topicsIn(s)[0] ?? classify(s) ?? undefined;
}
