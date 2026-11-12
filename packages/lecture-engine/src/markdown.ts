import type { LectureSummary } from './summarize';

/** mm:ss or h:mm:ss */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

const esc = (s: string) => s.replace(/([\\`*_[\]#|])/g, '\\$1');

/** Markdown note for saving to a notebook. Formulas carry TeX in $…$ when available. */
export function toMarkdown(summary: LectureSummary): string {
  const out: string[] = [`# ${esc(summary.title)}`, ''];
  if (summary.outline.length) {
    out.push('## Outline', '');
    for (const o of summary.outline) out.push(`- ${o.at !== undefined ? `**${formatTime(o.at)}** ` : ''}${esc(o.heading)}`);
    out.push('');
  }
  if (summary.keyPoints.length) {
    out.push('## Key points', '');
    for (const k of summary.keyPoints) out.push(`- ${esc(k)}`);
    out.push('');
  }
  if (summary.formulas.length) {
    out.push('## Formulas', '');
    for (const f of summary.formulas) out.push(`- ${f.tex ? `$${f.tex}$` : `\`${f.expression}\``} — “${esc(f.spoken)}”`);
    out.push('');
  }
  if (summary.definitions.length) {
    out.push('## Definitions', '');
    for (const d of summary.definitions) out.push(`- **${esc(d.term)}**: ${esc(d.meaning)}`);
    out.push('');
  }
  if (summary.examples.length) {
    out.push('## Examples', '');
    for (const e of summary.examples) out.push(`- ${esc(e)}`);
    out.push('');
  }
  out.push(`_${summary.wordCount.toLocaleString('en-US')} words transcribed._`, '');
  return out.join('\n');
}
