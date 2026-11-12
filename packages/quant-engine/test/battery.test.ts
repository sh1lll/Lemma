import { describe, expect, it } from 'vitest';
import { answerQuant, bsm, bondPrice, binomial } from '../src';

/**
 * Quant battery. Curated cases (exact displays) were checked against textbook values, e.g.
 * Hull, Options Futures & Other Derivatives: BS c=4.76 / p=0.81 (S=42, K=40, r=10 pct, vol 20 pct, T=0.5; Ex. 15.6);
 * American put 4.49 (5-step tree, Ex. 21.1); u=1.2/d=0.8 American put 5.09 (Ch. 13); forward 51.14 with
 * dividends (Ex. 5.3); continuous forwards 5.0/5.8/6.2/6.5 (Table 4.5); bond 5 pct/10y/semiannual at 6 pct = 925.61;
 * annuity PV 7,721.73 (standard TVM tables); EAR of 12 pct monthly = 12.6825 pct; PD×LGD×EAD; EOQ √(2DS/H) = 774.60;
 * Mankiw/Varian equilibrium, surplus, tax incidence and Cobb–Douglas demands; Cournot q=(a−c)/3b;
 * prisoner's dilemma / battle of the sexes equilibria; Myerson's 5/12 revenue with reserve 0.5.
 * Grids below compare against independent closed forms computed in this file.
 */
