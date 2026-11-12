import { describe, expect, it } from 'vitest';
import { D } from '@lemma/math-core';
import { backspace, EditHistory, insert, move, operandBefore, type EditState } from '../src/keyboard/edit';
import { answerForms, exactForm, mixedNumber } from '../src/keyboard/forms';

const at = (value: string, start = value.length, end = start): EditState => ({ value, start, end });
const show = (s: EditState) => (s.start === s.end ? `${s.value.slice(0, s.start)}|${s.value.slice(s.start)}` : `${s.value.slice(0, s.start)}[${s.value.slice(s.start, s.end)}]${s.value.slice(s.end)}`);
const FRAC = { t: '(§)/()', w: '(@)/(§)', frac: true };

describe('templates place the cursor', () => {
  it('inserts plain text and templates', () => {
    expect(show(insert(at('2+'), '3'))).toBe('2+3|');
    expect(show(insert(at(''), 'sqrt(§)'))).toBe('sqrt(|)');
    expect(show(insert(at('1+'), { t: 'root(§, )', w: 'root(@, §)' }))).toBe('1+root(|, )');
    expect(show(insert(at(''), 'mean([§])'))).toBe('mean([|])');
    expect(show(insert(at('ab', 1), 'x'))).toBe('ax|b');
  });
  it('wraps a selection', () => {
    expect(show(insert(at('2x', 0, 2), 'sqrt(§)'))).toBe('sqrt(2x|)');
    expect(show(insert(at('27', 0, 2), { t: 'root(§, )', w: 'root(@, §)' }))).toBe('root(27, |)');
    expect(show(insert(at('1+2', 0, 3), FRAC))).toBe('(1+2)/(|)');
  });
  it('a/b takes the operand before the cursor as its numerator', () => {
    expect(show(insert(at(''), FRAC))).toBe('(|)/()');
    expect(show(insert(at('5'), FRAC))).toBe('(5)/(|)');
    expect(show(insert(at('2+35'), FRAC))).toBe('2+(35)/(|)');
    expect(show(insert(at('sin(x)'), FRAC))).toBe('(sin(x))/(|)');
    expect(show(insert(at('2+'), FRAC))).toBe('2+(|)/()');
    expect(operandBefore('3*(a+b)', 7)).toBe(2);
  });
});

describe('cursor keys and backspace', () => {
  it('→ jumps from numerator to denominator and over ", "', () => {
    expect(show(move(at('(3)/()', 2), 1))).toBe('(3)/(|)');
    expect(show(move(at('(3)/(4)', 5), -1))).toBe('(3|)/(4)');
    expect(show(move(at('root(27, )', 7), 1))).toBe('root(27, |)');
    expect(show(move(at('abc', 1, 2), 1))).toBe('ab|c');
    expect(show(move(at('abc', 0), -1))).toBe('|abc');
  });
  it('backspace removes empty templates and function openers whole', () => {
    expect(show(backspace(at('2+sqrt()', 7)))).toBe('2+|');
    expect(show(backspace(at('sin(', 4)))).toBe('|');
    expect(show(backspace(at('()/()', 1)))).toBe('|');
    expect(show(backspace(at('12', 2)))).toBe('1|');
    expect(show(backspace(at('12+3', 1, 3)))).toBe('1|3');
    expect(show(backspace(at('x', 0)))).toBe('|x');
  });
});

describe('undo and redo per field', () => {
  it('undoes and redoes edits; typing bursts are one step', () => {
    const h = new EditHistory();
    let s = at('');
    for (const ch of ['1', '+', '2']) {
      h.record(s);
      s = insert(s, ch);
    }
    expect(s.value).toBe('1+2');
    s = h.undo(s)!;
    expect(s.value).toBe('1+');
    s = h.undo(s)!;
    expect(s.value).toBe('1');
    s = h.redo(s)!;
    expect(s.value).toBe('1+');
    expect(h.canRedo).toBe(true);
    h.record(s);
    s = insert(s, '9');
    expect(h.canRedo).toBe(false);

    const typed = new EditHistory();
    typed.record(at(''), true);
    typed.record(at('a'), true);
    typed.record(at('ab'), true);
    expect(typed.undo(at('abc'))!.value).toBe('');
  });
});

describe('answer forms', () => {
  it('mixed numbers', () => {
    expect(mixedNumber('7/2')).toBe('3 1/2');
    expect(mixedNumber('-11/4')).toBe('-2 3/4');
    expect(mixedNumber('1/3')).toBeNull();
    expect(mixedNumber('8/4')).toBe('2');
  });
  it('recognises exact forms of common irrationals, and nothing else', () => {
    expect(exactForm(new D(8).sqrt())).toBe('2√2');
    expect(exactForm(new D(3).sqrt().div(2))).toBe('√3/2');
    expect(exactForm(new D(2).sqrt().neg())).toBe('−√2');
    expect(exactForm(D.acos(-1).div(4))).toBe('π/4');
    expect(exactForm(D.acos(-1).mul(3).div(2))).toBe('3π/2');
    expect(exactForm(new D(0.5))).toBeNull();
    expect(exactForm(D.exp(1))).toBeNull();
    expect(exactForm(D.ln(2))).toBeNull();
  });
  it('orders the forms by preference', () => {
    const r = { display: '3.5', fraction: '7/2', value: new D(3.5) };
    expect(answerForms(r, { mixed: false, exactFirst: false }).map((f) => f.text)).toEqual(['3.5', '7/2', '3 1/2']);
    expect(answerForms(r, { mixed: true, exactFirst: false }).map((f) => f.text)).toEqual(['3.5', '3 1/2', '7/2']);
    expect(answerForms(r, { mixed: true, exactFirst: true }).map((f) => f.text)).toEqual(['3 1/2', '7/2', '3.5']);
    const root = { display: '1.41421356237', value: new D(2).sqrt() };
    expect(answerForms(root, { mixed: false, exactFirst: true }).map((f) => f.text)).toEqual(['√2', '1.41421356237']);
    expect(answerForms({ display: '4', value: new D(4) }, { mixed: false, exactFirst: true })).toHaveLength(1);
  });
});
