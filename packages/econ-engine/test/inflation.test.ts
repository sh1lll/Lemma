import { describe, expect, it } from 'vitest';
import { answerInflation, cpi, US_CPI, US_CPI_LAST } from '../src';

function ok(input: string) {
  const r = answerInflation(input);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r;
}
function err(input: string) {
  const r = answerInflation(input);
  if (!r || r.ok) throw new Error(`"${input}" should be refused`);
  return r.error.message;
}

describe('bundled CPI-U table (BLS annual averages)', () => {
  it('covers 1913 through the last full year, one value per year', () => {
    expect(US_CPI.first).toBe(1913);
    expect(US_CPI_LAST).toBe(2024);
    expect(US_CPI.values).toHaveLength(2024 - 1913 + 1);
  });

  it.each([
    [1913, 9.9],
    [1929, 17.1],
    [1950, 24.1],
    [1980, 82.4],
    [1990, 130.7],
    [2000, 172.2],
    [2010, 218.056],
    [2020, 258.811],
    [2024, 313.689],
  ])('CPI-U %i = %d', (y, v) => expect(cpi(y)).toBe(v));

  it('averages 100 over the 1982–84 base period', () => {
    expect(((cpi(1982)! + cpi(1983)! + cpi(1984)!) / 3).toFixed(1)).toBe('100.0');
  });

  // Annual-average inflation as published by BLS (one decimal).
  it.each([
    ['inflation in 2024', '2.9%'],
    ['inflation in 2023', '4.1%'],
    ['inflation in 2022', '8.0%'],
    ['inflation rate in 2021', '4.7%'],
    ['2009 inflation', '−0.4%'],
    ['inflation in 1980', '13.5%'],
    ['inflation in 1932', '−9.9%'],
  ])('%s → %s', (q, want) => expect(ok(q).primary.display.replace('-', '−')).toBe(want));
});

describe('inflation adjustment', () => {
  it.each([
    // 100 × 313.689 / 130.7
    ["$100 in 1990 in today's dollars", '$240.01'],
    ['$100 in 1990 adjusted for inflation', '$240.01'],
    ['$100 in 1990 dollars', '$240.01'],
    // 50,000 × 258.811 / 107.6
    ["what's $50,000 from 1985 worth in 2020", '$120,265.33'],
    ['how much is $20 from 1950 worth today', '$260.32'],
    ['100 dollars in 1913 to 2024', '$3,168.58'],
    // Backwards in time.
    ['$100 in 2020 in 1990 dollars', '$50.50'],
    ['$1k in 2000 worth in 2024', '$1,821.66'],
  ])('%s → %s', (q, want) => expect(ok(q).primary.display).toBe(want));

  it('cumulative inflation between years', () => {
    const r = ok('inflation from 2000 to 2024');
    expect(r.primary.display).toBe('82.17%');
    expect(r.lines).toContainEqual({ label: 'Average per year', display: '2.53%' });
    expect(ok('inflation since 1990').primary.display).toBe('140.01%');
    expect(ok('inflation between 2024 and 2000').primary.display).toBe('82.17%');
  });

  it('states the source and the last year in the provenance', () => {
    const r = ok("$100 in 1990 in today's dollars");
    expect(r.source?.name).toMatch(/BLS CPI-U/);
    expect(r.source?.asOf).toBe('2024 annual average');
    expect(r.notes.join(' ')).toMatch(/“Today” means 2024/);
    expect(r.lines).toContainEqual({ label: 'CPI-U 1990', display: '130.7' });
  });

  it('refuses years outside the table clearly', () => {
    expect(err('$100 in 1900 in todays dollars')).toMatch(/starts in 1913.*1913–2024/);
    expect(err('inflation from 2000 to 2025')).toMatch(/no 2025 annual average/);
    expect(err('$100 in 1990 worth in 2090')).toMatch(/2090 is in the future/);
    expect(err('inflation in 1913')).toMatch(/first year/);
    expect(err('£100 in 1990 in todays money')).toMatch(/Only US inflation/);
  });

  it('leaves other questions alone', () => {
    for (const q of ['100 usd to eur', '$100 at 5% for 10 years', 'days until 2027', '20% of 450']) expect(answerInflation(q)).toBeNull();
  });
});
