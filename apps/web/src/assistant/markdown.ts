/**
 * Minimal, safe markdown for assistant replies: everything is HTML-escaped first, then a small subset is
 * applied (paragraphs, headings, lists, bold/italic, inline code, links to https only) and math in
 * $…$ / $$…$$ / \(…\) / \[…\] is typeset with KaTeX. No raw HTML from the model ever reaches the DOM.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string, math: string[]): string {
  // Pull out math and code first so their contents are not formatted.
  const slots: string[] = [];
  const keep = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  s = s.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_m, a, b) => keep(`<span class="md-math display" data-i="${math.push(a ?? b) - 1}"></span>`));
  s = s.replace(/\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g, (_m, a, b) => keep(`<span class="md-math" data-i="${math.push(a ?? b) - 1}"></span>`));
  s = s.replace(/`([^`]+)`/g, (_m, c) => keep(`<code>${esc(c)}</code>`));
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => slots[Number(i)]!);
}

export function renderMarkdown(el: HTMLElement, text: string): void {
  const math: string[] = [];
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  // Display math may span lines: join $$ … $$ blocks before splitting.
  const lines = text.replace(/\$\$([\s\S]+?)\$\$/g, (m) => m.replace(/\n/g, ' ')).split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '), math)}</p>`);
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      flush();
      closeList();
    } else if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      flush();
      closeList();
      out.push(`<h4>${inline(m[2]!, math)}</h4>`);
    } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      flush();
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(m[1]!, math)}</li>`);
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flush();
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(m[1]!, math)}</li>`);
    } else {
      closeList();
      para.push(line);
    }
  }
  flush();
  closeList();
  el.innerHTML = out.join('');
  if (!math.length) return;
  void import('../math-render').then(({ renderInlineMath }) => {
    el.querySelectorAll<HTMLElement>('.md-math').forEach((n) => renderInlineMath(n, math[Number(n.dataset.i)]!, n.classList.contains('display')));
  });
}
