import type { FloatEnv } from '@lemma/math-core';
// Deep import: only the model evaluator, not the whole statistics engine, ends up in the graph chunk.
import { evalModel, type StatPlot } from '@lemma/stats-engine/src/plot';
import type { GraphItem, GraphSpec } from './spec';

/** Padded [lo, hi] for a view, never zero-width. */
function span(lo: number, hi: number, pad = 0.12): [number, number] {
  if (!(hi > lo)) {
    const d = Math.max(1, Math.abs(lo) * 0.25);
    return [lo - d, hi + d];
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

const SQRT2PI = Math.sqrt(2 * Math.PI);

/** Turns a statistics answer's chart data into a graph the 2D view draws (points, bars, boxes, shaded areas). */
export function statPlotSpec(plot: StatPlot): GraphSpec {
  const base = { sliders: [], notes: [], summary: plot.summary, axes: { x: plot.xLabel, y: plot.yLabel } };
  switch (plot.type) {
    case 'regression':
    case 'scatter': {
      const xs = plot.points.filter((_, i) => i % 2 === 0);
      const ys = plot.points.filter((_, i) => i % 2 === 1);
      const [xMin, xMax] = span(Math.min(...xs), Math.max(...xs), 0.15);
      const items: GraphItem[] = [{ kind: 'scatter', id: 1, label: `Data (${xs.length} points)`, points: plot.points }];
      const yAll = [...ys];
      if (plot.type === 'regression') {
        const model = plot.model;
        items.push({ kind: 'explicit', id: 0, label: plot.label, f: (e: FloatEnv) => evalModel(model, e.x ?? NaN) });
        for (let i = 0; i <= 40; i++) {
          const v = evalModel(model, xMin + ((xMax - xMin) * i) / 40);
          if (Number.isFinite(v)) yAll.push(v);
        }
      }
      // Keep the curve's swing in view, but don't let an exponential's tail dwarf the data.
      const dataLo = Math.min(...ys);
      const dataHi = Math.max(...ys);
      const room = (dataHi - dataLo || Math.abs(dataHi) || 1) * 1.5;
      const lo = Math.max(Math.min(...yAll), dataLo - room);
      const hi = Math.min(Math.max(...yAll), dataHi + room);
      const [yMin, yMax] = span(lo, hi, 0.15);
      return { ...base, items, view: { xMin, xMax, yMin, yMax } };
    }
    case 'histogram': {
      const top = Math.max(...plot.counts, 1);
      const [xMin, xMax] = span(plot.edges[0]!, plot.edges[plot.edges.length - 1]!, 0.08);
      return { ...base, items: [{ kind: 'bars', id: 1, label: 'Count per bin', edges: plot.edges, heights: plot.counts }], view: { xMin, xMax, yMin: -top * 0.08, yMax: top * 1.15 } };
    }
    case 'dot': {
      const points: number[] = [];
      plot.values.forEach((v, i) => {
        for (let k = 1; k <= plot.counts[i]!; k++) points.push(v, k);
      });
      const top = Math.max(...plot.counts);
      const [xMin, xMax] = span(plot.values[0]!, plot.values[plot.values.length - 1]!, 0.1);
      return { ...base, items: [{ kind: 'scatter', id: 1, label: 'One dot per value', points }], view: { xMin, xMax, yMin: -0.6, yMax: top + 1 } };
    }
    case 'box': {
      const [xMin, xMax] = span(plot.min, plot.max, 0.1);
      return {
        ...base,
        axes: { ...base.axes, yTicks: false },
        items: [{ kind: 'box', id: 1, label: `Median ${Number(plot.median.toPrecision(6))}`, q: [plot.lo, plot.q1, plot.median, plot.q3, plot.hi], outliers: plot.outliers, y: 1 }],
        // The box sits above the number line, so the axis and its labels stay clear of it.
        view: { xMin, xMax, yMin: -0.5, yMax: 2.2 },
      };
    }
    case 'normal': {
      const { mean, sd } = plot;
      const pdf = (e: FloatEnv) => {
        const z = ((e.x ?? NaN) - mean) / sd;
        return Math.exp(-0.5 * z * z) / (sd * SQRT2PI);
      };
      const peak = 1 / (sd * SQRT2PI);
      const items: GraphItem[] = [{ kind: 'explicit', id: 1, label: plot.lo === null && plot.hi === null ? plot.label : 'Density', f: pdf }];
      if (plot.lo !== null || plot.hi !== null) items.unshift({ kind: 'shade', id: 0, label: plot.label, f: pdf, from: plot.lo ?? -Infinity, to: plot.hi ?? Infinity });
      return { ...base, items, view: { xMin: mean - 4 * sd, xMax: mean + 4 * sd, yMin: -peak * 0.08, yMax: peak * 1.2 } };
    }
  }
}
