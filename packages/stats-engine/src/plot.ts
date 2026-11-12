/**
 * Chart data attached to answers (Answer.plot). Plain JSON, no closures, so answers stay serialisable; the graph
 * engine turns these into drawable items (graph-engine's statPlotSpec).
 */

export type ModelKind = 'linear' | 'quadratic' | 'cubic' | 'exponential' | 'power' | 'logarithmic';

/**
 * A fitted model in the form it was solved in: y = out(Σ c[k]·u^k) with u = (in(x) − m) / s, where `in` is x or
 * ln x and `out` is the identity or exp. Centring and scaling keep the fit and its evaluation well conditioned
 * (years as x, cubics), which the expanded coefficients shown to people are not.
 */
export interface Model {
  kind: ModelKind;
  c: number[];
  m: number;
  s: number;
}

const LOG_IN = new Set<ModelKind>(['power', 'logarithmic']);
const EXP_OUT = new Set<ModelKind>(['exponential', 'power']);

export function evalModel(model: Model, x: number): number {
  const t = LOG_IN.has(model.kind) ? (x > 0 ? Math.log(x) : NaN) : x;
  const u = (t - model.m) / model.s;
  let p = 0;
  for (let k = model.c.length - 1; k >= 0; k--) p = p * u + model.c[k]!;
  return EXP_OUT.has(model.kind) ? Math.exp(p) : p;
}

// A type alias, not an interface, so a StatPlot is assignable to Answer['plot'] (which has an index signature).
type PlotBase = {
  /** One or two sentences describing the chart, for screen readers. */
  summary: string;
  xLabel?: string;
  yLabel?: string;
};

export type StatPlot =
  | (PlotBase & { type: 'regression'; points: number[]; model: Model; label: string })
  | (PlotBase & { type: 'scatter'; points: number[] })
  | (PlotBase & { type: 'histogram'; edges: number[]; counts: number[] })
  | (PlotBase & { type: 'box'; min: number; q1: number; median: number; q3: number; max: number; lo: number; hi: number; outliers: number[] })
  | (PlotBase & { type: 'dot'; values: number[]; counts: number[] })
  /** lo / hi null = unbounded; both null = no shading. */
  | (PlotBase & { type: 'normal'; mean: number; sd: number; lo: number | null; hi: number | null; area: number | null; label: string });
