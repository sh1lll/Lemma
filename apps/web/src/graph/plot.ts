import { statPlotSpec } from '@lemma/graph-engine';
import type { StatPlot } from '@lemma/stats-engine/src/plot';
import { GraphView } from './view';

/**
 * Charts attached to answers (Answer.plot): regression curves and statistical plots, drawn by the 2D graph view.
 * The host reserves a slot synchronously and calls showPlot once this chunk has loaded; a slot that has left the
 * page by then (the answer was replaced) is ignored. One view is reused across answers, so live typing redraws
 * without flicker.
 */

let view: GraphView | null = null;

export function showPlot(slot: HTMLElement, plot: { type: string }): void {
  if (!slot.isConnected) return;
  const spec = statPlotSpec(plot as StatPlot);
  if (view) view.setSpec(spec, true);
  else view = new GraphView(spec);
  view.root.classList.add('stat-plot');
  slot.replaceChildren(view.root);
}