const CURATED: [string, string][] = [
  ["10 equally weighted assets vol 30% correlation 0.3 diversification", "18.25%"],
  ["10% effective to continuous", "9.5310%"],
  ["12% compounded monthly to effective", "12.6825%"],
  ["40% margin to markup", "66.67%"],
  ["95% expected shortfall portfolio 1000000 vol 2%", "$41,254.26"],
  ["99% 10-day VaR on 1,000,000 with daily vol 1.5%", "$110,348.37"],
  ["Black-Scholes call S=100 K=105 T=0.5 r=5% vol=20%", "$4.5817"],
  ["CAC marketing spend 50000 new customers 250", "$200.00"],
  ["CAGR vs average return of 50%, -50%", "−13.40%"],
  ["CAPM beta 1.2 risk-free 3% market return 8%", "9.00%"],
  ["EOQ annual demand 1000 ordering cost 10 holding cost 20% of unit cost 5", "141.42 units"],
  ["EOQ demand 12000 order cost 50 holding 2", "774.6 units"],
  ["FV of annuity 1000 per year for 10 years at 5%", "$12,577.89"],
  ["GDP consumption 500 investment 200 government 150 exports 100 imports 80", "870"],
  ["GDP deflator nominal GDP 1200 real GDP 1000", "120.00"],
  ["LTV ARPU 50 gross margin 80% monthly churn 5%", "$800.00"],
  ["LTV arpu 100 churn 4% gross margin 75% cac 600", "$1,875.00"],
  ["MIRR of -1000, 300, 400, 500, 200 finance rate 10% reinvest 12%", "13.90%"],
  ["MRR from 10000 to 15000 over 6 months", "6.99% per month"],
  ["NPS promoters 60 passives 25 detractors 15", "45"],
  ["PV of annuity 1000 per year for 10 years at 5%", "$7,721.73"],
  ["PV of annuity due 1000 per year for 10 years at 5%", "$8,107.82"],
  ["PV of growing annuity 1000 per year growing 3% for 10 years at 8%", "$7,550.13"],
  ["ROA net income 50000 total assets 1000000", "5.00%"],
  ["ROAS revenue 5000 ad spend 1000", "5.00×"],
  ["ROE net income 50000 equity 400000", "12.50%"],
  ["TC = 100 + 10Q + Q^2 price 50", "Q = 20"],
  ["U = min(x, 2y) income 100 px 2 py 4 maximize utility", "x = 25, y = 12.5"],
  ["accrued interest 6% coupon face 1000 semiannual 60 days since last coupon", "$10.00"],
  ["annualize 2% monthly return", "26.82%"],
  ["annualize daily vol 1%", "15.87%"],
  ["annualize monthly volatility 4%", "13.86%"],
  ["annuity payment for PV 10000 at 6% for 5 years", "$2,373.96"],
  ["bertrand P = 120 - Q mc 30", "P = 30"],
  ["beta of stock returns 2, 3, -1, 4, 1 vs market 1, 2, -2, 3, 1", "1.0000"],
  ["binomial american put S=50 K=50 T=5 months r=10% vol 40% 5 steps", "$4.4885"],
  ["binomial tree american put S=50 K=52 T=2 r=5% u=1.2 d=0.8 2 steps", "$5.0896"],
  ["black 76 call F=100 K=100 T=1 r=5% vol=20%", "$7.5771"],
  ["black scholes put S=42 K=40 T=0.5 r=10% sigma=20%", "$0.8086"],
  ["black-scholes S=42 K=40 T=0.5 r=10% vol 20%", "$4.7594"],
  ["bond price face 1000 coupon 5% ytm 6% 10 years semiannual", "$925.61"],
  ["break even fixed costs 10000 price 50 variable cost 30 target profit 5000", "750 units"],
  ["break even revenue fixed costs 10000 price 50 variable cost 30", "$25,000.00"],
  ["break-even revenue fixed costs 50000 contribution margin ratio 40%", "$125,000.00"],
  ["call delta S=42 K=40 T=0.5 r=10% vol 20% black scholes", "0.7791"],
  ["calmar ratio return 15% max drawdown 25%", "0.6000"],
  ["churn started with 1000 customers lost 50", "5.00%"],
  ["cohort retention 1000, 800, 650, 560", "56.0%"],
  ["comparative advantage A: 10 wine or 5 cloth, B: 6 wine or 4 cloth", "A: wine; B: cloth"],
  ["compound returns 10%, -5%, 20%", "25.40%"],
  ["continuous forward rates spot 3% 4% 4.6% 5% 5.3%", "6.5000%"],
  ["convert 25% markup to margin", "20.00%"],
  ["cost function TC = 100 + 10Q + Q^2", "Minimum AC at Q = 10"],
  ["cournot P = 120 - Q mc 30", "q₁ = 30, q₂ = 30, P = 60"],
  ["cournot demand P = 100 - 2Q costs 10 and 20", "q₁ = 16.6667, q₂ = 11.6667, P = 43.3333"],
  ["cross price elasticity price of B from 4 to 5 quantity of A from 100 to 110", "0.4286"],
  ["current ratio current assets 500000 current liabilities 250000", "2.00"],
  ["debt to equity debt 300000 equity 600000", "0.50"],
  ["demand P = 50 - 0.5Q supply P = 10 + Q equilibrium", "P = 36.6667, Q = 26.6667"],
  ["demand Q = 100 - 2P supply Q = 20 + 3P price ceiling 12", "Shortage of 20"],
  ["demand Qd = 100 - 2P, supply Qs = 20 + 3P with a tax of 5 per unit", "Buyers pay 19, sellers get 14"],
  ["digital call S=100 K=100 T=1 r=5% vol 20% pays 10", "$5.3232"],
  ["discounted payback of -1000, 300, 400, 500, 200 at 8%", "2.96 years"],
  ["double declining balance depreciation cost 10000 salvage 1000 over 5 years", "$4,000.00"],
  ["down-and-out call S=100 K=100 barrier 90 T=1 r=5% vol 20% seed 3", "$8.7943"],
  ["dso receivables 50000 revenue 365000", "50.0 days"],
  ["dupont roe net income 100 revenue 1000 assets 2000 equity 800", "12.50%"],
  ["efficient frontier returns 10% 8% 6% vols 20% 15% 10% correlation 0.3", "min σ 9.27% at 6.66%"],
  ["efficient frontier returns 8% 4% vols 15% 5% correlation 0.2 rf 2%", "min σ 4.95% at 4.18%"],
  ["equilibrium demand Q = 100 - 2P supply Q = 20 + 3P", "P = 16, Q = 68"],
  ["expectancy win rate 40% average win 300 average loss 100", "$60.00 per trade"],
  ["expected loss PD 2% LGD 45% EAD 1,000,000", "$9,000.00"],
  ["expected return with beta 0.8 rf 2% market risk premium 6%", "6.80%"],
  ["expected revenue second price auction 3 bidders uniform 0 100", "50"],
  ["first price auction 2 bidders values uniform on [0, 1] reserve 0.5", "0.4167"],
  ["forward price S=40 r=5% T=0.25", "$40.5031"],
  ["forward price spot 50 r=8% 10 months dividends of 0.75 in 3, 6 and 9 months", "$51.1358"],
  ["forward rate between year 2 and 3 with spot rates 3%, 3.5%, 4%", "5.0073%"],
  ["forward rate from 1-year spot 4% and 2-year spot 5%", "6.0096%"],
  ["funnel 10000 visitors 2000 signups 500 trials 100 paid", "1.00%"],
  ["gini from quintile shares 5, 10, 15, 25, 45", "0.3800"],
  ["gini of 10, 20, 30, 40", "0.2500"],
  ["government spending increase of 100 mpc 0.75 multiplier", "400"],
  ["gross margin revenue 500000 cogs 300000", "40.00%"],
  ["gross pay 45 hours at $20 an hour", "$900.00"],
  ["growing perpetuity 100 per year growing 2% at 7%", "$2,000.00"],
  ["historical VaR 95% of returns -2%, 1%, 0.5%, -3%, 2%, -1%, 0%, 1.5%, -0.5%, 2.5%, -4%, 1%, 0.2%, -1.2%, 0.8%, 1.1%, -2.5%, 0.3%, 0.9%, -0.7%", "4.00%"],
  ["how long to double at 7% growth", "10.24 years"],
  ["implied vol of a put priced 0.81 S=42 K=40 T=0.5 r=10%", "20.02%"],
  ["implied volatility call price 4.76 S=42 K=40 T=0.5 r=10%", "20.01%"],
  ["income elasticity income from 40000 to 50000 quantity from 20 to 22", "0.4286"],
  ["inflation cpi from 250 to 260", "4.00%"],
  ["information ratio return 9% benchmark 7% tracking error 4%", "0.5000"],
  ["interest coverage ebit 120000 interest 30000", "4.00×"],
  ["inventory turnover cogs 600000 average inventory 100000", "6.00×"],
  ["jensen's alpha return 12% rf 3% beta 1.2 market return 9%", "1.80%"],
  ["kelly mu 8% rf 2% vol 20%", "1.5000× (150.0%)"],
  ["kelly p=0.55 b=2", "32.50%"],
  ["kelly win probability 60% odds 1:1", "20.00%"],
  ["macaulay duration of 3 year bond coupon 10% ytm 12% face 1000", "2.7287 years"],
  ["max drawdown of 100, 120, 90, 130, 80, 110", "−38.46%"],
  ["max drawdown of returns 10%, -20%, 5%, -10%, 30%", "−24.40%"],
  ["max sharpe portfolio returns 8% 4% vols 15% 5% correlation 0.2 rf 2%", "25.00% / 75.00%"],
  ["maximize U = x^0.5 y^0.5 income 100 px 2 py 5", "x = 25, y = 10"],
  ["minimum variance portfolio vols 15% and 5% correlation 0.2", "4.55% / 95.45%"],
  ["money multiplier reserve ratio 10% deposit 1000", "10.0000"],
  ["monopoly demand P = 100 - 2Q TC = 10Q", "Q = 22.5, P = 55"],
  ["monte carlo VaR 99% value 1000000 vol 1.5% 10000 simulations seed 7", "$34,800.64"],
  ["monte carlo asian call S=100 K=100 T=1 r=5% vol 20% seed 1", "$6.1579"],
  ["nash equilibrium [[2,1],[0,0];[0,0],[1,2]]", "3 equilibria: (R1, C1), (R2, C2), mixed"],
  ["nash equilibrium [[3,3],[0,5],[2,2];[5,0],[1,1],[0,0];[2,2],[0,0],[4,4]]", "3 equilibria: (R2, C2), (R3, C3), mixed"],
  ["nash equilibrium [[3,3],[0,5];[5,0],[1,1]]", "(R2, C2)"],
  ["nash equilibrium matching pennies [[1,-1],[-1,1]]", "1 equilibrium: mixed"],
  ["nash equilibrium of A=[[3,0],[5,1]] B=[[3,5],[0,1]]", "(R2, C2)"],
  ["net margin revenue 1000000 cogs 600000 opex 250000 interest 20000 tax 25%", "9.75%"],
  ["net pay 40 hours at 25 per hour tax 20% 401k 5% health 100", "$650.00"],
  ["net revenue retention starting mrr 100000 expansion 10000 churn 5000 contraction 2000", "103.0%"],
  ["nps of 10, 9, 8, 6, 10, 7, 3, 9, 10, 5", "20"],
  ["optimal price elasticity -2 marginal cost 10", "$20.00"],
  ["par swap rate with spot rates 3% 3.5% 4%", "3.9738%"],
  ["parametric VaR 95% portfolio 1,000,000 daily vol 2%", "$32,897.07"],
  ["payback period of -1000, 300, 400, 500, 200", "2.60 years"],
  ["perpetuity 100 per year at 5%", "$2,000.00"],
  ["point elasticity Q = 100 - 2P at P = 20", "−0.6667"],
  ["portfolio 60/40 with returns 8% and 4%, vols 15% and 5%, correlation 0.2", "6.40%"],
  ["portfolio weights 0.5 0.3 0.2 returns 10% 8% 6% vols 20% 15% 10% correlations 0.3 0.2 0.1 rf 2%", "8.60%"],
  ["position size account 50000 risk 1% entry 100 stop 95", "100 shares"],
  ["price elasticity price from 10 to 12 quantity from 100 to 80", "−1.2222"],
  ["price elasticity quantity falls 10% when price rises 5%", "−2.0000"],
  ["price increase 10% elasticity -1.5 revenue effect", "Revenue −6.50%"],
  ["profitability index of -1000, 300, 400, 500, 200 at 8%", "1.1646"],
  ["put call parity call 4.76 S=42 K=40 r=10% T=0.5", "$0.8092"],
  ["quick ratio current assets 500000 inventory 200000 current liabilities 250000", "1.20"],
  ["real interest rate nominal 8% inflation 3%", "4.854%"],
  ["reorder point daily demand 50 lead time 7 days safety stock 100", "450 units"],
  ["retention after 12 months at 5% monthly churn", "54.04%"],
  ["risk parity vols 10% 20% correlation 0.5", "66.67% / 33.33%"],
  ["risk parity weights vols 10% 20% 30%", "54.55% / 27.27% / 18.18%"],
  ["round trip cost 10 bps on 20 trades a year", "2.00%"],
  ["rule of 70 at 3.5%", "20 years"],
  ["safety stock service level 95% sd 20 lead time 9 days", "98.69 units"],
  ["sharpe ratio of monthly returns 1%, 2%, -1%, 3%, 0.5%, 1.5% rf 2%", "2.5355"],
  ["sharpe ratio return 12% risk free 2% vol 15%", "0.6667"],
  ["slippage expected 50.00 filled 50.10 1000 shares", "$100.00"],
  ["sortino ratio of returns 2%, -1%, 3%, -2%, 4%", "1.2000"],
  ["sortino return 12% rf 2% downside deviation 8%", "1.2500"],
  ["spending multiplier mpc 0.8", "5.0000"],
  ["stackelberg P = 120 - Q mc 30", "q₁ = 45, q₂ = 22.5, P = 52.5"],
  ["straight line depreciation cost 10000 salvage 1000 life 5 years", "$1,800.00"],
  ["stress test: equities 600k shock -30%, bonds 400k shock +5%", "−$160,000.00"],
  ["sum of years digits depreciation cost 10000 salvage 1000 life 5 year 2", "$2,400.00"],
  ["swap rate with discount factors 0.97 0.94 0.91", "3.1915%"],
  ["tax multiplier mpc 0.75", "−3.0000"],
  ["trade stats 100, -50, 200, -75, 150", "$65.00 per trade"],
  ["transaction cost 1000 shares at 50 commission 0.005 per share slippage 2 bps", "$15.00"],
  ["treynor ratio return 12% rf 2% beta 1.25", "8.00%"],
  ["trinomial european call S=100 K=100 T=1 r=5% vol 20% 200 steps", "$10.4456"],
  ["unemployment rate unemployed 10 labor force 200", "5.00%"],
  ["units of production depreciation cost 50000 salvage 5000 total units 100000 units produced 12000", "$5,400.00"],
  ["utility U = x^(1/3) y^(2/3) budget 90 px 3 py 6", "x = 10, y = 10"],
  ["ytm of bond price 950 face 1000 coupon 5% 10 years", "5.6687%"],
  ["zero coupon bond 1000 face 5 years yield 4%", "$821.93"],
];

