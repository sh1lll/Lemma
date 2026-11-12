import type { LectureSummary } from './summarize';

/** Roughly 6k tokens of transcript; longer lectures keep the start and end and the extracted notes carry the middle. */
const MAX_TRANSCRIPT_CHARS = 24000;

/**
 * Prompt for an optional LLM pass that turns the extractive notes into a study summary.
 * The model is told to stay within the transcript and to reuse the extracted formulas verbatim.
 */
export function aiSummaryPrompt(transcript: string, summary: LectureSummary): { system: string; user: string } {
  const system = [
    'You write study summaries of math lectures for students.',
    'Use only facts stated in the transcript. Do not add theorems, numbers, examples or history that the lecturer did not say; if something is unclear, say so.',
    'Copy formulas exactly as given in the FORMULAS list (they were checked by a math parser); you may add a one-line explanation of each.',
    'Output Markdown with these sections: ## Summary (3–5 sentences), ## Key ideas (bullets), ## Formulas, ## Definitions, ## Worked examples, ## Review questions (3, answerable from the transcript).',
    'Omit a section if the transcript has nothing for it. Keep it under 400 words.',
  ].join('\n');

  let text = transcript.replace(/\s+/g, ' ').trim();
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
    text = `${text.slice(0, half)} […middle of the transcript omitted; rely on the extracted notes for it…] ${text.slice(-half)}`;
  }
  const lines: string[] = [`TITLE (provisional): ${summary.title}`];
  if (summary.outline.length) lines.push('OUTLINE:', ...summary.outline.map((o) => `- ${o.heading}`));
  if (summary.formulas.length) lines.push('FORMULAS:', ...summary.formulas.map((f) => `- ${f.expression}${f.tex ? `  [TeX: ${f.tex}]` : ''}  (said: "${f.spoken}")`));
  if (summary.definitions.length) lines.push('DEFINITIONS:', ...summary.definitions.map((d) => `- ${d.term}: ${d.meaning}`));
  if (summary.keyPoints.length) lines.push('KEY SENTENCES:', ...summary.keyPoints.map((k) => `- ${k}`));
  if (summary.examples.length) lines.push('EXAMPLES:', ...summary.examples.map((e) => `- ${e}`));
  const user = `Extracted notes (automatic, may contain transcription errors):\n${lines.join('\n')}\n\nTRANSCRIPT:\n"""\n${text}\n"""\n\nWrite the study summary.`;
  return { system, user };
}
