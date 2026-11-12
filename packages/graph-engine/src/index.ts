export { isGraphRequest, parseGraph, type Comparator, type GraphItem, type GraphSpec, type Slider } from './spec';
export { marchImplicit, sampleExplicit, sampleParametric, samplePolar, sampleXofY, type Polyline, type Viewport } from './sample';
export { analyze, type Poi, type PoiKind } from './analyze';
export { sampleSurface, type SurfaceGrid } from './surface';
export { statPlotSpec } from './stat';
export { compile, parseExpr, namesIn, show, tokenize, values, ExprError, type Expr, type Scope } from './expr';
export { buildRows, columnName, fmtValue, type BuildResult, type RowIn, type RowOut, type TableIn } from './rows';
export { fitModel as fitParams, type FitResult } from './fit';
export { infer, inferItems, type InferInput, type InferResult, type InferTest, type Alt } from './infer';
export { analyzeCurves, autoWindow, toSegments, type Curve, type Segments } from './poi';
export { curve3d, extrudeMesh, marchingCubes, marchingCubesSteps, paramSurfaceMesh, surfaceMesh, type Box3, type Mesh3 } from './mesh3d';

/** "Nice" grid step (1, 2 or 5 × 10^k) for roughly `target` divisions of `span`. */
export function niceStep(span: number, target: number): number {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
