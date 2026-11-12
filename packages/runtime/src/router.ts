import { calculate, createSession, delatex, MathError, type Answer, type AnswerResult, type CalcOptions, type CalcSuccess, type Session } from '@lemma/math-core';
import type { ConversionSuccess } from '@lemma/unit-engine';
import type { SymRequest, SymResult } from '@lemma/symbolic-engine';
import { GATE_STATS_PLUS } from '@lemma/stats-engine/src/plus/gate';
import { MAYBE_APPLIED } from '@lemma/applied-engine/src/check';


/**
 * Lemma's intent router, shared by the web app, the desktop app, the SDK/CLI and (later) the browser extension.
 *
 * Deterministic and synchronous on the hot path: plain arithmetic never waits on anything. Specialised engines
 * load lazily (separate chunks on the web); until one lands, input that needs it reports `pending` with a promise
 * to wait on, and the caller re-runs. `compute()` does that waiting for you.
 */

type UnitEngine = typeof import('@lemma/unit-engine');
type Everyday = typeof import('./engines/everyday');
type Advanced = typeof import('./engines/advanced');
type History = typeof import('./engines/history');
type Simulate = typeof import('./engines/simulate');
type StatsPlus = typeof import('./engines/statsplus');
type Applied = typeof import('./engines/applied');
type Discrete = typeof import('./engines/discrete');
type Quant = typeof import('./engines/quant');
type Shapes = typeof import('./engines/shapes');
type Reference = typeof import('@lemma/reference-data');
export type RatesSnapshot = import('./engines/everyday').RatesSnapshot;
export type GraphSpec = import('./engines/advanced').GraphSpec;

export type Outcome =
  | { kind: 'empty' }
  | { kind: 'calc'; result: CalcSuccess }
  | { kind: 'convert'; result: ConversionSuccess }
  | { kind: 'answer'; result: Answer }
  | { kind: 'graph'; spec: GraphSpec; input: string }
  | { kind: 'error'; error: MathError }
  | { kind: 'pending'; waitFor: Promise<unknown> };

/** Where symbolic (SymPy) requests run: a web worker in browsers, Pyodide in-process under Node. */
export interface SymbolicBackend {
  cached(req: SymRequest): SymResult | undefined;
  /** `preview`: work for a live preview while typing; a backend may hold it back and keep only the latest. */
  run(req: SymRequest, opts?: { preview?: boolean }): Promise<SymResult>;
}

/** Something that can answer inputs before the built-in engines see them (installed plugins). */
export interface IntentHook {
  /** Synchronous: an Outcome, or null to pass. Async work returns `pending`. */
  route(input: string, session: Session): Outcome | null;
}

export interface RouteOptions extends CalcOptions {
  currency?: string;
  liveRates?: boolean;
  rates?: () => RatesSnapshot | null;
  /** Starts (or joins) a rate fetch; rejects when offline with nothing cached. */
  requestRates?: () => Promise<RatesSnapshot>;
  /** A live preview while typing (not Enter): symbolic work for it is speculative, lowest priority. */
  preview?: boolean;
}

export interface RuntimeOptions {
  symbolic?: SymbolicBackend;
  /** Called with load/progress messages ("Downloading the algebra engine…"). */
  onStatus?: (s: string) => void;
  hooks?: IntentHook[];
}

