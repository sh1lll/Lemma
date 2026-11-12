// Dependency-free so the web app's photo/handwriting/worksheet reader can reuse the same OCR → math tidy-up.
/** Tidies OCR output into calculator input, one problem per line. The user still reviews and edits it. */
export function cleanOcr(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/[—–−]/g, '-')
        .replace(/[|]/g, '')
        // Uniform spacing around binary operators ("3x+5=20" and "3x + 5 = 20" read the same).
        .replace(/\s*([=<>≤≥])\s*/g, ' $1 ')
        .replace(/([\w)\]])\s*([+×÷*\/-])\s*(?=[\w(\[])/g, '$1 $2 ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((l) => /[0-9a-z]/i.test(l))
    .join('\n');
}
