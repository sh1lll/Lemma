/**
 * Topic detection: practice-engine's classifier plus keyword rules for course vocabulary it doesn't know
 * (vertex, discriminant, logarithms, limits, chain rule…). Everything maps onto practice-engine's Topic so
 * generation can follow the weights; the finer label is kept as a subtopic.
 */
import { classify, type Topic } from '@lemma/practice-engine';

type Rule = { re: RegExp; topic: Topic; sub?: string };

/** Specific course vocabulary first; the first matching rule decides the topic, every match adds a subtopic. */
const RULES: Rule[] = [
  { re: /\bquantity a\b/i, topic: 'arithmetic', sub: 'quantitative comparison' },
  { re: /\bchain rule\b|\bd\/dx\s*\[?\s*\(.*\)\s*\^|\bcomposite function/i, topic: 'derivative', sub: 'chain rule' },
  { re: /\bproduct rule\b/i, topic: 'derivative', sub: 'product rule' },
  { re: /\bquotient rule\b/i, topic: 'derivative', sub: 'quotient rule' },
  { re: /\bpower rule\b/i, topic: 'derivative', sub: 'power rule' },
  { re: /\bimplicit(?:ly)? differentiat/i, topic: 'derivative', sub: 'implicit differentiation' },
  { re: /\brelated rates?\b/i, topic: 'derivative', sub: 'related rates' },
  { re: /\boptimi[sz]/i, topic: 'derivative', sub: 'optimization' },
  { re: /\btangent line\b|\bslope of the tangent\b/i, topic: 'derivative', sub: 'tangent lines' },
  { re: /\blimits?\b|\blim\b|\bcontinu(?:ous|ity)\b/i, topic: 'derivative', sub: 'limits' },
  { re: /\bmean value theorem\b/i, topic: 'derivative', sub: 'mean value theorem' },
  { re: /\bderivatives?\b|\bdifferentiat|\bd\/dx\b|\bdy\/dx\b|\bf\s*'\s*\(x\)|\binstantaneous rate\b/i, topic: 'derivative' },
  { re: /\bu-?substitution\b/i, topic: 'integral', sub: 'u-substitution' },
  { re: /\bdefinite integral\b|∫_|\bintegra(?:l|te)\b.*\bfrom\s+x\s*=.*\bto\b/i, topic: 'integral', sub: 'definite integrals' },
  { re: /\bantiderivative|\bintegra(?:l|te|tion)\b|∫|\barea under\b|\briemann\b/i, topic: 'integral' },
  { re: /\bcompound(?:ed)? (?:interest|annually|monthly|quarterly)|\bcompounded\b/i, topic: 'money', sub: 'compound interest' },
  { re: /\blog(?:arithm)?s?\b|\bln\b/i, topic: 'exponents', sub: 'logarithms' },
  { re: /\bexponential\b|\bdoubles\b|\bhalf-life\b|\bgrowth factor\b|\bdecay\b|\b(?:in|de)creases by \d+(?:\.\d+)?% (?:each|per|every)\b|\(\d*\.\d+\)\s*\^\s*t\b/i, topic: 'exponents', sub: 'exponential functions' },
  { re: /\bdiscriminant\b/i, topic: 'quadratic', sub: 'discriminant' },
  { re: /\btransformations?\b|\bshift(?:ed|s)?\b.*\bgraph|\bgraph of y\s*=\s*\(x\s*[+-]\s*\d+\)\s*\^\s*2/i, topic: 'quadratic', sub: 'transformations' },
  { re: /\bvertex form\b|\bvertex\b|\baxis of symmetry\b|\bparabola\b|\bmaximum height\b|\bminimum value\b/i, topic: 'quadratic', sub: 'vertex form' },
  { re: /\bcomplet(?:e|ing) the square\b/i, topic: 'quadratic', sub: 'completing the square' },
  { re: /\bquadratic formula\b/i, topic: 'quadratic', sub: 'quadratic formula' },
  { re: /\bfactor(?:ing|ed)?\b(?:.*(?:x\s*\^\s*2|x²))?|\bzeros?\b|\broots?\b|\bx-intercepts?\b/i, topic: 'quadratic', sub: 'factoring' },
  { re: /\bpolynomials?\b|\bsynthetic division\b|\bend behavior\b|\bdegree of\b/i, topic: 'quadratic', sub: 'polynomials' },
  { re: /\bsystems?\b(?: of equations)?|\bsubstitution method\b|\belimination\b/i, topic: 'system', sub: 'systems of equations' },
  { re: /\bslope\b|\by-intercept\b|\brate of change\b|\bslope-intercept\b|\bpoint-slope\b/i, topic: 'linear', sub: 'slope' },
  { re: /\binequalit(?:y|ies)\b/i, topic: 'linear', sub: 'inequalities' },
  { re: /\bdomain\b|\brange\b(?! of)|\binverse function\b|\bcomposition\b|\bf\s*\(\s*g\s*\(/i, topic: 'linear', sub: 'functions' },
  { re: /\bsin\b|\bcos\b|\btan\b|\btrigonometr|\bunit circle\b|\bradians?\b/i, topic: 'geometry', sub: 'trigonometry' },
  { re: /\bpythag|\bhypotenuse\b|\bright triangle\b/i, topic: 'geometry', sub: 'pythagorean theorem' },
  { re: /\bprobabilit|\bodds\b|\bat random\b/i, topic: 'stats', sub: 'probability' },
  { re: /\bscatter ?plot\b|\bline of best fit\b|\bregression\b/i, topic: 'stats', sub: 'data analysis' },
  { re: /\bsequence\b|\bseries\b|\bnth term\b|\bcommon (?:ratio|difference)\b/i, topic: 'arithmetic', sub: 'sequences' },
  { re: /\bradicals?\b|\bsquare roots?\b|√/i, topic: 'exponents', sub: 'radicals' },
  { re: /\d\s*\^\s*-\s*\d/, topic: 'exponents', sub: 'negative exponents' },
  { re: /\([^()]*[a-z]\s*\^\s*\d[^()]*\)\s*\(\s*[^()]*[a-z]\s*\^\s*\d|\b[a-z]\s*\^\s*\d+\s*\/\s*[a-z]\s*\^\s*\d+/i, topic: 'exponents', sub: 'exponent rules' },
  { re: /\bexponents?\b|\bpowers?\b/i, topic: 'exponents', sub: 'exponent rules' },
  { re: /\bpercent(?:age)?\b|%/i, topic: 'percent' },
  { re: /\bmean\b|\bmedian\b|\bmode\b|\baverage\b|\bstandard deviation\b/i, topic: 'stats' },
];

/** Topic and subtopics of a question or heading, or null topic when nothing matches. */
export function classifyText(text: string): { topic: Topic | null; subtopics: string[] } {
  const t = text.replace(/\s+/g, ' ');
  let topic: Topic | null = null;
  const subs: string[] = [];
  for (const r of RULES) {
    if (!r.re.test(t)) continue;
    topic ??= r.topic;
    if (r.sub && !subs.includes(r.sub)) subs.push(r.sub);
  }
  // practice-engine knows computational phrasing better ("Solve 3x + 5 = 20", "15% tip") — use it when the
  // vocabulary rules didn't fire or only picked something generic.
  const engine = classify(t);
  if (!topic || (topic === 'percent' && engine && engine !== 'percent')) topic = engine ?? topic;
  if (!topic) {
    if (/x\s*\^\s*2|x²/.test(t)) topic = 'quadratic';
    else if (/[a-z0-9)]\s*\^\s*[-−]?\d/i.test(t)) topic = 'exponents';
    else if (/=/.test(t) && /\bx\b|\dx\b/.test(t)) topic = 'linear';
    else if (/\d\s*\/\s*\d/.test(t)) topic = 'fractions';
    else if (/^[\s\d.+\-*/^()×÷−]+$/.test(t) && /\d/.test(t)) topic = 'arithmetic';
  }
  if (topic === 'quadratic' && /\bfactor/i.test(t) && !subs.includes('factoring')) subs.push('factoring');
  if (topic === 'derivative' && /\(.*\)\s*\^\s*\d|\b(?:sin|cos|e\^)\s*\(\s*\d*x\s*\^/.test(t) && !subs.includes('chain rule')) subs.push('chain rule');
  return { topic, subtopics: subs };
}

export type TopicWeight = { topic: Topic; weight: number; subtopics?: string[] };

/** Accumulates weighted topic evidence and normalises to weights summing to 1. */
export class TopicTally {
  private w = new Map<Topic, number>();
  private subs = new Map<Topic, Map<string, number>>();
  add(topic: Topic | null, weight: number, subtopics: string[] = []): void {
    if (!topic || weight <= 0) return;
    this.w.set(topic, (this.w.get(topic) ?? 0) + weight);
    const m = this.subs.get(topic) ?? new Map<string, number>();
    for (const s of subtopics) m.set(s, (m.get(s) ?? 0) + weight);
    this.subs.set(topic, m);
  }
  addText(text: string, weight: number): void {
    const c = classifyText(text);
    this.add(c.topic, weight, c.subtopics);
  }
  merge(list: TopicWeight[], scale: number): void {
    for (const t of list) this.add(t.topic, t.weight * scale, t.subtopics ?? []);
  }
  result(): TopicWeight[] {
    const total = [...this.w.values()].reduce((a, b) => a + b, 0);
    if (!total) return [];
    return [...this.w.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([topic, weight]) => {
        const subs = [...(this.subs.get(topic) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
        const out: TopicWeight = { topic, weight: Math.round((weight / total) * 1000) / 1000 };
        if (subs.length) out.subtopics = subs;
        return out;
      });
  }
}
