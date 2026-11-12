import { NUM, fail, named, need, num, pct, res, show, type Ctx, type Handler } from './util';

const S = 'social' as const;

interface Ballot {
  n: number;
  ranking: string[];
}
/** "5 A>B>C, 4 B>C>A" or "A>B>C: 5; B>C>A: 4" or "5: A,B" (approval). */
function ballots(text: string): Ballot[] | null {
  const body = text.replace(/^.*?(?:ballots?|votes?|preferences?|profile)\s*(?:are|is)?\s*:?\s*/i, '');
  const out: Ballot[] = [];
  for (const part of body.split(/\s*[;\n]\s*|,\s*(?=\d+\s*(?:x\s*|×\s*|voters?\s*|people\s*|:)?\s*[A-Za-z])|,\s*(?=[A-Za-z][^,]*?[>:]\s*)/)) {
    const p = part.trim();
    if (!p) continue;
    let m = /^(\d+)\s*(?:x|×|voters?|people|ballots?)?\s*:?\s*(?:prefer\s+)?([A-Za-z][\w ]*(?:\s*(?:>|,|\s)\s*[A-Za-z][\w ]*)*)$/.exec(p);
    let n: number;
    let rk: string;
    if (m) [n, rk] = [Number(m[1]), m[2]!];
    else {
      m = /^([A-Za-z][\w ]*(?:\s*(?:>|,)\s*[A-Za-z][\w ]*)*)\s*[:=x×]\s*(\d+)$/.exec(p);
      if (!m) return null;
      [n, rk] = [Number(m[2]), m[1]!];
    }
    const ranking = rk.split(/\s*(?:>|,|\bthen\b)\s*|\s+/).map((x) => x.trim()).filter(Boolean);
    if (!ranking.length) return null;
    out.push({ n, ranking });
  }
  return out.length ? out : null;
}