const ok = (q: string) => {
  const r = answerQuant(q);
  if (!r) throw new Error(`not recognised: ${q}`);
  if (!r.ok) throw new Error(`${q}: ${r.error.message}`);
  return r;
};
const val = (q: string) => Number(ok(q).value!.toString());

describe('quant battery: curated', () => {
  it.each(CURATED)('%s', (q, display) => expect(ok(q).primary.display).toBe(display));
});

describe('quant battery: formula grids', () => {
  const erf = (x: number) => {
    let s = 0;
    let t = x;
    for (let n = 0; n < 300 && Math.abs(t) > 1e-18; ) {
      s += t / (2 * n + 1);
      n++;
      t *= (-x * x) / n;
    }
    return (2 / Math.sqrt(Math.PI)) * s;
  };
  const Nr = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
  const grid: [number, number, number, number, number][] = [];
  for (const S of [80, 100, 120]) for (const K of [90, 110]) for (const T of [0.25, 1]) for (const v of [0.15, 0.3]) grid.push([S, K, T, 0.04, v]);
  it.each(grid)('BS call S=%d K=%d T=%d r=%d vol=%d', (S, K, T, r, v) => {
    const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T));
    const ref = S * Nr(d1) - K * Math.exp(-r * T) * Nr(d1 - v * Math.sqrt(T));
    expect(val(`black scholes call S=${S} K=${K} T=${T} r=${r * 100}% vol=${v * 100}%`)).toBeCloseTo(ref, 6);
    expect(ref - bsm('put', S, K, T, r, v).price).toBeCloseTo(S - K * Math.exp(-r * T), 8);
  });
  const ann: [number, number, number][] = [];
  for (const C of [100, 2500]) for (const r of [3, 6, 9]) for (const n of [5, 10, 20, 30]) ann.push([C, r, n]);
  it.each(ann)('annuity PV C=%d r=%d n=%d', (C, r, n) => {
    expect(val(`PV of annuity ${C} per year for ${n} years at ${r}%`)).toBeCloseTo((C * (1 - (1 + r / 100) ** -n)) / (r / 100), 6);
  });
  const bonds: [number, number, number][] = [];
  for (const c of [3, 5, 8]) for (const y of [4, 7]) for (const n of [2, 10, 30]) bonds.push([c, y, n]);
  it.each(bonds)('bond c=%d y=%d n=%d', (c, y, n) => {
    let ref = 0;
    for (let i = 1; i <= n; i++) ref += (c * 10) / (1 + y / 100) ** i;
    ref += 1000 / (1 + y / 100) ** n;
    expect(val(`bond price face 1000 coupon ${c}% ytm ${y}% ${n} years annual`)).toBeCloseTo(ref, 6);
    expect(bondPrice(1000, c / 100, y / 100, n, 1)).toBeCloseTo(ref, 8);
  });
  const eoq: [number, number, number][] = [];
  for (const D of [1000, 12000, 50000]) for (const S of [20, 75]) for (const H of [1.5, 4]) eoq.push([D, S, H]);
  it.each(eoq)('EOQ D=%d S=%d H=%d', (D, S, H) => expect(val(`EOQ demand ${D} order cost ${S} holding ${H}`)).toBeCloseTo(Math.sqrt((2 * D * S) / H), 6));
  it.each([[0.5, 2, 8], [1, 3, 9], [1.3, 1, 7], [2, 4, 10], [0.8, 2.5, 6.5], [1.1, 0, 5], [0, 3, 9], [1.5, 2, 12]])('CAPM beta %d rf %d rm %d', (b, rf, rm) =>
    expect(val(`CAPM beta ${b} risk-free ${rf}% market return ${rm}%`)).toBeCloseTo(rf + b * (rm - rf), 8));
  it.each([[1, 40, 500000], [2, 45, 1000000], [0.5, 60, 250000], [5, 30, 80000], [10, 75, 1e6], [3, 50, 20000]])('EL PD %d LGD %d EAD %d', (pd, lgd, ead) =>
    expect(val(`expected loss PD ${pd}% LGD ${lgd}% EAD ${ead}`)).toBeCloseTo((pd / 100) * (lgd / 100) * ead, 6));
  it.each([1, 2, 3.5, 5, 7, 10])('doubling at %d', (g) => expect(val(`how long to double at ${g}% growth`)).toBeCloseTo(Math.log(2) / Math.log(1 + g / 100), 6));
  it.each([[120, 1, 30], [100, 2, 10], [60, 0.5, 12], [200, 4, 20], [90, 1, 0], [50, 1, 20]])('cournot a=%d b=%d c=%d', (a, b, c) =>
    expect(val(`cournot P = ${a} - ${b}Q mc ${c}`)).toBeCloseTo(a - (2 * (a - c)) / 3, 6));
  it('binomial converges to Black–Scholes', () => {
    const t = binomial('call', false, 100, 100, 1, 0.05, 0.2, 2000);
    expect(typeof t === 'string' ? NaN : t.price).toBeCloseTo(bsm('call', 100, 100, 1, 0.05, 0.2).price, 2);
  });
});

