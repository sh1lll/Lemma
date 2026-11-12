import { isFunctionName } from './builtins';
import { MathError } from './errors';

const CONSTANT_NAMES: Record<string, true> = { pi: true, e: true, tau: true, phi: true, ans: true };

export type Token =
  | { t: 'num'; v: string; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: Op; pos: number };

export type Op = '+' | '-' | '*' | '/' | '^' | '%' | '!' | '(' | ')' | '[' | ']' | ',' | '=' | '|' | '°' | 'of' | 'off' | 'mod';

// "[" and "]" only appear as list arguments: mean([1, 2, 3]).
const SINGLE_OPS = new Set(['+', '-', '*', '/', '^', '%', '!', '(', ')', '[', ']', ',', '=', '|', '°']);
const WORD_OPS = new Set(['of', 'off', 'mod']);
// Identifiers that take a trailing integer as part of their name: root3 = cube root, logb2 = log base 2.
const DIGIT_SUFFIX_IDS = new Set(['root', 'logb']);

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isAlpha = (c: string | undefined) => c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_');

/** Hand-written scanner: a single pass with no regex allocation keeps lexing well under a microsecond per token. */
export function lex(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      const start = i;
      while (isDigit(src[i])) i++;
      if (src[i] === '.') {
        i++;
        while (isDigit(src[i])) i++;
      }
      // Scientific notation only when digits follow, so "2e" stays 2·e.
      if ((src[i] === 'e' || src[i] === 'E') && (isDigit(src[i + 1]) || ((src[i + 1] === '+' || src[i + 1] === '-') && isDigit(src[i + 2])))) {
        i += 2;
        while (isDigit(src[i])) i++;
      }
      out.push({ t: 'num', v: src.slice(start, i), pos: start });
      continue;
    }
    if (isAlpha(c)) {
      const start = i;
      while (isAlpha(src[i])) i++;
      let word = src.slice(start, i).toLowerCase();
      if (DIGIT_SUFFIX_IDS.has(word) && isDigit(src[i])) {
        while (isDigit(src[i])) i++;
        word = src.slice(start, i).toLowerCase();
      } else if ((isDigit(src[i]) || src[i] === '_') && !isFunctionName(word) && !(word in CONSTANT_NAMES)) {
        // Variable names may carry digits: x1, v0, rate2 (but "sin30" stays sin 30, "pi2" stays pi·2).
        while (isDigit(src[i]) || isAlpha(src[i])) i++;
        word = src.slice(start, i).toLowerCase();
      }
      if (WORD_OPS.has(word)) out.push({ t: 'op', v: word as Op, pos: start });
      else out.push({ t: 'id', v: word, pos: start });
      continue;
    }
    if (SINGLE_OPS.has(c)) {
      out.push({ t: 'op', v: c as Op, pos: i });
      i++;
      continue;
    }
    // Whole characters, not half of an emoji's surrogate pair.
    throw new MathError('syntax', `Unexpected character "${String.fromCodePoint(src.codePointAt(i) ?? 0xfffd)}"`, i);
  }
  return out;
}
