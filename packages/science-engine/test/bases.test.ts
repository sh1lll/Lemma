import { describe, expect, it } from 'vitest';
import { answerScience } from '../src';
import { ask, expectNeed, failure, line, show, val } from './helpers';

describe('number bases', () => {
  it.each([
    ['255 in hex', '0xFF', 255],
    ['0xff in decimal', '255', 255],
    ['1010 binary to decimal', '10', 10],
    ['0b1010', '10', 10],
    ['convert 100 to base 7', '202₇', 100], // 2·49 + 0·7 + 2
    ['42 in binary', '0b101010', 42],
    ['0o17 to decimal', '15', 15],
    ['zz base 36 to decimal', '1,295', 1295], // 35·36 + 35
    ['what is 4095 in hexadecimal', '0xFFF', 4095],
    ['ff hex to decimal', '255', 255],
    ['777 octal to binary', '0b111111111', 511],
  ])('%s → %s', (q, display, value) => {
    expect(show(q)).toBe(display);
    expect(val(q)).toBe(value);
    expect(ask(q).kind).toBe('bases');
  });

  it('shows the other common bases', () => {
    expect(line('255 in hex', 'Binary')).toBe('0b1111 1111');
    expect(line('255 in hex', 'Octal')).toBe('0o377');
    expect(line('255 in hex', 'Decimal')).toBe('255');
    expect(line('convert 100 to base 7', 'Base 7')).toBe('202₇');
  });

  it('negative numbers keep their sign and show two’s complement', () => {
    expect(show('-255 in hex')).toBe('−0xFF');
    expect(val('-255 in hex')).toBe(-255);
    // −255 in 16 bits is 0xFF01.
    expect(line('-255 in hex', "Two's complement (16-bit)")).toBe('1111 1111 0000 0001');
  });

  it('converts clean fractions only', () => {
    expect(show('0.5 in binary')).toBe('0b0.1');
    expect(show('0.75 in hex')).toBe('0x0.C');
    expect(show('0.1 binary to decimal')).toBe('0.5');
    expect(failure('0.1 in binary').error.message).toMatch(/no finite binary/);
  });

  it('rejects bad digits and bases', () => {
    expect(failure('1012 binary to decimal').error.message).toMatch(/isn't a valid binary/);
    expect(failure('10 in base 40').error.message).toMatch(/2 to 36/);
  });

  it('asks which base letters are in rather than guessing', () => {
    expectNeed('ff to decimal', /Which base/);
  });

  it('leaves plain numbers alone', () => {
    expect(answerScience('255')).toBeNull();
    expect(answerScience('255 in decimal')).toBeNull();
  });
});
