import { describe, expect, it } from 'vitest';
import { answerDate, holidaysIn, parseDate, Temporal, type CountryCode, type DateEngineContext } from '../src';

// Thursday 29 October 2026, 7:00 pm in New York.
const ctx: DateEngineContext = { now: Temporal.ZonedDateTime.from('2026-10-29T19:00[America/New_York]'), dateOrder: 'mdy', locale: 'en-US' };

function ask(input: string) {
  const r = answerDate(input, ctx);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r;
}
const dates = (c: CountryCode, y: number) => holidaysIn(c, y).map((h) => h.date.toString().slice(5));

// Published calendars: OPM (US), gov.uk (UK), Cabinet Office (Japan), Bundesministerium des Innern (DE), service-public.fr (FR)…
describe('holiday calendars', () => {
  it('US federal 2026 and 2027 (OPM), with observed days', () => {
    expect(dates('US', 2026)).toEqual(['01-01', '01-19', '02-16', '05-25', '06-19', '07-03', '09-07', '10-12', '11-11', '11-26', '12-25']);
    // Juneteenth (Sat) → Fri 18th, July 4 (Sun) → Mon 5th, Christmas (Sat) → Fri 24th, New Year 2028 (Sat) → Fri 31 Dec.
    expect(dates('US', 2027)).toEqual(['01-01', '01-18', '02-15', '05-31', '06-18', '07-05', '09-06', '10-11', '11-11', '11-25', '12-24', '12-31']);
  });

  it('England & Wales and Scotland (gov.uk), with substitute days and one-offs', () => {
    expect(dates('GB-EAW', 2026)).toEqual(['01-01', '04-03', '04-06', '05-04', '05-25', '08-31', '12-25', '12-28']);
    expect(dates('GB-SCT', 2026)).toEqual(['01-01', '01-02', '04-03', '05-04', '05-25', '08-03', '11-30', '12-25', '12-28']);
    expect(dates('GB-EAW', 2022)).toEqual(['01-03', '04-15', '04-18', '05-02', '06-02', '06-03', '08-29', '09-19', '12-26', '12-27']);
    expect(dates('GB-SCT', 2022)).toEqual(['01-03', '01-04', '04-15', '05-02', '06-02', '06-03', '08-01', '09-19', '11-30', '12-26', '12-27']);
    expect(dates('GB-EAW', 2021)).toEqual(['01-01', '04-02', '04-05', '05-03', '05-31', '08-30', '12-27', '12-28']);
    expect(dates('GB-EAW', 2020)).toContain('05-08');
  });

  it('Japan 2026 and 2019 (Cabinet Office), with substitute and citizens’ holidays', () => {
    expect(dates('JP', 2026)).toEqual(['01-01', '01-12', '02-11', '02-23', '03-20', '04-29', '05-03', '05-04', '05-05', '05-06', '07-20', '08-11', '09-21', '09-22', '09-23', '10-12', '11-03', '11-23']);
    const gw = dates('JP', 2019).filter((d) => d >= '04-27' && d <= '05-06');
    expect(gw).toEqual(['04-29', '04-30', '05-01', '05-02', '05-03', '05-04', '05-05', '05-06']);
    expect(dates('JP', 2021)).toEqual(expect.arrayContaining(['07-22', '07-23', '08-08', '08-09']));
    expect(dates('JP', 2025)).toEqual(['01-01', '01-13', '02-11', '02-23', '02-24', '03-20', '04-29', '05-03', '05-04', '05-05', '05-06', '07-21', '08-11', '09-15', '09-23', '10-13', '11-03', '11-23', '11-24']);
  });

  it('Germany, France, Canada, Australia, Mexico, Brazil, India (2026)', () => {
    expect(dates('DE', 2026)).toEqual(['01-01', '04-03', '04-06', '05-01', '05-14', '05-25', '10-03', '12-25', '12-26']);
    expect(dates('FR', 2026)).toEqual(['01-01', '04-06', '05-01', '05-08', '05-14', '05-25', '07-14', '08-15', '11-01', '11-11', '12-25']);
    expect(dates('CA', 2026)).toEqual(['01-01', '04-03', '05-18', '07-01', '09-07', '09-30', '10-12', '11-11', '12-25', '12-28']);
    expect(dates('AU', 2026)).toEqual(['01-01', '01-26', '04-03', '04-06', '04-25', '12-25', '12-28']);
    expect(dates('MX', 2026)).toEqual(['01-01', '02-02', '03-16', '05-01', '09-16', '11-16', '12-25']);
    expect(dates('MX', 2024)).toContain('10-01');
    expect(dates('BR', 2026)).toEqual(['01-01', '04-03', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']);
    expect(dates('BR', 2023)).not.toContain('11-20');
    expect(dates('IN', 2026)).toEqual(['01-26', '08-15', '10-02']);
    expect(dates('DE', 2017)).toContain('10-31');
  });
});

describe('holiday questions', () => {
  it('lists a year for a country', () => {
    const r = ask('holidays in 2026 in the UK');
    expect(r.primary.display).toBe('8 bank holidays');
    expect(r.table?.rows[0]).toEqual(['Thu, Jan 1', "New Year's Day"]);
    expect(r.table?.rows[7]).toEqual(['Mon, Dec 28', 'Boxing Day (substitute day) · falls on Sat, Dec 26']);
    expect(r.notes.join(' ')).toMatch(/England & Wales is shown/);
    expect(ask('uk bank holidays 2026').primary.display).toBe('8 bank holidays');
    expect(ask('public holidays in japan').primary.display).toBe('18 national holidays');
    expect(ask('bank holidays in scotland next year').expression).toBe('Bank holidays in Scotland, 2027');
    expect(ask('what are the federal holidays this year').primary.display).toBe('11 federal holidays');
    expect(ask('holidays in india 2026').notes.join(' ')).toMatch(/lunar.*not included/);
  });

  it('checks a date (US by default), explaining observed days', () => {
    const r = ask('is July 4 2027 a holiday');
    expect(r.primary.display).toBe('Yes · Independence Day, observed Mon, Jul 5');
    expect(r.lines).toContainEqual({ label: 'Day off (observed)', display: 'Monday, July 5, 2027' });
    expect(ask('is july 5 2027 a holiday').primary.display).toBe('Yes · Independence Day (observed)');
    expect(ask('is christmas a holiday in japan').primary.display).toBe('No');
    expect(ask('is 2026-12-28 a bank holiday in the uk').primary.display).toBe('Yes · Boxing Day (substitute day)');
    expect(ask('is may 6 2026 a holiday in japan').primary.display).toMatch(/^Yes · 振替休日/);
    expect(ask('is nov 20 2026 a holiday in brazil').primary.display).toMatch(/Consciência Negra/);
    expect(ask('is nov 12 2026 a holiday').primary.display).toBe('No');
    expect(ask('is boxing day a holiday in canada').primary.display).toBe('Yes · Boxing Day, observed Mon, Dec 28');
    expect(ask('is good friday 2027 a bank holiday in the uk').primary.display).toBe('Yes · Good Friday');
    expect(ask('is juneteenth 2027 a holiday').primary.display).toBe('Yes · Juneteenth National Independence Day, observed Fri, Jun 18');
  });

  it('next holiday', () => {
    expect(ask('next holiday').primary.display).toBe('Veterans Day · Wed, Nov 11');
    expect(ask('when is the next bank holiday in the uk').primary.display).toBe('Christmas Day · Fri, Dec 25');
    expect(ask('next public holiday in germany').primary.display).toMatch(/Weihnachtstag \(Christmas Day\) · Fri, Dec 25/);
  });

  it('business days skip a country’s holidays when one is named', () => {
    expect(ask('business days until christmas').primary.display).toBe('41 business days');
    expect(ask('business days until christmas').lines).toContainEqual({ label: 'Excluding US federal holidays', display: '38 business days' });
    const de = ask('business days until Christmas in Germany');
    expect(de.primary.display).toBe('40 business days');
    expect(de.notes.join(' ')).toMatch(/excluding nationwide public holidays in Germany/);
    expect(ask('business days until christmas in the us').primary.display).toBe('38 business days');
    expect(ask('working days between dec 20 and jan 10 in the uk').primary.display).toBe('12 business days');
    expect(ask('10 business days from today in japan').primary.display).toBe('Friday, November 13, 2026');
    expect(ask('10 business days from today').primary.display).toBe('Thursday, November 12, 2026');
  });

  it('parses last/next holiday names', () => {
    const c = { today: Temporal.PlainDate.from('2026-10-29'), dateOrder: 'mdy' as const };
    expect(parseDate('last christmas', c)?.date.toString()).toBe('2025-12-25');
    expect(parseDate('next easter', c)?.date.toString()).toBe('2027-03-28');
    expect(parseDate('last halloween', c)?.date.toString()).toBe('2025-10-31');
  });

  it('refuses years outside the rules', () => {
    const r = answerDate('holidays in japan 1990', ctx);
    expect(r && !r.ok && r.error.message).toMatch(/2000–2099/);
  });
});
