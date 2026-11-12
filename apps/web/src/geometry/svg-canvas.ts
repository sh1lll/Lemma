/**
 * Just enough of CanvasRenderingContext2D to record the geometry drawing as SVG, so the PNG and SVG exports come
 * from one drawing routine. Covers what geometry.ts uses: paths (moveTo, lineTo, arc, closePath), fill/stroke,
 * fillRect, fillText/measureText, dashes, alpha, save/restore.
 */

interface State {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  dash: number[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => String(Math.round(v * 100) / 100);

export class SvgContext {
  private parts: string[] = [];
  private stack: State[] = [];
  private s: State = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', dash: [] };
  private d = '';
  private open = false;

  constructor(
    private w: number,
    private h: number,
  ) {}

  get fillStyle() {
    return this.s.fillStyle;
  }
  set fillStyle(v: string) {
    this.s.fillStyle = String(v);
  }
  get strokeStyle() {
    return this.s.strokeStyle;
  }
  set strokeStyle(v: string) {
    this.s.strokeStyle = String(v);
  }
  get lineWidth() {
    return this.s.lineWidth;
  }
  set lineWidth(v: number) {
    this.s.lineWidth = v;
  }
  get globalAlpha() {
    return this.s.globalAlpha;
  }
  set globalAlpha(v: number) {
    this.s.globalAlpha = v;
  }
  get font() {
    return this.s.font;
  }
  set font(v: string) {
    this.s.font = v;
  }
  get textAlign() {
    return this.s.textAlign;
  }
  set textAlign(v: CanvasTextAlign) {
    this.s.textAlign = v;
  }
  get textBaseline() {
    return this.s.textBaseline;
  }
  set textBaseline(v: CanvasTextBaseline) {
    this.s.textBaseline = v;
  }
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';

  save() {
    this.stack.push({ ...this.s, dash: [...this.s.dash] });
  }
  restore() {
    const s = this.stack.pop();
    if (s) this.s = s;
  }
  scale() {}
  setTransform() {}
  setLineDash(d: number[]) {
    this.s.dash = [...d];
  }
  getLineDash() {
    return [...this.s.dash];
  }

  beginPath() {
    this.d = '';
    this.open = false;
  }
  moveTo(x: number, y: number) {
    this.d += `M${n(x)} ${n(y)}`;
    this.open = true;
  }
  lineTo(x: number, y: number) {
    this.d += `${this.open ? 'L' : 'M'}${n(x)} ${n(y)}`;
    this.open = true;
  }
  closePath() {
    if (this.open) this.d += 'Z';
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false) {
    const tau = Math.PI * 2;
    let sweep = ccw ? start - end : end - start;
    if (sweep >= tau - 1e-9) sweep = tau;
    else sweep = ((sweep % tau) + tau) % tau;
    const at = (t: number) => `${n(x + r * Math.cos(t))} ${n(y + r * Math.sin(t))}`;
    this.d += `${this.open ? 'L' : 'M'}${at(start)}`;
    this.open = true;
    const dir = ccw ? -1 : 1;
    const flag = ccw ? 0 : 1;
    if (sweep >= tau) {
      // A full circle is two half arcs (one SVG arc can't start and end at the same point).
      this.d += `A${n(r)} ${n(r)} 0 1 ${flag} ${at(start + dir * Math.PI)}A${n(r)} ${n(r)} 0 1 ${flag} ${at(start)}`;
    } else if (sweep > 0) {
      this.d += `A${n(r)} ${n(r)} 0 ${sweep > Math.PI ? 1 : 0} ${flag} ${at(start + dir * sweep)}`;
    }
  }

  private common(): string {
    return this.s.globalAlpha < 1 ? ` opacity="${n(this.s.globalAlpha)}"` : '';
  }
  stroke() {
    if (!this.d) return;
    const dash = this.s.dash.length ? ` stroke-dasharray="${this.s.dash.map(n).join(' ')}"` : '';
    this.parts.push(`<path d="${this.d}" fill="none" stroke="${esc(this.s.strokeStyle)}" stroke-width="${n(this.s.lineWidth)}" stroke-linecap="round" stroke-linejoin="round"${dash}${this.common()}/>`);
  }
  fill() {
    if (!this.d) return;
    this.parts.push(`<path d="${this.d}" fill="${esc(this.s.fillStyle)}"${this.common()}/>`);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${esc(this.s.fillStyle)}"${this.common()}/>`);
  }
  private fontParts() {
    const m = /^(?:(\d{3}|bold|normal)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/.exec(this.s.font.trim());
    return { weight: m?.[1] ?? 'normal', size: Number(m?.[2] ?? 10), family: m?.[3] ?? 'sans-serif' };
  }
  measureText(text: string): TextMetrics {
    const { size, weight } = this.fontParts();
    return { width: text.length * size * (weight === 'normal' ? 0.56 : 0.6) } as TextMetrics;
  }
  fillText(text: string, x: number, y: number) {
    const { weight, size, family } = this.fontParts();
    const anchor = this.s.textAlign === 'center' ? 'middle' : this.s.textAlign === 'right' || this.s.textAlign === 'end' ? 'end' : 'start';
    const base = this.s.textBaseline === 'top' || this.s.textBaseline === 'hanging' ? 'hanging' : this.s.textBaseline === 'middle' ? 'central' : this.s.textBaseline === 'bottom' ? 'text-after-edge' : 'alphabetic';
    this.parts.push(
      `<text x="${n(x)}" y="${n(y)}" font-family="${esc(family)}" font-size="${n(size)}" font-weight="${esc(weight)}" text-anchor="${anchor}" dominant-baseline="${base}" fill="${esc(this.s.fillStyle)}"${this.common()}>${esc(text)}</text>`,
    );
  }

  toString(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(this.w)}" height="${n(this.h)}" viewBox="0 0 ${n(this.w)} ${n(this.h)}">\n${this.parts.join('\n')}\n</svg>\n`;
  }
}