const voting: Handler = (c) => {
  const method = /ranked.?choice|instant.?runoff|\birv\b|alternative vote/.test(c.s) ? 'irv' : /borda/.test(c.s) ? 'borda' : /condorcet|pairwise|head.?to.?head|copeland/.test(c.s) ? 'condorcet' : /approval/.test(c.s) ? 'approval' : /plurality|first.?past|most first.?place|winner of (?:the )?(?:election|vote)/.test(c.s) ? 'plurality' : null;
  if (!method || !/ballot|vote|voter|prefer|election|>/.test(c.s)) return null;
  const bs = ballots(c.t);
  if (!bs) return need(c, S, 'Give the ballots as "count ranking", e.g. "5 A>B>C, 4 B>C>A, 3 C>B>A"');
  const cands = [...new Set(bs.flatMap((b) => b.ranking))];
  const total = bs.reduce((s, b) => s + b.n, 0);
  const tally = (f: (b: Ballot) => string[]) => {
    const t = new Map(cands.map((x) => [x, 0]));
    for (const b of bs) for (const x of f(b)) t.set(x, (t.get(x) ?? 0) + b.n);
    return t;
  };
  const winners = (t: Map<string, number>) => {
    const max = Math.max(...t.values());
    return [...t].filter(([, v]) => v === max).map(([k]) => k);
  };
  const tableOf = (t: Map<string, number>, col: string) => ({ columns: ['Candidate', col], rows: [...t].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, show(v)]) });
  const tieNote = (w: string[]) => (w.length > 1 ? [`Tie between ${w.join(' and ')}; a tie-break rule is needed`] : []);
  if (method === 'plurality') {
    const t = tally((b) => [b.ranking[0]!]);
    const w = winners(t);
    return res(c, { kind: S, expression: `Plurality winner (${total} voters)`, display: w.join(', '), table: tableOf(t, 'First-place votes'), lines: [['Majority?', (t.get(w[0]!) ?? 0) > total / 2 ? 'yes' : 'no (plurality only)']], notes: tieNote(w) });
  }
  if (method === 'approval') {
    const t = tally((b) => b.ranking);
    const w = winners(t);
    return res(c, { kind: S, expression: `Approval voting (${total} voters)`, display: w.join(', '), table: tableOf(t, 'Approvals'), notes: tieNote(w) });
  }
  if (method === 'borda') {
    const n = cands.length;
    const t = new Map(cands.map((x) => [x, 0]));
    for (const b of bs) b.ranking.forEach((x, i) => t.set(x, t.get(x)! + b.n * (n - 1 - i)));
    const w = winners(t);
    return res(c, { kind: S, expression: `Borda count (${n} candidates, ${total} voters)`, display: w.join(', '), table: tableOf(t, 'Borda points'), lines: [['Points', `${n - 1} for 1st down to 0 for last`]], notes: tieNote(w) });
  }
  const prefers = (a: string, b: string) => bs.reduce((s, bl) => {
    const ia = bl.ranking.indexOf(a);
    const ib = bl.ranking.indexOf(b);
    return s + ((ia >= 0 && (ib < 0 || ia < ib)) ? bl.n : 0);
  }, 0);
  if (method === 'condorcet') {
    const rows: string[][] = [];
    const wins = new Map(cands.map((x) => [x, 0]));
    for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
      const [a, b] = [cands[i]!, cands[j]!];
      const ab = prefers(a, b);
      const ba = prefers(b, a);
      rows.push([`${a} vs ${b}`, `${ab}–${ba}`, ab > ba ? a : ba > ab ? b : 'tie']);
      if (ab > ba) wins.set(a, wins.get(a)! + 1);
      else if (ba > ab) wins.set(b, wins.get(b)! + 1);
      else {
        wins.set(a, wins.get(a)! + 0.5);
        wins.set(b, wins.get(b)! + 0.5);
      }
    }
    const cw = cands.find((x) => wins.get(x) === cands.length - 1);
    return res(c, { kind: S, expression: `Condorcet (pairwise) comparison, ${total} voters`, display: cw ? `${cw} (Condorcet winner)` : 'No Condorcet winner (a cycle)', table: { columns: ['Matchup', 'Votes', 'Winner'], rows }, lines: [['Copeland scores', [...wins].map(([k, v]) => `${k} ${show(v)}`).join(', ')]] });
  }
  // Instant runoff
  let alive = new Set(cands);
  const rounds: string[][] = [];
  for (let round = 1; round <= cands.length; round++) {
    const t = new Map([...alive].map((x) => [x, 0]));
    for (const b of bs) {
      const top = b.ranking.find((x) => alive.has(x));
      if (top) t.set(top, t.get(top)! + b.n);
    }
    const active = [...t.values()].reduce((s, v) => s + v, 0);
    rounds.push([`Round ${round}`, [...t].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')]);
    const [lead, lv] = [...t].sort((a, b) => b[1] - a[1])[0]!;
    if (lv > active / 2 || alive.size === 1) return res(c, { kind: S, expression: `Ranked-choice (instant runoff), ${total} voters`, display: lead, table: { columns: ['Round', 'Tally'], rows: rounds }, lines: [['Winning share', `${lv}/${active} = ${pct(lv / active)}`]], notes: ['Lowest candidate eliminated each round; ties for last eliminate all tied (noted)'] });
    const min = Math.min(...t.values());
    const out = [...t].filter(([, v]) => v === min).map(([k]) => k);
    if (out.length === alive.size) return res(c, { kind: S, expression: 'Ranked-choice (instant runoff)', display: `Tie: ${out.join(', ')}`, table: { columns: ['Round', 'Tally'], rows: rounds } });
    alive = new Set([...alive].filter((x) => !out.includes(x)));
    rounds[rounds.length - 1]!.push(`eliminate ${out.join(', ')}`);
  }
  return fail(c, S, 'Ranked-choice count did not finish');
};

const apportion: Handler = (c) => {
  const method = /hamilton|largest remainder|vinton/.test(c.s) ? 'hamilton' : /jefferson|d'?hondt/.test(c.s) ? 'jefferson' : /webster|sainte.?lagu[eë]/.test(c.s) ? 'webster' : /huntington|hill|equal proportions/.test(c.s) ? 'hh' : /adams/.test(c.s) ? 'adams' : null;
  if (!method || !/apportion|seats|allocat|representatives|divisor/.test(c.s)) return null;
  const seatsM = new RegExp(String.raw`(${NUM})\s*seats|seats\s*(?:=|:)?\s*(${NUM})`).exec(c.s);
  if (!seatsM) return need(c, S, 'How many seats?');
  const H = num(seatsM[1] ?? seatsM[2]!);
  const body = c.t.slice(0, seatsM.index) + ' ' + c.t.slice(seatsM.index + seatsM[0].length);
  const pairs = [...body.matchAll(new RegExp(String.raw`([A-Za-z][\w]*)\s*(?:=|:|with|has)?\s*(${NUM})`, 'g'))].filter((m) => !/^(?:hamilton|jefferson|webster|huntington|hill|adams|apportion|populations?|states?|seats|method|using|divide|among|between|and)$/i.test(m[1]!));
  let names: string[];
  let pops: number[];
  if (pairs.length >= 2) [names, pops] = [pairs.map((m) => m[1]!), pairs.map((m) => num(m[2]!))];
  else {
    const ns = [...body.matchAll(new RegExp(NUM, 'g'))].map((m) => num(m[0]));
    if (ns.length < 2) return need(c, S, 'Give the populations, e.g. "A 1500, B 3200, C 5300"');
    pops = ns;
    names = ns.map((_, i) => String.fromCharCode(65 + i));
  }
  const P = pops.reduce((s, x) => s + x, 0);
  const std = P / H;
  const quotas = pops.map((p) => p / std);
  let seats: number[];
  let divisor = std;
  if (method === 'hamilton') {
    seats = quotas.map(Math.floor);
    const left = H - seats.reduce((s, x) => s + x, 0);
    const order = quotas.map((q, i) => [q - Math.floor(q), i] as [number, number]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < left; k++) seats[order[k]![1]]! += 1;
  } else {
    const round = (q: number) => (method === 'jefferson' ? Math.floor(q) : method === 'adams' ? Math.ceil(q) : method === 'webster' ? Math.round(q) : q < Math.floor(q) + (Math.sqrt(Math.floor(q) * (Math.floor(q) + 1)) - Math.floor(q)) ? Math.floor(q) : Math.floor(q) + 1);
    // Priority-list (highest averages) implementation, equivalent to finding the modified divisor.
    seats = pops.map(() => (method === 'hh' || method === 'adams' ? 1 : 0));
    const div = (s: number) => (method === 'jefferson' ? s + 1 : method === 'webster' ? s + 0.5 : method === 'adams' ? s : Math.sqrt(s * (s + 1)));
    let given = seats.reduce((a, b) => a + b, 0);
    if (given > H) return fail(c, S, 'More states than seats: every state gets at least one seat under this method');
    while (given < H) {
      let best = -1;
      let bv = -Infinity;
      pops.forEach((p, i) => {
        const v = p / div(seats[i]!);
        if (v > bv) [bv, best] = [v, i];
      });
      seats[best]! += 1;
      given++;
    }
    // Report a modified divisor that reproduces the result.
    let lo = 0;
    let hi = P;
    for (let k = 0; k < 200; k++) {
      const m = (lo + hi) / 2;
      const s = pops.reduce((a, p) => a + round(p / m), 0);
      if (s > H) lo = m;
      else hi = m;
    }
    divisor = (lo + hi) / 2;
  }
  const name = { hamilton: 'Hamilton (largest remainder)', jefferson: "Jefferson (D'Hondt)", webster: 'Webster (Sainte-Laguë)', hh: 'Huntington–Hill', adams: 'Adams' }[method];
  return res(c, {
    kind: S,
    expression: `${name} apportionment of ${show(H)} seats`,
    display: names.map((n, i) => `${n} ${seats[i]}`).join(', '),
    table: { columns: ['State', 'Population', 'Standard quota', 'Seats'], rows: names.map((n, i) => [n, show(pops[i]!, 8), show(quotas[i]!, 4), String(seats[i])]) },
    lines: [['Standard divisor', show(std, 6)], ...(method === 'hamilton' ? [] : [['Modified divisor (approx.)', show(divisor, 6)] as [string, string]])],
  });
};

const demography: Handler = (c) => {
  if (!/birth rate|death rate|mortality rate|natural increase|crude|dependency ratio|fertility|infant mortality|per (?:1,?000|thousand)|net migration/.test(c.s)) return null;
  const pop = named(c, 'population|pop|people|residents|mid-?year population') ?? (new RegExp(String.raw`(${NUM})\s*(million|thousand)?\s*(?:people|population|residents|inhabitants)`).exec(c.s) ? (() => {
    const m = new RegExp(String.raw`(${NUM})\s*(million|thousand)?\s*(?:people|population|residents|inhabitants)`).exec(c.s)!;
    return num(m[1]!) * (m[2] === 'million' ? 1e6 : m[2] === 'thousand' ? 1e3 : 1);
  })() : null);
  const popM = /population\s*(?:of|=|:)?\s*(\d[\d,.]*)\s*(million|thousand)/.exec(c.s);
  const P = popM ? num(popM[1]!) * (popM[2] === 'million' ? 1e6 : 1e3) : pop;
  const get = (w: string) => named(c, w) ?? (new RegExp(String.raw`(${NUM})\s*(?:${w})`).exec(c.s) ? num(new RegExp(String.raw`(${NUM})\s*(?:${w})`).exec(c.s)![1]!) : null);
  if (/dependency ratio/.test(c.s)) {
    const young = get('young|children|under 15|0-14|youth');
    const old = get('old|elderly|over 65|65\\+|aged|seniors');
    const work = get('working(?:.age)?|15-64|adults');
    if (young === null || old === null || work === null) return need(c, S, 'Dependency ratio needs young (0–14), old (65+) and working-age (15–64) counts');
    return res(c, { kind: S, expression: 'Total dependency ratio', value: ((young + old) / work) * 100, display: `${show(((young + old) / work) * 100)} per 100 working-age`, formula: '(young + old) / working-age × 100', lines: [['Youth ratio', show((young / work) * 100)], ['Old-age ratio', show((old / work) * 100)]] });
  }
  if (/infant mortality/.test(c.s)) {
    const deaths = get('infant deaths|deaths');
    const births = get('live births|births');
    if (deaths === null || births === null) return need(c, S, 'Infant mortality needs infant deaths and live births');
    return res(c, { kind: S, expression: 'Infant mortality rate', value: (deaths / births) * 1000, unit: 'per 1,000 live births', formula: 'infant deaths / live births × 1000' });
  }
  if (P === null) return need(c, S, 'What is the (mid-year) population?');
  const births = get('births');
  const deaths = get('deaths');
  const lines: [string, string][] = [];
  if (births !== null) lines.push(['Crude birth rate', `${show((births / P) * 1000)} per 1,000`]);
  if (deaths !== null) lines.push(['Crude death rate', `${show((deaths / P) * 1000)} per 1,000`]);
  if (births !== null && deaths !== null) {
    const rni = ((births - deaths) / P) * 100;
    lines.push(['Rate of natural increase', `${show(rni)}%`], ['Doubling time (if sustained)', rni > 0 ? `${show(Math.LN2 / Math.log(1 + rni / 100))} years` : '—']);
  }
  if (!lines.length) return null;
  const which = /death|mortality/.test(c.s) && !/birth/.test(c.s) ? 'death' : /natural increase/.test(c.s) && births !== null && deaths !== null ? 'rni' : births !== null ? 'birth' : 'death';
  const value = which === 'birth' ? (births! / P) * 1000 : which === 'death' ? (deaths! / P) * 1000 : ((births! - deaths!) / P) * 100;
  return res(c, { kind: S, expression: which === 'rni' ? 'Rate of natural increase' : `Crude ${which} rate`, value, unit: which === 'rni' ? '%' : 'per 1,000', formula: which === 'rni' ? '(births − deaths) / population × 100' : `${which}s / population × 1000`, lines });
};

export const social: Handler[] = [voting, apportion, demography];
export type { Ctx };