// Until the advanced chunk is loaded these phrases wait for it.
const MAYBE_ADVANCED =
  /\b(?:speed|velocity|how fast|travels?|travell?ed|graph|plot|draw|sketch|derivative|differentiate|d\/d[a-z]|integra\w*|limit|lim|series|taylor|maclaurin|solve|roots?|zeros?|simplify|expand|factor\w*|partial|laplace|det\w*|inverse|eigen\w*|rank|rref|transpose|prime\w*|divisors?|totient|mean|median|mode|std|standard deviation|variance|quartiles?|percentile|probability|binomial|poisson|normal|z-score|regression|correlation|fit\w*|histograms?|scatter\w*|box ?plots?|boxplot|whiskers?|dot ?plots?|shade|bell|surface|3d|3-d|bayes|confidence|t-test|chi|hex|binary|octal|base \d+|molar|moles?|balance|ph|ideal gas|speed of light|constant|area|volume|perimeter|circumference|hypotenuse|triangle|circle|sphere|cylinder|cone|kinetic|momentum|force|velocity|projectile|ohm|density|equals?|equal to|greater than|less than)\b|[=<>≤≥]|\[\[|0x[0-9a-f]|0b[01]|\bi\b|^\s*(?:c|g|h|hbar|k_?b|n_?a|e|G|R)\s+(?:in|to)\s+\S*[/^·*\s]/i;
// Everyday number work answered by the advanced chunk (rounding, fractions, ratios, percent change, Roman numerals…).
const MAYBE_ARITH =
  /[{}∪∩≡ℵω]|(?:%|\bpercent) of what\b|\bwhat percent(?:age)?\b|\b(?:fibonacci|lucas|catalan|collatz|digits?|permutations|arrangements|combinations|ways|derangements?|subsets|congruen\w*|chinese|pell|diophant\w*|primitive|legendre|jacobi|continued|aleph|omega|cardinality|power set|union|intersect\w*|subset|complement|g[öo]del|hypothesis|conjecture|axiom|theorem|paradox|countab\w*|abundant|deficient|palindrom\w*|mersenne|order of|units of|subgroups|field|cycle|sign of|anagrams|trailing|identical|round\w*|fraction|decimal|percent\w*|mixed|improper|simplest|lowest terms|roman|words|notation|standard form|lcd|denominator|share|ratio|original|rate|divisib\w*|multiples?|perfect|gcd|gcf|hcf|lcm|common|estimate|approximate|remainder|quotient|division|spell|ordinal|lakhs?|crores?|basis|bps|dms|bigger|larger|greater|smaller|compare|reduce|even|odd)\b|\.\.\.|…|\d\s*:\s*\d|[万億亿兆]|^\s*[MDCLXVI]+\b|\d\s+\d+\/\d|°\s*\d|\b(?:where|when|given|with) [a-z]\w* ?=|\bis to\b|\bcost|\bvaries|consecutive|opposite|reciprocal|radians/i;
// Kept in step with shape-engine's LOOKS_LIKE_SHAPE (copied so the main bundle doesn't load the engine).
// Words only the discrete/numerical engine answers (kept here so the main bundle doesn't import that package).
const MAYBE_DISCRETE =
  /\b(?:bisection|newton'?s? method|newton[- ]raphson|secant method|fixed[- ]point|regula falsi|false position|interpolat\w*|divided differences?|spline|numerical(?:ly)?|finite differences?|trapez(?:oid|ium)(?:al)? rule|simpson\w*|romberg|riemann sum|quadrature|euler'?s method|runge|rk4|heun\w*|jacobi|seidel|over[- ]?relaxation|power (?:method|iteration)|machine epsilon|ieee|binary(?:32|64)|single precision|double precision|condition number|maximi[sz]e|minimi[sz]e|subject to|linear program\w*|simplex|knapsack|travel+ing salesm[ae]n|tsp|assignment problem|hungarian|transportation problem|branch and bound|kkt|golden[- ]section|gradient descent|shortest path|dijkstra|bellman|floyd|spanning tree|kruskal|prim'?s|max(?:imum)? flow|min(?:imum)? cut|matching|bipartite|euler(?:ian)? (?:path|circuit|cycle)|hamilton\w*|chromatic|planar|centrality|pagerank|topological sort|adjacency|bfs|dfs|breadth[- ]first|depth[- ]first|petersen|entropy|mutual information|kl divergence|kullback|cross[- ]entropy|channel capacity|huffman|shannon|hamming|parity bit|crc|checksum|luhn|isbn|ean|caesar|rot13|atbash|vigen[eè]re|affine cipher|frequency analysis|rsa|diffie|discrete log\w*|modular exponentiation|square[- ]and[- ]multiply|sha-?256|dft|fft|fourier transform|convolution|correlat\w+ of|moving average|fir filter|nyquist|alias\w*|decibels?|qubit|ket|hadamard|cnot|pauli|bloch|entangle\w*|sir model|seir|sis model|logistic (?:growth|map)|lotka|predator|fuzzy|lyapunov|mandelbrot|bifurcation|fractal dimension|box[- ]counting|cellular automat\w*|rule \d+|big[- ]?o|master theorem|euler characteristic|genus|knot|ramsey|nim|m\/m\/\d|m\/d\/1|m\/g\/1|queue\w*|epq|economic production|backorder|quantity discount|decision tree|expected monetary|eol|evpi|zero[- ]sum|payoff|coin change|longest common|edit distance|levenshtein|matrix chain|rod cutting|longest increasing)\b|\|[01+-]+⟩|\|[01]+>/i;

const MAYBE_SHAPE =
  /\b(?:triangles?|hypotenuse|pythag\w*|squares?|rectangles?|rectangular|oblong|rhomb\w*|diamond|parallelograms?|trapez\w*|kites?|polygon|\w+gon|pentagon|hexagon|heptagon|octagon|nonagon|decagon|dodecagon|circles?|circular|semi-?circle|discs?|disks?|sectors?|arcs?|chords?|annulus|ring|ellipses?|ovals?|cubes?|cuboid|box|prism|cylinders?|cylindrical|pipe|tube|cones?|conical|frustum|pyramid|spheres?|ball|hemi-?sphere|dome|spherical|torus|donut|doughnut|capsule|wedge|ellipsoid|spheroid|\w+hedron|midpoint|slope|gradient|distance|line|collinear|reflect\w*|rotat\w*|translat\w*|dilat\w*|locus|plane|foci|focus|directrix|eccentricity|asymptotes?|parabola|hyperbola|conic)\b|\(\s*-?[\d.]+\s*,\s*-?[\d.]+/i;
const LOOKS_LIKE_CONVERSION = /\b(?:to|in|into|as|how many|convert)\b/i;
// Timers and notes. Kept as a local pre-check so the main bundle doesn't need the productivity engine.
const MAYBE_PRODUCTIVITY = /\b(?:timers?|alarm|pomodoro|notes?|remember|cancel|delete|stop the)\b/i;
// Must hold for every phrase the everyday engines accept; misses here would silently fall through to the calculator.
// Inflation (bundled CPI) and dated exchange rates: a separate lazy chunk.
// Quantitative finance / economics / business / risk (own lazy chunk; handlers return null when not theirs).
const MAYBE_QUANT =
  /black\W*scholes|\bbsm\b|black[\s-]*76|\bgreeks?\b|\b(?:delta|gamma|vega|theta|rho)\b|\b(?:call|put)s?\b|\boptions?\b|implied vol|\bbinomial\b|\btrinomial\b|\bamerican\b|\basian\b|\bbarrier\b|\bknock|\bdigital\b|\bbinary\b|\bparity\b|\bforwards?\b|\bfutures?\b|\bswaps?\b|\bbonds?\b|\bytm\b|\byield|\bcoupon|\bmacaulay\b|\bduration\b|\bconvexity\b|\bdv01\b|\baccrued\b|\bmirr\b|\bpayback\b|profitability index|capital budgeting|evaluate (?:the |this )?(?:project|investment)|\bnpv\b.*\birr\b|\bannuit|\bperpetuit|\bconsols?\b|\bnominal\b|\beffective\b|\bcontinuous|\bcompounded\b|\brule of (?:69|70|72)\b|\bdoubl|\btripl|\bhalv|\bportfolio\b|\bfrontier\b|\bmin(?:imum)?[\s-]*var|\bsharpe\b|\btangency\b|\bsortino\b|\btreynor\b|\bjensen|information ratio|\bcalmar\b|\bmodigliani\b|\bkelly\b|\bcapm\b|\bbeta\b|risk parity|equal risk|\berc\b|inverse[\s-]*vol|\bdiversif|equally[\s-]*weighted|\bvar\b|value at risk|\bcvar\b|expected shortfall|\bdrawdowns?\b|peak[\s-]*to[\s-]*trough|\blgd\b|\bead\b|expected loss|credit loss|\bstress|\bscenario\b|\bshock|\bexpectancy\b|\bwin rate\b|\bpayoff\b|profit factor|position siz|how many (?:shares|contracts|units|lots)|\bslippage\b|transaction costs?|trading costs?|\bcommissions?\b|round[\s-]*trip|cost drag|\bannuali|\bcagr\b|\bcumulative\b|\bgeometric\b|\bcompound(?:ed)? returns?\b|\belasticit|\bequilibrium\b|\bdemand\b|\bsupply\b|\bsurplus\b|\bdeadweight\b|\bincidence\b|price (?:ceiling|floor)|\bsubsidy\b|\butility\b|\bcobb|budget constraint|\btc\s*=|total cost|marginal cost|\bmonopol|\bcournot\b|\bbertrand\b|\bstackelberg\b|\bduopoly\b|\boligopoly\b|\bdeflator\b|\bgdp\b|\bcpi\b|price index|\binflation\b|\breal (?:interest|rate|return|growth)|\bmpc\b|\bmps\b|marginal propensity|multiplier|reserve (?:ratio|requirement)|unemployment rate|participation rate|\bgini\b|\blorenz\b|comparative advantage|absolute advantage|opportunity cost|gains from trade|\bnash\b|payoff matri|dominant strateg|dominated strateg|mixed strateg|zero[\s-]*sum|best responses?|normal[\s-]*form|prisoner|\bgame\b|\bauctions?\b|\bbidders?\b|\bmargins?\b|mark-?\s?up|break[\s-]*even|target profit|margin of safety|\broas\b|\broe\b|\broa\b|\broic\b|return on (?:ad spend|equity|assets|invested capital)|\bdupont\b|\bltv\b|\bclv\b|\bcltv\b|lifetime value|\bcac\b|acquisition cost|\bchurn|\bretention\b|\bcohort\b|\bmrr\b|\barr\b|\bnrr\b|\bndr\b|\bgrr\b|\bexpansion\b|\beoq\b|economic order|optimal order|reorder point|\brop\b|safety stock|buffer stock|\bdepreciat|book value|\bmacrs\b|gross pay|net pay|take[\s-]*home|paycheck|payroll|overtime|gross[\s-]*to[\s-]*net|current ratio|quick ratio|acid[\s-]*test|debt[\s-]*(?:to[\s-]*)?equity|\bd\/e\b|gearing|interest coverage|times interest earned|\bdso\b|days sales|debtor days|collection period|inventory turn|stock turn|\bdio\b|days inventory|\bdpo\b|days payables?|creditor days|asset turnover|financial ratios|liquidity ratios|\bnps\b|net promoter|\bfunnel\b|conversion rates?|optimal price|\blerner\b|price (?:change|increase|cut|rise)|\bcost of equity\b|security market line|\bwacc\b/i;
// Reference data (elements, planets, countries, foods, constants): its own lazy chunk; strict, so null falls through.
// Narrower than reference-data's own gate so date and shape questions don't wait for this chunk.
const MAYBE_REFERENCE =
  /\b(?:densit|melting|boiling|freezing|sublim|atomic|molar|molecular|electronegativ|population|capital|gdp|gross domestic|calori|kcal|nutri|macros|how far|how big|how large|how hot|how cold|escape velocity|moons|golden|euler|mascheroni|napier|ap[eé]ry|feigenbaum|fine.structure|bohr radius|fibonacci|triangular|factorials|powers of|digits of|value of)|\b(?:protein|fat|carbs?|fib(?:er|re)|sugar|energy|distance|radius|diameter|mass|weight|gravity|temperature|orbit\w*|year|day|rotation|area|size|symbol|group|period|block|category|state|phase|properties|facts|electrons?|protons?|formula)\s+(?:of|in|on|to|for)\b|\bfirst \d+\b|\bprimes? (?:up to|below|under)\b/i;
const SIMULATE_LINE = /^\s*simulate\b(?:[^:]*:|\s+\d)/i;
const MAYBE_HISTORY =
  /\binflation\b|\bcpi\b|purchasing power|today'?s (?:dollars|money)|(?:1[89]|20)\d\d(?:'s)? dollars|\bworth (?:today|now|in \d{4})|\b(?:in|from) (?:1[89]|20)\d\d (?:in|to|worth) |\bdollars? (?:from|in) (?:1[89]|20)\d\d\b|\bcurrent dollars\b/i;
/** A currency word plus something date-like: maybe "100 usd to eur on 2015-03-01" / "eur to gbp last christmas". */
const MAYBE_DATED =
  /\d{4}|\d{1,2}[/.]\d{1,2}[/.]\d{2}|\b(?:yesterday|last|ago|christmas|xmas|new year|easter|halloween|thanksgiving|valentine|jan\w*|feb\w*|mar(?:ch)?|apr\w*|may|june?|july?|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\b/i;
const MAYBE_CURRENCY_WORD = /[$€£¥₹]|\b(?:usd|eur|gbp|jpy|chf|cad|aud|cny|inr|mxn|brl|sek|nok|dkk|pln|czk|huf|nzd|sgd|hkd|krw|zar|try|ils|thb|php|idr|myr|ron|isk|dollars?|euros?|pounds?|yen|yuan|rupees?|pesos?|francs?)\b/i;
const MAYBE_EVERYDAY =
  /[$€£¥₹]|\b(?:days?|weeks?|months?|years?|hours?|minutes?|today|tomorrow|yesterday|until|till|since|ago|leap|unix|epoch|timestamp|time|am|pm|noon|midnight|born|old|date|week|christmas|xmas|halloween|thanksgiving|easter|new year|valentine|holidays?|mon|tue|wed|thu|fri|sat|sun|\w+day|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*|loan|mortgage|borrow|payment|amortiz\w*|interest|compound\w*|invest\w*|savings?|deposit|apy|apr|npv|irr|roi|cagr|growth|present value|future value|tip|gratuity|split|share|divvy|tax|vat|gst|margin|markup|mark.?up|profit|break.?even|compare|cheaper|cheapest|deal|value|price|cost|vs|versus|return|usd|eur|gbp|jpy|inr|cad|aud|dollars?|euros?|pounds?|yen|rupees?|yuan|pesos?|francs?|won|bucks|quid|\w{3}\s+(?:to|in)\s+\w{3})\b|\d(?:am|pm)\b|\b\d{1,2}:\d\d\b/i;

/** A failed load (offline, interrupted) is forgotten so the next use retries instead of failing forever. */
function lazy<T>(load: () => Promise<T>, onLoad: (m: T) => void): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () =>
    (p ??= load().then(
      (m) => {
        onLoad(m);
        return m;
      },
      (e: unknown) => {
        p = null;
        throw e;
      },
    ));
}

export class Runtime {
  private units: UnitEngine | null = null;
  private everyday: Everyday | null = null;
  private advanced: Advanced | null = null;
  private history: History | null = null;
  private simulate: Simulate | null = null;
  private statsPlus: StatsPlus | null = null;
  private applied: Applied | null = null;
  private discrete: Discrete | null = null;
  private quant: Quant | null = null;
  private shapes: Shapes | null = null;
  private reference: Reference | null = null;
  readonly loadUnits = lazy(() => import('@lemma/unit-engine'), (m) => (this.units = m));
  readonly loadEveryday = lazy(() => import('./engines/everyday'), (m) => (this.everyday = m));
  readonly loadAdvanced = lazy(() => import('./engines/advanced'), (m) => (this.advanced = m));
  readonly loadHistory = lazy(() => import('./engines/history'), (m) => (this.history = m));
  readonly loadSimulate = lazy(() => import('./engines/simulate'), (m) => (this.simulate = m));
  readonly loadStatsPlus = lazy(() => import('./engines/statsplus'), (m) => (this.statsPlus = m));
  readonly loadApplied = lazy(() => import('./engines/applied'), (m) => (this.applied = m));
  readonly loadDiscrete = lazy(() => import('./engines/discrete'), (m) => (this.discrete = m));
  readonly loadQuant = lazy(() => import('./engines/quant'), (m) => (this.quant = m));
  readonly loadShapes = lazy(() => import('./engines/shapes'), (m) => (this.shapes = m));
  readonly loadReference = lazy(() => import('@lemma/reference-data'), (m) => (this.reference = m));
  hooks: IntentHook[];

  constructor(private opts: RuntimeOptions = {}) {
    this.hooks = opts.hooks ?? [];
  }

  /** Loads every engine now (the web app does this on idle; the CLI does it at start). */
  async loadAll(): Promise<void> {
    await Promise.all([this.loadUnits(), this.loadEveryday(), this.loadAdvanced(), this.loadHistory()]);
  }

  get advancedEngines(): Advanced | null {
    return this.advanced;
  }

  unitLabel(...a: Parameters<UnitEngine['unitLabel']>): string {
    return this.units!.unitLabel(...a);
  }

  route(input: string, session: Session, opts: RouteOptions = {}): Outcome {
    if (!input.trim()) return { kind: 'empty' };
    // LaTeX ("\frac{1}{2}", "x^{2}", "\int_0^1 x^2 dx") is read as plain math.
    if (/\\[a-z]|[\^_]\{/i.test(input)) input = delatex(input);
    input = tidyWording(input);

    // The user's own formulas come first: after "f(x) = x^2 + 1", "f(2)" is that formula, not a sequence shortcut.
    if (session.fns.size && [...input.matchAll(/([A-Za-z_]\w*)\s*\(/g)].some((m) => session.fns.has(m[1]!))) {
      const r = calculate(input, session, opts);
      if (r.ok) return { kind: 'calc', result: r };
    }

    if (MAYBE_PRODUCTIVITY.test(input)) {
      if (!this.everyday) return { kind: 'pending', waitFor: this.loadEveryday() };
      const e = this.everyday;
      const r = e.answerProductivity(input, e.systemContext());
      if (r) return r.ok ? { kind: 'answer', result: r as unknown as Answer } : { kind: 'error', error: r.error };
    }

    for (const h of this.hooks) {
      const o = h.route(input, session);
      if (o) return o;
    }

    // "simulate 10000: …" (Monte Carlo). A bare "simulate a projectile…" is left to the hooks above.
    if (SIMULATE_LINE.test(input)) {
      if (!this.simulate) return { kind: 'pending', waitFor: this.loadSimulate() };
      const r = this.simulate.answerSimulation(input.trim());
      return r.ok ? { kind: 'answer', result: r } : { kind: 'error', error: r.error };
    }

    if (MAYBE_REFERENCE.test(input)) {
      if (!this.reference) return { kind: 'pending', waitFor: this.loadReference() };
      const r = pick(this.reference.answerReference(input));
      if (r) return r;
    }

    // Advanced statistics / probability / econometrics / ML math (its own lazy chunk); null falls through. Its handlers are strict, so it
    // runs before the broader quant/applied pre-checks.
    if (GATE_STATS_PLUS(input)) {
      if (!this.statsPlus) return { kind: 'pending', waitFor: this.loadStatsPlus() };
      const r = pick(this.statsPlus.answerStatsPlus(input));
      if (r) return r;
    }

    if (MAYBE_QUANT.test(input)) {
      if (!this.quant) return { kind: 'pending', waitFor: this.loadQuant() };
      const r = pick(this.quant.answerQuant(input, { currency: opts.currency }));
      if (r) return r;
    }

    const dated = MAYBE_HISTORY.test(input) || (MAYBE_CURRENCY_WORD.test(input) && MAYBE_DATED.test(input));
    if (dated) {
      if (!this.history) return { kind: 'pending', waitFor: this.loadHistory() };
      const o = this.routeHistory(this.history, input, session, opts);
      if (o) return o;
    }

    // Shapes and geometry (own lazy chunk): any 2D/3D figure, triangles, coordinate geometry; null falls through.
    if (MAYBE_SHAPE.test(input) && !/^\s*(?:graph|plot|sketch|draw)\b/i.test(input) && !ALGEBRA_FIRST.test(input)) {
      if (!this.shapes) return { kind: 'pending', waitFor: this.loadShapes() };
      const r = pick(this.shapes.answerShape(input));
      // A "didn't understand" from a specialised engine shouldn't hide the algebra engines ("expand (x+1)^5").
      if (r && !(r.kind === 'error' && fallsToAlgebra(input))) return r;
    }

    // Applied sciences: physics, chemistry, engineering, computing, ML arithmetic, medicine (own lazy chunk); null falls through.
    if (MAYBE_APPLIED.test(input) && !ALGEBRA_FIRST.test(input)) {
      if (!this.applied) return { kind: 'pending', waitFor: this.loadApplied() };
      const r = pick(this.applied.answerApplied(input));
      if (r && !(r.kind === 'error' && fallsToAlgebra(input))) return r;
    }

    // Optimization, graphs, numerical methods, information and coding theory, cryptography, signals, quantum, models
    // (own lazy chunk). Its handlers only accept their own phrasings; null falls through.
    if (MAYBE_DISCRETE.test(input) && !ALGEBRA_FIRST.test(input)) {
      if (!this.discrete) return { kind: 'pending', waitFor: this.loadDiscrete() };
      const r = pick(this.discrete.answerDiscrete(input));
      if (r && !(r.kind === 'error' && fallsToAlgebra(input))) return r;
    }

    if (!this.advanced && (MAYBE_ADVANCED.test(input) || MAYBE_ARITH.test(input))) return { kind: 'pending', waitFor: this.loadAdvanced() };
    if (this.advanced) {
      const a = this.advanced;
      if (a.isGraphRequest(input)) {
        try {
          return { kind: 'graph', spec: a.parseGraph(input, session), input };
        } catch (e) {
          if (e instanceof MathError) return { kind: 'error', error: e };
          throw e;
        }
      }
      if (a.LOOKS_LIKE_NUMBER_EXTRAS.test(input)) {
        const r = pick(a.answerNumberExtras(input));
        if (r) return r;
      }
      if (a.LOOKS_LIKE_NUMBER_THEORY.test(input)) {
        const r = pick(a.answerNumberTheory(input));
        if (r) return r;
      }
      if (a.LOOKS_LIKE_ARITH.test(input)) {
        const r = pick(a.answerArithmetic(input, session));
        if (r) return r;
      }
      if (a.LOOKS_LIKE_SYMBOLIC.test(input)) {
        let req: SymRequest | null = null;
        try {
          req = a.parseSymbolic(input, session);
        } catch (e) {
          if (!(e instanceof MathError)) throw e;
        }
        if (req) return this.symbolicOutcome(input, req, opts);
      }
      if (a.LOOKS_LIKE_STATS.test(input)) {
        const r = pick(a.answerStats(input));
        if (r) return r;
      }
      if (a.LOOKS_LIKE_SCIENCE.test(input)) {
        const r = pick(a.answerScience(input));
        if (r) return r;
      }
    }

    if (MAYBE_EVERYDAY.test(input)) {
      if (!this.everyday) return { kind: 'pending', waitFor: this.loadEveryday() };
      const e = this.everyday;
      if (e.LOOKS_LIKE_DATE.test(input)) {
        const r = pick(e.answerDate(input, e.systemContext()));
        if (r) return r;
      }
      if (e.LOOKS_LIKE_FINANCE.test(input)) {
        const r = pick(e.answerFinance(input, { currency: opts.currency ?? '$', ans: session.ans }));
        if (r) return r;
      }
      if (e.LOOKS_LIKE_CURRENCY.test(input)) {
        const c = e.answerCurrency(input, opts.rates?.() ?? null, session);
        if (c && 'pending' in c) {
          if (opts.liveRates === false || !opts.requestRates) {
            return { kind: 'error', error: new MathError('domain', opts.liveRates === false ? 'Live exchange rates are turned off' : 'Exchange rates are not available here') };
          }
          return { kind: 'pending', waitFor: opts.requestRates() };
        }
        if (c) return c.ok ? { kind: 'answer', result: c } : { kind: 'error', error: c.error };
      }
    }

    if (LOOKS_LIKE_CONVERSION.test(input) && !/^\s*(?:define|store|save|put|let|set)\b/i.test(input)) {
      if (!this.units) return { kind: 'pending', waitFor: this.loadUnits() };
      const c = this.units.convert(input, session, opts);
      if (c) return c.ok ? { kind: 'convert', result: c } : { kind: 'error', error: c.error };
    }

    const r = calculate(input, session, opts);
    if (r.ok) return { kind: 'calc', result: r };
    // Square roots of negatives and "3 + 2i" are complex arithmetic: hand those to the CAS.
    const complexish = /\bi\b|\di\b|\b(?:arg|conj|re|im)\s*\(/.test(input) || (r.error.code === 'domain' && /negative|No real result|only defined for positive/.test(r.error.message));
    // Complex arithmetic needs the algebra chunk: wait for it (just after start-up) rather than say "no real result".
    if (!this.advanced && complexish && r.error.code !== 'incomplete') return { kind: 'pending', waitFor: this.loadAdvanced() };
    if (this.advanced && complexish && r.error.code !== 'incomplete') {
      const req = this.advanced.complexRequest(input, session);
      if (req) return this.symbolicOutcome(input, req, opts);
    }
    // "3,5 + 1,25" (comma decimals) when the calculator couldn't read the comma.
    if (this.advanced && /\d,\d/.test(input)) {
      const c = pick(this.advanced.commaDecimal(input, session));
      if (c) return c;
    }
    if (r.error.code === 'unknown-name') {
      // "x", "2x": a letter with no value. Nothing to work out, so say what would help instead of "Unknown name".
      const lone = LONE_UNKNOWN.exec(input);
      if (lone && !session.vars.has(lone[2]!)) return { kind: 'answer', result: valueHint(input, lone[1]!, lone[2]!) };
      // "x^2 + 2x + 1", "3x - 2x", "a + b": answered by the algebra chunk; wait for it rather than report an unknown name.
      if (!this.advanced && bareAlgebra(input)) return { kind: 'pending', waitFor: this.loadAdvanced() };
    }
    // "2x + 3x", "(x^3 - 1)/(x - 1)": an expression in single-letter unknowns is simplified (or divided) symbolically.
    if (this.advanced && /Unknown name/.test(r.error.message)) {
      const req = this.advanced.expressionRequest(input, session);
      if (req) return this.symbolicOutcome(input, req, opts);
    }
    return { kind: 'error', error: r.error };
  }

  /** Routes and waits out lazy loads, rate fetches and symbolic work. For APIs, CLIs and tests. */
  async compute(input: string, session: Session = createSession(), opts: RouteOptions = {}, maxWaits = 8): Promise<Outcome> {
    let o = this.route(input, session, opts);
    for (let i = 0; o.kind === 'pending' && i < maxWaits; i++) {
      try {
        await o.waitFor;
      } catch (e) {
        return { kind: 'error', error: e instanceof MathError ? e : new MathError('domain', e instanceof Error ? e.message : String(e)) };
      }
      o = this.route(input, session, opts);
    }
    return o;
  }

  /** Inflation questions and dated currency conversions. */
  private routeHistory(h: History, input: string, session: Session, opts: RouteOptions): Outcome | null {
    if (h.LOOKS_LIKE_INFLATION.test(input)) {
      const r = pick(h.answerInflation(input));
      if (r) return r;
    }
    const fx = h.fxHistory.answer(input, h.resolveDate, session);
    if (fx && 'pending' in fx) {
      if (opts.liveRates === false) return { kind: 'error', error: new MathError('domain', 'Live exchange rates are turned off, so historical rates can’t be fetched') };
      if (!opts.requestRates) return { kind: 'error', error: new MathError('domain', 'Exchange rates are not available here') };
      return { kind: 'pending', waitFor: h.fxHistory.request(fx.pending) };
    }
    return pick(fx);
  }

  private symbolicOutcome(input: string, req: SymRequest, opts: RouteOptions = {}): Outcome {
    const backend = this.opts.symbolic;
    if (!backend) return { kind: 'error', error: new MathError('domain', 'Symbolic algebra is not available in this environment') };
    const hit = backend.cached(req);
    if (hit) {
      const a = this.advanced!.toAnswer(input, req, hit);
      return a.ok ? { kind: 'answer', result: a } : { kind: 'error', error: a.error };
    }
    return { kind: 'pending', waitFor: backend.run(req, { preview: opts.preview }) };
  }
}

/** Phrases the algebra chunk owns (vectors, conics, tangents, perfect powers…), kept away from the shape/applied engines. */
const ALGEBRA_FIRST =
  /\b(?:dot product|scalar product|inner product|cross product|vector product|angle between (?:the )?vectors?|angle between [(<⟨[]|unit vector|projection of|magnitude of|length of (?:the )?vector|normali[sz]e|perfect (?:square|cube)|identify|classify|conic|foci|focus of|vertex of|directrix|eccentricity|centre and radius|center and radius|tangent (?:line )?to|normal (?:line )?to|tangent plane|gram|linearly|span of|expand|factori[sz]e|binomial|induction|polar form|rectangular form|exponential form)\b|^\s*[([<⟨]\s*-?[\d.]+\s*,[^=]*[)\]>⟩]\s*(?:[+\-·×]|x\s)|^\s*\|\s*[(<⟨]/i;

/** Input the symbolic/arithmetic engines may answer: specialised engines' errors fall through to them. */
function fallsToAlgebra(input: string): boolean {
  return /\b(?:expand|factori[sz]e|simplify|solve|binomial expansion|proof|induction|subject|rearrange|integrate|derivative|limit)\b|[=<>]/i.test(input) || MAYBE_ARITH.test(input);
}

/** A lone letter, maybe with a number in front: "x", "2x", "-3.5 * y" (not "5 m", which reads as units). */
const LONE_UNKNOWN = /^\s*([+-]?\s*(?:\d+(?:\.\d+)?(?:\s*\*\s*)?)?)([a-zA-Z])\s*$/;

/** Shown for a lone unknown letter: kind 'hint', so hosts can show it softly and keep it out of history. */
function valueHint(input: string, coeff: string, v: string): Answer {
  const shown = `${coeff.replace(/[\s*]/g, '').replace(/^-/, '−').replace(/^\+/, '')}${v}`;
  return {
    ok: true,
    kind: 'hint',
    input,
    expression: `Expression · ${input.trim()}`,
    primary: { display: shown, plain: shown.replace(/−/g, '-'), spoken: shown.replace(/−/g, 'minus ') },
    notes: [`${v} has no value yet. Add “= …” to solve, or give ${v} a value (${v} = 3)`],
  };
}

/** Numbers, operators and single letters only: an algebraic expression the symbolic engine can simplify. */
function bareAlgebra(input: string): boolean {
  const t = input.trim();
  if (!/^[\s\d.+\-*/^()²³a-zA-Z]+$/.test(t) || !/[a-z]/i.test(t)) return false;
  // "xy", "2abc": 2–3 distinct letters run together (the algebra chunk decides; units and words are excluded there).
  return (t.match(/[a-z]+/gi) ?? []).every((w) => w.length === 1 || /^(?:sqrt|cbrt|abs|exp|ln|log|sin|cos|tan)$/i.test(w) || (/^[a-z]{2,3}$/.test(w) && new Set(w).size === w.length));
}

function pick(r: AnswerResult | null): Outcome | null {
  return r ? (r.ok ? { kind: 'answer', result: r } : { kind: 'error', error: r.error }) : null;
}

/** A small cache-in-front-of-a-runner backend; both the web worker client and the Node backend use it. */
export function cachingBackend(run: (req: SymRequest) => Promise<SymResult>, max = 200): SymbolicBackend {
  const cache = new Map<string, SymResult>();
  const inflight = new Map<string, Promise<SymResult>>();
  return {
    cached: (req) => cache.get(JSON.stringify(req)),
    run(req) {
      const key = JSON.stringify(req);
      const hit = cache.get(key);
      if (hit) return Promise.resolve(hit);
      let p = inflight.get(key);
      if (!p) {
        p = run(req).then((r) => {
          inflight.delete(key);
          if (cache.size >= max) cache.delete(cache.keys().next().value!);
          cache.set(key, r);
          return r;
        });
        inflight.set(key, p);
      }
      return p;
    },
  };
}

/** Common misspellings of the words that start a request; only whole words, and only these unambiguous ones. */
const TYPOS: [RegExp, string][] = [
  [/\b(?:solv|slove|sovle)\b(?=\s+[\w(])/gi, 'solve'],
  [/\b(?:derivitive|derivative|derivitave|dirivative|derivate|derivaitve|derivatve)\b/gi, 'derivative'],
  [/\b(?:intergrate|intigrate|integrat|intagrate|integerate)\b/gi, 'integrate'],
  [/\b(?:intergral|integeral|intigral|intagral)\b/gi, 'integral'],
  [/\b(?:simplfy|simpify|simlify|simplifiy)\b/gi, 'simplify'],
  [/\b(?:expnad|exapnd|expland)\b/gi, 'expand'],
  [/\b(?:facter|factorize|factorise)\b(?=\s)/gi, 'factor'],
  [/\b(?:sqroot|sqareroot|squareroot|sqaure root|sqare root)\b/gi, 'square root of'],
];

/**
 * Wording the engines don't read, put the way they do: typos in the command word, and definite integrals with
 * their limits first ("integral from 0 to 1 of x^2", "∫_0^1 x^2 dx") → "integrate x^2 from 0 to 1".
 */
export function tidyWording(input: string): string {
  let s = input;
  for (const [re, to] of TYPOS) s = s.replace(re, to);
  s = s.replace(/square root of\s+of\b/gi, 'square root of');
  // "hypotenuse of 3 and 4": the two legs, by Pythagoras.
  const hyp = /^\s*(?:what(?:'s| is)\s+)?(?:the\s+)?hypotenuse\s+(?:of|for|with legs|given legs|when the legs are)\s+(\d+(?:\.\d+)?)\s*(?:and|,|&)\s*(\d+(?:\.\d+)?)\s*\??$/i.exec(s);
  if (hyp) return `sqrt(${hyp[1]}^2 + ${hyp[2]}^2)`;
  const lead = /^\s*(?:the\s+)?(?:definite\s+)?(?:integral|integrate)\s+from\s+(\S+)\s+to\s+(\S+?)\s+(?:of\s+)?(.+?)\s*(?:d([a-z]))?\s*$/i.exec(s);
  if (lead) return `integrate ${lead[3]}${lead[4] ? ` d${lead[4]}` : ''} from ${lead[1]} to ${lead[2]}`;
  const sym = /^\s*∫\s*_?\s*\{?([^\s^}]+)\}?\s*\^\s*\{?([^\s}]+)\}?\s+(.+?)\s*d([a-z])\s*$/.exec(s);
  if (sym) return `integrate ${sym[3]} d${sym[4]} from ${sym[1]} to ${sym[2]}`;
  const plain = /^\s*∫\s*(.+?)\s*(?:d([a-z]))?\s*$/.exec(s);
  if (plain) return `integrate ${plain[1]}${plain[2] ? ` d${plain[2]}` : ''}`;
  return s;
}
