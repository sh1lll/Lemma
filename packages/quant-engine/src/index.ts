import { MathError, type AnswerResult } from '@lemma/math-core';
import { breakEvenPlus, depreciation, finRatios, funnel, inventory, margins, nps, payroll, pricing, returnsRatios, saas } from './business';
import { comparativeAdvantage, elasticity, firm, gini, macro, market, utility } from './econ';
import { auction, games } from './games';
import { blackScholes, digital, forwardPrice, impliedVolatility, monteCarlo, putCallParity, trees } from './options';
import { betaFromReturns, capm, diversification, kelly, optimalPortfolio, portfolioStats, ratios, riskParity } from './portfolio';
import { compounding, creditLoss, drawdown, expectancy, positionSize, stress, tradingCosts, valueAtRisk } from './risk';
import { annuity, bonds, budgeting, doubling, forwardRates, rateConversion, swapRate } from './tvm';
import { currencyOf, normalise, type Handler, type Q } from './util';

export { bsm, black76, binomial, trinomial, impliedVol, geometricAsian, mcAsian, mcBarrier, downCallClosed, upPutClosed } from './options';
export { bondPrice, bondRisk } from './tvm';
export { nash } from './games';
export { N, Ninv } from './util';

/**
 * Quantitative finance, economics, business and risk (lazy chunk). Every handler states the formula it used and
 * the inputs as understood; when something essential is missing it asks instead of guessing.
 */

// Order matters: specific intents before broad ones.
const HANDLERS: Handler[] = [
  games,
  putCallParity,
  impliedVolatility,
  monteCarlo,
  digital,
  trees,
  blackScholes,
  forwardPrice,
  forwardRates,
  swapRate,
  bonds,
  budgeting,
  annuity,
  rateConversion,
  doubling,
  optimalPortfolio,
  riskParity,
  ratios,
  kelly,
  capm,
  betaFromReturns,
  valueAtRisk,
  drawdown,
  creditLoss,
  stress,
  portfolioStats,
  diversification,
  expectancy,
  positionSize,
  tradingCosts,
  compounding,
  pricing,
  elasticity,
  market,
  utility,
  firm,
  macro,
  gini,
  comparativeAdvantage,
  auction,
  margins,
  breakEvenPlus,
  returnsRatios,
  saas,
  inventory,
  depreciation,
  payroll,
  finRatios,
  nps,
  funnel,
];

export interface QuantOptions {
  /** Symbol used when the question names no currency. */
  currency?: string;
}

/** Returns null when the input is not one of these questions. */
export function answerQuant(input: string, opts: QuantOptions = {}): AnswerResult | null {
  if (input.length > 4000) return null;
  const q: Q = { input, s: normalise(input), cur: currencyOf(input, opts.currency ?? '$') };
  for (const h of HANDLERS) {
    try {
      const r = h(q);
      if (r) return r;
    } catch (e) {
      return { ok: false, kind: 'quant', input, error: new MathError('domain', e instanceof Error ? e.message : String(e)) };
    }
  }
  return null;
}

/** Cheap pre-check (the router keeps its own copy so the main bundle never imports this chunk). */
export const LOOKS_LIKE_QUANT =
  /black\W*scholes|\bbsm\b|black[\s-]*76|\bgreeks?\b|\b(?:delta|gamma|vega|theta|rho)\b|\b(?:call|put)s?\b|\boptions?\b|implied vol|\bbinomial\b|\btrinomial\b|\bamerican\b|\basian\b|\bbarrier\b|\bknock|\bdigital\b|\bbinary\b|\bparity\b|\bforwards?\b|\bfutures?\b|\bswaps?\b|\bbonds?\b|\bytm\b|\byield|\bcoupon|\bmacaulay\b|\bduration\b|\bconvexity\b|\bdv01\b|\baccrued\b|\bmirr\b|\bpayback\b|profitability index|capital budgeting|evaluate (?:the |this )?(?:project|investment)|\bnpv\b.*\birr\b|\bannuit|\bperpetuit|\bconsols?\b|\bnominal\b|\beffective\b|\bcontinuous|\bcompounded\b|\brule of (?:69|70|72)\b|\bdoubl|\btripl|\bhalv|\bportfolio\b|\bfrontier\b|\bmin(?:imum)?[\s-]*var|\bsharpe\b|\btangency\b|\bsortino\b|\btreynor\b|\bjensen|information ratio|\bcalmar\b|\bmodigliani\b|\bkelly\b|\bcapm\b|\bbeta\b|risk parity|equal risk|\berc\b|inverse[\s-]*vol|\bdiversif|equally[\s-]*weighted|\bvar\b|value at risk|\bcvar\b|expected shortfall|\bdrawdowns?\b|peak[\s-]*to[\s-]*trough|\blgd\b|\bead\b|expected loss|credit loss|\bstress|\bscenario\b|\bshock|\bexpectancy\b|\bwin rate\b|\bpayoff\b|profit factor|position siz|how many (?:shares|contracts|units|lots)|\bslippage\b|transaction costs?|trading costs?|\bcommissions?\b|round[\s-]*trip|cost drag|\bannuali|\bcagr\b|\bcumulative\b|\bgeometric\b|\bcompound(?:ed)? returns?\b|\belasticit|\bequilibrium\b|\bdemand\b|\bsupply\b|\bsurplus\b|\bdeadweight\b|\bincidence\b|price (?:ceiling|floor)|\bsubsidy\b|\butility\b|\bcobb|budget constraint|\btc\s*=|total cost|marginal cost|\bmonopol|\bcournot\b|\bbertrand\b|\bstackelberg\b|\bduopoly\b|\boligopoly\b|\bdeflator\b|\bgdp\b|\bcpi\b|price index|\binflation\b|\breal (?:interest|rate|return|growth)|\bmpc\b|\bmps\b|marginal propensity|multiplier|reserve (?:ratio|requirement)|unemployment rate|participation rate|\bgini\b|\blorenz\b|comparative advantage|absolute advantage|opportunity cost|gains from trade|\bnash\b|payoff matri|dominant strateg|dominated strateg|mixed strateg|zero[\s-]*sum|best responses?|normal[\s-]*form|prisoner|\bgame\b|\bauctions?\b|\bbidders?\b|\bmargins?\b|mark-?\s?up|break[\s-]*even|target profit|margin of safety|\broas\b|\broe\b|\broa\b|\broic\b|return on (?:ad spend|equity|assets|invested capital)|\bdupont\b|\bltv\b|\bclv\b|\bcltv\b|lifetime value|\bcac\b|acquisition cost|\bchurn|\bretention\b|\bcohort\b|\bmrr\b|\barr\b|\bnrr\b|\bndr\b|\bgrr\b|\bexpansion\b|\beoq\b|economic order|optimal order|reorder point|\brop\b|safety stock|buffer stock|\bdepreciat|book value|\bmacrs\b|gross pay|net pay|take[\s-]*home|paycheck|payroll|overtime|gross[\s-]*to[\s-]*net|current ratio|quick ratio|acid[\s-]*test|debt[\s-]*(?:to[\s-]*)?equity|\bd\/e\b|gearing|interest coverage|times interest earned|\bdso\b|days sales|debtor days|collection period|inventory turn|stock turn|\bdio\b|days inventory|\bdpo\b|days payables?|creditor days|asset turnover|financial ratios|liquidity ratios|\bnps\b|net promoter|\bfunnel\b|conversion rates?|optimal price|\blerner\b|price (?:change|increase|cut|rise)|\bcost of equity\b|security market line|\bwacc\b/i;
