/**
 * A small stand-in for CanvasRenderingContext2D that records what the graph view draws as SVG, so "Export SVG" reuses
 * the exact drawing code. It covers the subset the view uses: paths (moveTo, lineTo, arc, rect, closePath), fill and
 * stroke, rectangles, text, dashes, alpha, clipping, images and save/restore.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

interface State {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  dash: number[];
  clip: string | null;
}

export class SvgCtx {
  private parts: string[] = [];
  private d = '';
  private st: State = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '12px sans-serif', textAlign: 'start', dash: [], clip: null };
  private stack: State[] = [];
  private clips = 0;
  lineJoin: CanvasLineJoin = 'round';
  lineCap: CanvasLineCap = 'round';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  constructor(private w: number, private h: number, private measure: CanvasRenderingContext2D) {}

  get fillStyle() {
    return this.st.fillStyle;
  }
  set fillStyle(v: string) {
    this.st.fillStyle = String(v);
  }
  get strokeStyle() {
    return this.st.strokeStyle;
  }
  set strokeStyle(v: string) {
    this.st.strokeStyle = String(v);
  }
  get lineWidth() {
    return this.st.lineWidth;
  }
  set lineWidth(v: number) {
    this.st.lineWidth = v;
  }
  get globalAlpha() {
    return this.st.globalAlpha;
  }
  set globalAlpha(v: number) {
    this.st.globalAlpha = v;
  }
  get font() {
    return this.st.font;
  }
  set font(v: string) {
    this.st.font = v;
  }
  get textAlign() {
    return this.st.textAlign;
  }
  set textAlign(v: CanvasTextAlign) {
    this.st.textAlign = v;
  }

  setTransform(): void {}
  setLineDash(d: number[]): void {
    this.st.dash = [...d];
  }
  save(): void {
    this.stack.push({ ...this.st, dash: [...this.st.dash] });
  }
  restore(): void {
    this.st = this.stack.pop() ?? this.st;
  }
  beginPath(): void {
    this.d = '';
  }
  moveTo(x: number, y: number): void {
    this.d += `M${n(x)} ${n(y)}`;
  }
  lineTo(x: number, y: number): void {
    this.d += `L${n(x)} ${n(y)}`;
  }
  closePath(): void {
    this.d += 'Z';
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.d += `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number): void {
    const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
    if (full) {
      this.d += `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)}`;
      return;
    }
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    this.d += `${this.d ? 'L' : 'M'}${n(x0)} ${n(y0)}A${n(r)} ${n(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${n(x1)} ${n(y1)}`;
  }
  private attrs(): string {
    const a = this.st.globalAlpha < 1 ? ` opacity="${n(this.st.globalAlpha)}"` : '';
    const c = this.st.clip ? ` clip-path="url(#${this.st.clip})"` : '';
    return a + c;
  }
  fill(): void {
    if (this.d) this.parts.push(`<path d="${this.d}" fill="${esc(this.st.fillStyle)}"${this.attrs()}/>`);
  }
  stroke(): void {
    if (!this.d) return;
    const dash = this.st.dash.length ? ` stroke-dasharray="${this.st.dash.join(' ')}"` : '';
    this.parts.push(`<path d="${this.d}" fill="none" stroke="${esc(this.st.strokeStyle)}" stroke-width="${n(this.st.lineWidth)}" stroke-linejoin="${this.lineJoin}" stroke-linecap="${this.lineCap}"${dash}${this.attrs()}/>`);
  }
  clip(): void {
    const id = `c${++this.clips}`;
    this.parts.push(`<clipPath id="${id}"><path d="${this.d}"/></clipPath>`);
    this.st.clip = id;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${esc(this.st.fillStyle)}"${this.attrs()}/>`);
  }
  clearRect(): void {}
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="${esc(this.st.strokeStyle)}" stroke-width="${n(this.st.lineWidth)}"${this.attrs()}/>`);
  }
  measureText(t: string): TextMetrics {
    this.measure.font = this.st.font;
    return this.measure.measureText(t);
  }
  fillText(t: string, x: number, y: number): void {
    const anchor = this.st.textAlign === 'center' ? 'middle' : this.st.textAlign === 'right' || this.st.textAlign === 'end' ? 'end' : 'start';
    const base = this.textBaseline === 'middle' ? ' dominant-baseline="middle"' : '';
    this.parts.push(`<text x="${n(x)}" y="${n(y)}" fill="${esc(this.st.fillStyle)}" text-anchor="${anchor}" style="font:${esc(this.st.font)}"${base}${this.attrs()}>${esc(t)}</text>`);
  }
  drawImage(img: CanvasImageSource, x: number, y: number, w?: number, h?: number): void {
    let href = '';
    try {
      const c = document.createElement('canvas');
      const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
      const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
      c.width = iw;
      c.height = ih;
      c.getContext('2d')!.drawImage(img, 0, 0);
      href = c.toDataURL('image/png');
    } catch {
      return;
    }
    this.parts.push(`<image href="${href}" x="${n(x)}" y="${n(y)}" width="${n(w ?? 0)}" height="${n(h ?? 0)}" preserveAspectRatio="none"${this.attrs()}/>`);
  }

  toString(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(this.w)}" height="${n(this.h)}" viewBox="0 0 ${n(this.w)} ${n(this.h)}">${this.parts.join('')}</svg>`;
  }
}
