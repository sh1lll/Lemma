import { MathError, type AnswerResult } from '@lemma/math-core';
import { answerCoord } from './coord';
import { detectShape, solveShapeText } from './solve-text';
import { prep } from './text';

export { V, snap } from './exact';
export { detectShape } from './solve-text';

/**
 * Cheap pre-check (no lookbehind): true for every phrasing {@link answerShape} might take. The runtime keeps a
 * copy of this in the main bundle.
 */
export const LOOKS_LIKE_SHAPE =
  /\b(?:triangles?|hypotenuse|pythag\w*|squares?|rectangles?|rectangular|oblong|rhomb\w*|diamond|parallelograms?|trapez\w*|kites?|polygon|\w+gon|pentagon|hexagon|heptagon|octagon|nonagon|decagon|dodecagon|circles?|circular|semi-?circle|discs?|disks?|sectors?|arcs?|chords?|annulus|ring|ellipses?|ovals?|cubes?|cuboid|box|prism|cylinders?|cylindrical|pipe|tube|cones?|conical|frustum|pyramid|spheres?|ball|hemi-?sphere|dome|spherical|torus|donut|doughnut|capsule|wedge|ellipsoid|spheroid|\w+hedron|midpoint|slope|gradient|distance|line|collinear|reflect\w*|rotat\w*|translat\w*|dilat\w*|locus|plane|foci|focus|directrix|eccentricity|asymptotes?|parabola|hyperbola|conic)\b|\(\s*-?[\d.]+\s*,\s*-?[\d.]+/i;

/** Solves geometry questions: any 2D/3D shape from whatever is known, triangles, and coordinate geometry. */
export function answerShape(input: string): AnswerResult | null {
  if (input.length > 600) return null;
  try {
    const t = prep(input);
    if (!t.s) return null;
    if (/\b(?:box ?plots?|boxplot|whiskers?|histograms?|scatter|regression|best fit|derivative|integra\w*|limit|graph|plot|chi|chi-squared?|anova|[tz]-test|p-value|observed|expected|goodness)\b|chi-?square/.test(t.s)) return null;
    if (/\(\s*-?[\d.√]/.test(t.s) || /[xyz]\s*[=²^]|=\s*[-\d.]*\s*[xyz]\b/.test(t.s)) {
      const c = answerCoord(t);
      if (c) return c;
    }
    const det = detectShape(t.s);
    if (det) return solveShapeText(t, det);
    return null;
  } catch (e) {
    return { ok: false, kind: 'shape', input, error: new MathError('domain', e instanceof Error ? e.message : String(e)) };
  }
}
