import type { V } from './exact';
import type { Shape } from './solver';

/**
 * Small labelled diagrams as SVG text. Everything is drawn with currentColor so it follows the page's theme;
 * labels are numbers this engine computed, escaped anyway.
 */

export type Pt = [number, number];
export interface Figure {
  svg: string;
  alt: string;
}

const escXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const r1 = (x: number) => Math.round(x * 10) / 10;

export function short(x: number | undefined, unit = ''): string {
  if (x === undefined || !Number.isFinite(x)) return '';
  const t = Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : String(+x.toPrecision(4));
  return unit ? `${t} ${unit}` : t;
}

interface Item {
  kind: 'poly' | 'line' | 'circle' | 'ellipse' | 'text' | 'path' | 'dot';
  pts?: Pt[];
  closed?: boolean;
  dashed?: boolean;
  fill?: boolean;
  c?: Pt;
  rx?: number;
  ry?: number;
  text?: string;
  anchor?: 'start' | 'middle' | 'end';
  d?: (map: (p: Pt) => Pt, s: number) => string;
  bold?: boolean;
}

/** A figure in world coordinates (y up); scaled to fit the box when rendered. */
export class Drawing {
  items: Item[] = [];
  private pts: Pt[] = [];
  constructor(
    private w = 260,
    private h = 190,
  ) {}
  private note(...p: Pt[]) {
    this.pts.push(...p);
  }
  poly(pts: Pt[], o: { closed?: boolean; dashed?: boolean; fill?: boolean } = {}) {
    this.note(...pts);
    this.items.push({ kind: 'poly', pts, closed: o.closed ?? true, dashed: o.dashed, fill: o.fill ?? o.closed ?? true });
    return this;
  }
  line(a: Pt, b: Pt, dashed = false) {
    this.note(a, b);
    this.items.push({ kind: 'line', pts: [a, b], dashed });
    return this;
  }
  circle(c: Pt, r: number, o: { dashed?: boolean; fill?: boolean } = {}) {
    this.note([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]);
    this.items.push({ kind: 'circle', c, rx: r, ry: r, dashed: o.dashed, fill: o.fill ?? true });
    return this;
  }
  ellipse(c: Pt, rx: number, ry: number, o: { dashed?: boolean; fill?: boolean } = {}) {
    this.note([c[0] - rx, c[1] - ry], [c[0] + rx, c[1] + ry]);
    this.items.push({ kind: 'ellipse', c, rx, ry, dashed: o.dashed, fill: o.fill ?? false });
    return this;
  }
  /** Arc of an ellipse from angle t0 to t1 (radians, counter-clockwise). */
  arc(c: Pt, rx: number, ry: number, t0: number, t1: number, dashed = false) {
    const pts: Pt[] = [];
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      pts.push([c[0] + rx * Math.cos(t), c[1] + ry * Math.sin(t)]);
    }
    return this.poly(pts, { closed: false, dashed, fill: false });
  }
  text(p: Pt, text: string, anchor: 'start' | 'middle' | 'end' = 'middle', bold = false) {
    if (text) this.items.push({ kind: 'text', c: p, text, anchor, bold });
    return this;
  }
  dot(p: Pt) {
    this.note(p);
    this.items.push({ kind: 'dot', c: p });
    return this;
  }
  /** Label at the middle of a segment, pushed outward from `away`. */
  edgeLabel(a: Pt, b: Pt, text: string, away: Pt, gap = 0.08) {
    const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    if ((m[0] - away[0]) * nx + (m[1] - away[1]) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const span = this.span();
    this.items.push({ kind: 'text', c: [m[0] + nx * span * gap, m[1] + ny * span * gap], text, anchor: 'middle' });
    return this;
  }
  span(): number {
    if (!this.pts.length) return 1;
    const xs = this.pts.map((p) => p[0]);
    const ys = this.pts.map((p) => p[1]);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  }
  render(alt: string): Figure {
    const pad = 30;
    const xs = this.pts.map((p) => p[0]);
    const ys = this.pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const sw = maxX - minX || 1;
    const sh = maxY - minY || 1;
    const s = Math.min((this.w - 2 * pad) / sw, (this.h - 2 * pad) / sh);
    const ox = (this.w - sw * s) / 2;
    const oy = (this.h - sh * s) / 2;
    const map = (p: Pt): Pt => [r1(ox + (p[0] - minX) * s), r1(this.h - (oy + (p[1] - minY) * s))];
    const out: string[] = [];
    const stroke = 'stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"';
    for (const it of this.items) {
      const dash = it.dashed ? ' stroke-dasharray="4 3"' : '';
      if (it.kind === 'poly') {
        const d = it.pts!.map(map).map((p) => p.join(',')).join(' ');
        out.push(`<${it.closed ? 'polygon' : 'polyline'} points="${d}" ${stroke}${dash} fill="${it.fill ? 'currentColor' : 'none'}"${it.fill ? ' fill-opacity="0.08"' : ''}/>`);
      } else if (it.kind === 'line') {
        const [a, b] = it.pts!.map(map);
        out.push(`<line x1="${a![0]}" y1="${a![1]}" x2="${b![0]}" y2="${b![1]}" ${stroke}${dash}/>`);
      } else if (it.kind === 'circle' || it.kind === 'ellipse') {
        const c = map(it.c!);
        out.push(`<ellipse cx="${c[0]}" cy="${c[1]}" rx="${r1(it.rx! * s)}" ry="${r1(it.ry! * s)}" ${stroke}${dash} fill="${it.fill ? 'currentColor' : 'none'}"${it.fill ? ' fill-opacity="0.08"' : ''}/>`);
      } else if (it.kind === 'dot') {
        const c = map(it.c!);
        out.push(`<circle cx="${c[0]}" cy="${c[1]}" r="2.6" fill="currentColor"/>`);
      } else if (it.kind === 'text') {
        const c = map(it.c!);
        out.push(`<text x="${c[0]}" y="${r1(c[1] + 4)}" text-anchor="${it.anchor}" font-size="11.5"${it.bold ? ' font-weight="600"' : ''} fill="currentColor" stroke="none">${escXml(it.text!)}</text>`);
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}" role="img" aria-label="${escXml(alt)}" font-family="system-ui, sans-serif">${out.join('')}</svg>`;
    return { svg, alt };
  }
}

const centroid = (pts: Pt[]): Pt => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];