describe('quant: asks instead of guessing, and stays out of the way', () => {
  it.each([
    ['black scholes call S=100 K=105 T=0.5 vol=20%', /risk-free rate/],
    ['bond price coupon 5% face 1000 ytm 6%', /mature/],
    ['EOQ demand 12000 order cost 50', /holding/],
    ['expected loss PD 2% LGD 45%', /EAD/],
    ['kelly win probability 60%', /odds/],
    ['portfolio returns 8% 4% vols 15% 5% weights 0.6 0.4', /correlation/],
  ] as [string, RegExp][])('%s', (q, re) => {
    const r = answerQuant(q);
    expect(r && !r.ok && r.error.code).toBe('ambiguous-reference');
    if (r && !r.ok) expect(r.error.message).toMatch(re);
  });
  it.each(['2 + 2', 'variance of 1 2 3', 'elastic collision 2 kg 3 m/s', 'life expectancy', 'pi r squared', 'c = 3e8', 'stress 200 MPa strain 0.1%', 'utility bill split 3 ways', 'lagrange multiplier', 'IV drip rate 1000 ml over 8 hours', 'NPV at 8% of -1000, 300, 400, 500, 200', 'cagr from 1000 to 2500 over 5 years'])('ignores %s', (q) =>
    expect(answerQuant(q)).toBeNull());
});