/** A labelled polygon (vertex letters, side lengths). */
export function polygonFigure(pts: Pt[], o: { vertex?: string[]; edges?: (string | undefined)[]; alt: string; inner?: (d: Drawing) => void }): Figure {
  const d = new Drawing();
  d.poly(pts);
  o.inner?.(d);
  const c = centroid(pts);
  const span = d.span();
  pts.forEach((p, i) => {
    const lab = o.vertex?.[i];
    if (lab) {
      const dx = p[0] - c[0];
      const dy = p[1] - c[1];
      const l = Math.hypot(dx, dy) || 1;
      d.text([p[0] + (dx / l) * span * 0.07, p[1] + (dy / l) * span * 0.07], lab, 'middle', true);
    }
    const e = o.edges?.[i];
    if (e) d.edgeLabel(p, pts[(i + 1) % pts.length]!, e, c);
  });
  return d.render(o.alt);
}

function triPts(a: number, b: number, c: number): Pt[] | null {
  const x = (b * b + c * c - a * a) / (2 * c);
  const y2 = b * b - x * x;
  if (!(y2 > 0)) return null;
  return [[0, 0], [c, 0], [x, Math.sqrt(y2)]];
}

/** The figure for a solved shape, or null when there isn't a useful one. */
export function shapeFigure(shape: Shape, g: (k: string) => V | undefined, unit: string): Figure | null {
  const x = (k: string) => g(k)?.x;
  const L = (k: string) => short(x(k), unit);
  const name = shape.name;
  try {
    switch (shape.id) {
      case 'triangle': {
        const [a, b, c] = [x('a'), x('b'), x('c')];
        if (!a || !b || !c) return null;
        const pts = triPts(a, b, c);
        if (!pts) return null;
        const ang = (k: string) => (x(k) ? `${+x(k)!.toFixed(2)}°` : '');
        return polygonFigure(pts, {
          vertex: [`A ${ang('α')}`, `B ${ang('β')}`, `C ${ang('γ')}`],
          edges: [`c = ${L('c')}`, `a = ${L('a')}`, `b = ${L('b')}`],
          alt: `${name} with sides a = ${L('a')}, b = ${L('b')}, c = ${L('c')}`,
        });
      }
      case 'square': {
        const s = x('s');
        if (!s) return null;
        return polygonFigure([[0, 0], [s, 0], [s, s], [0, s]], { edges: [`s = ${L('s')}`], alt: `square with side ${L('s')}`, inner: (d) => d.line([0, 0], [s, s], true) });
      }
      case 'rectangle': {
        const [l, w] = [x('l'), x('w')];
        if (!l || !w) return null;
        return polygonFigure([[0, 0], [l, 0], [l, w], [0, w]], { edges: [`l = ${L('l')}`, `w = ${L('w')}`], alt: `rectangle ${L('l')} by ${L('w')}`, inner: (d) => d.line([0, 0], [l, w], true) });
      }
      case 'rhombus': {
        const [p, q] = [x('p'), x('q')];
        if (!p || !q) return null;
        return polygonFigure([[-p / 2, 0], [0, -q / 2], [p / 2, 0], [0, q / 2]], { edges: [`s = ${L('s')}`], alt: `rhombus with diagonals ${L('p')} and ${L('q')}`, inner: (d) => d.line([-p / 2, 0], [p / 2, 0], true).line([0, -q / 2], [0, q / 2], true) });
      }
      case 'parallelogram': {
        const [a, b, t] = [x('a'), x('b'), x('θ')];
        if (!a || !b || !t) return null;
        const dx = b * Math.cos((t * Math.PI) / 180);
        const dy = b * Math.sin((t * Math.PI) / 180);
        return polygonFigure([[0, 0], [a, 0], [a + dx, dy], [dx, dy]], { edges: [`a = ${L('a')}`, `b = ${L('b')}`], alt: `parallelogram with sides ${L('a')} and ${L('b')}`, inner: (d) => d.line([dx, dy], [dx, 0], true) });
      }
      case 'trapezoid':
      case 'isosceles-trapezoid':
      case 'right-trapezoid': {
        const [a, b, h] = [x('a'), x('b'), x('h')];
        if (!a || !b || !h) return null;
        const off = shape.id === 'trapezoid' ? x('x') ?? (a - b) / 2 : shape.id === 'right-trapezoid' ? 0 : (a - b) / 2;
        return polygonFigure([[0, 0], [a, 0], [off + b, h], [off, h]], { edges: [`a = ${L('a')}`, undefined, `b = ${L('b')}`], alt: `${name} with bases ${L('a')} and ${L('b')}, height ${L('h')}`, inner: (d) => d.line([off + b / 2, 0], [off + b / 2, h], true).text([off + b / 2 + (a + b) * 0.03, h / 2], `h = ${L('h')}`, 'start') });
      }
      case 'kite': {
        const [q, p1, p2] = [x('q'), x('p1'), x('p2')];
        if (!q || !p1 || !p2) return null;
        return polygonFigure([[0, p1], [q / 2, 0], [0, -p2], [-q / 2, 0]], { edges: [`a = ${L('a')}`, `b = ${L('b')}`], alt: `kite with diagonals ${L('p')} and ${L('q')}`, inner: (d) => d.line([0, p1], [0, -p2], true).line([-q / 2, 0], [q / 2, 0], true) });
      }
      case 'regular-polygon': {
        const n = x('n');
        const R = x('R');
        if (!n || !R || n > 40) return null;
        const pts: Pt[] = [];
        for (let i = 0; i < n; i++) {
          const t = -Math.PI / 2 - Math.PI / n + (2 * Math.PI * i) / n;
          pts.push([R * Math.cos(t), R * Math.sin(t)]);
        }
        const a = x('a') ?? 0;
        return polygonFigure(pts, { edges: [`s = ${L('s')}`], alt: `regular ${n}-gon with side ${L('s')}`, inner: (d) => d.line([0, 0], [0, -a], true).text([a * 0.08, -a / 2], `a = ${L('a')}`, 'start').dot([0, 0]) });
      }
      case 'circle': {
        const r = x('r');
        if (!r) return null;
        const d = new Drawing();
        d.circle([0, 0], r).line([0, 0], [r, 0]).dot([0, 0]).text([r / 2, r * 0.1], `r = ${L('r')}`);
        if (x('D') && x('t')) {
          const D = x('D')!;
          const tx = (r * r) / D;
          const ty = Math.sqrt(r * r - tx * tx);
          d.line([D, 0], [tx, ty]).line([D, 0], [tx, -ty]).dot([D, 0]).text([(D + tx) / 2, ty / 2 + r * 0.15], `t = ${L('t')}`);
        }
        return d.render(`circle with radius ${L('r')}`);
      }
      case 'sector': {
        const r = x('r');
        const th = x('θ');
        if (!r || !th) return null;
        const d = new Drawing();
        const t1 = (th * Math.PI) / 180;
        const pts: Pt[] = [[0, 0]];
        for (let i = 0; i <= 48; i++) pts.push([r * Math.cos((t1 * i) / 48), r * Math.sin((t1 * i) / 48)]);
        d.circle([0, 0], r, { dashed: true, fill: false }).poly(pts).dot([0, 0]).text([r / 2, -r * 0.1], `r = ${L('r')}`).text([r * 0.22 * Math.cos(t1 / 2), r * 0.22 * Math.sin(t1 / 2)], `${short(th)}°`);
        if (th < 360) d.line([r, 0], [r * Math.cos(t1), r * Math.sin(t1)], true);
        return d.render(`${name}: radius ${L('r')}, angle ${short(th)}°`);
      }
      case 'annulus': {
        const [R, r] = [x('R'), x('r')];
        if (!R || !r) return null;
        const d = new Drawing();
        d.circle([0, 0], R).circle([0, 0], r, { fill: false }).line([0, 0], [R, 0]).line([0, 0], [0, r], true).text([R * 0.6, R * 0.08], `R = ${L('R')}`).text([r * 0.08, r * 0.5], `r = ${L('r')}`, 'start');
        return d.render(`ring with radii ${L('R')} and ${L('r')}`);
      }
      case 'ellipse': {
        const [a, b] = [x('a'), x('b')];
        if (!a || !b) return null;
        const d = new Drawing();
        d.ellipse([0, 0], a, b, { fill: true }).line([0, 0], [a, 0]).line([0, 0], [0, b], true).text([a / 2, b * 0.1], `a = ${L('a')}`).text([b * 0.08, b / 2], `b = ${L('b')}`, 'start');
        const c = x('c');
        if (c) d.dot([c, 0]).dot([-c, 0]);
        return d.render(`ellipse with semi-axes ${L('a')} and ${L('b')}`);
      }
      case 'cylinder':
      case 'hollow-cylinder': {
        const r = x('r') ?? x('R');
        const h = x('h');
        if (!r || !h) return null;
        const R = shape.id === 'hollow-cylinder' ? x('R')! : r;
        const e = R * 0.3;
        const d = new Drawing();
        d.ellipse([0, 0], R, e, { dashed: false }).line([-R, 0], [-R, h]).line([R, 0], [R, h]).ellipse([0, h], R, e, { fill: true });
        if (shape.id === 'hollow-cylinder') d.ellipse([0, h], x('r')!, e * (x('r')! / R));
        d.line([0, h], [R, h]).text([R / 2, h + e * 0.5], `${shape.id === 'hollow-cylinder' ? 'R' : 'r'} = ${short(R, unit)}`).text([R * 1.08, h / 2], `h = ${L('h')}`, 'start');
        return d.render(`${name}: radius ${short(R, unit)}, height ${L('h')}`);
      }
      case 'cone':
      case 'frustum': {
        const h = x('h');
        const R = shape.id === 'cone' ? x('r') : x('R');
        const rt = shape.id === 'cone' ? 0 : x('r') ?? 0;
        if (!h || !R) return null;
        const e = R * 0.3;
        const d = new Drawing();
        d.ellipse([0, 0], R, e, { fill: true }).line([-R, 0], [-rt, h]).line([R, 0], [rt, h]).line([0, 0], [0, h], true).line([0, 0], [R, 0]);
        if (rt) d.ellipse([0, h], rt, e * (rt / R));
        d.text([R / 2, -e * 0.55], `${shape.id === 'cone' ? 'r' : 'R'} = ${short(R, unit)}`).text([-R * 0.06, h / 2], `h = ${L('h')}`, 'end');
        if (x('l')) d.text([(R + rt) / 2 + R * 0.12, h / 2], `l = ${L('l')}`, 'start');
        return d.render(`${name}: radius ${short(R, unit)}, height ${L('h')}`);
      }
      case 'sphere':
      case 'hemisphere': {
        const r = x('r');
        if (!r) return null;
        const d = new Drawing();
        if (shape.id === 'sphere') d.circle([0, 0], r).arc([0, 0], r, r * 0.28, Math.PI, 2 * Math.PI).arc([0, 0], r, r * 0.28, 0, Math.PI, true);
        else {
          d.arc([0, 0], r, r, 0, Math.PI).ellipse([0, 0], r, r * 0.28, { fill: true });
        }
        d.line([0, 0], [r, 0]).dot([0, 0]).text([r / 2, r * 0.08], `r = ${L('r')}`);
        return d.render(`${name} with radius ${L('r')}`);
      }
      case 'cube':
      case 'cuboid':
      case 'wedge': {
        const l = shape.id === 'cube' ? x('s') : x('l');
        const w = shape.id === 'cube' ? x('s') : x('w');
        const h = shape.id === 'cube' ? x('s') : x('h');
        if (!l || !w || !h) return null;
        const k = 0.45;
        const ox = w * k * Math.cos(Math.PI / 6);
        const oy = w * k * Math.sin(Math.PI / 6);
        const d = new Drawing();
        if (shape.id === 'wedge') {
          d.poly([[0, 0], [l, 0], [0, h]]).poly([[l, 0], [l + ox, oy], [ox, h + oy], [0, h]]).line([0, 0], [ox, oy], true).line([ox, oy], [l + ox, oy], true).line([ox, oy], [ox, h + oy], true);
        } else {
          d.poly([[0, 0], [l, 0], [l, h], [0, h]]).poly([[0, h], [l, h], [l + ox, h + oy], [ox, h + oy]]).poly([[l, 0], [l + ox, oy], [l + ox, h + oy], [l, h]]).line([0, 0], [ox, oy], true).line([ox, oy], [l + ox, oy], true).line([ox, oy], [ox, h + oy], true);
        }
        d.text([l / 2, -h * 0.12 - 2], shape.id === 'cube' ? `s = ${L('s')}` : `l = ${L('l')}`);
        if (shape.id !== 'cube') d.text([l + ox / 2 + l * 0.04, oy / 2], `w = ${L('w')}`, 'start').text([-l * 0.04, h / 2], `h = ${L('h')}`, 'end');
        return d.render(`${name} ${shape.id === 'cube' ? `with edge ${L('s')}` : `${L('l')} × ${L('w')} × ${L('h')}`}`);
      }
      case 'pyramid':
      case 'rect-pyramid': {
        const h = x('h');
        const l = shape.id === 'pyramid' ? x('s') : x('l');
        const w = shape.id === 'pyramid' ? x('s') : x('w');
        if (!h || !l || !w) return null;
        const k = 0.45;
        const ox = w * k * Math.cos(Math.PI / 6);
        const oy = w * k * Math.sin(Math.PI / 6);
        const apex: Pt = [(l + ox) / 2, h + oy / 2];
        const d = new Drawing();
        d.poly([[0, 0], [l, 0], apex]).poly([[l, 0], [l + ox, oy], apex]).line([0, 0], [ox, oy], true).line([ox, oy], [l + ox, oy], true).line([ox, oy], apex, true).line(apex, [(l + ox) / 2, oy / 2], true);
        d.text([l / 2, -h * 0.1 - 2], `${shape.id === 'pyramid' ? 's' : 'l'} = ${short(l, unit)}`).text([(l + ox) / 2 + l * 0.04, h / 2], `h = ${L('h')}`, 'start');
        return d.render(`${name}: base ${short(l, unit)}, height ${L('h')}`);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
