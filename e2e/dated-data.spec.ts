import { ask, expect, test, value } from './helpers';

/** Inflation (bundled BLS CPI-U), public holidays (rule-based) and historical exchange rates (mocked Frankfurter). */
test('inflation adjustment with its source', async ({ app }) => {
  await ask(app, "$100 in 1990 in today's dollars");
  await expect(value(app)).toContainText('$240.01');
  await expect(app.locator('.source')).toContainText('BLS CPI-U');
  await expect(app.locator('.source')).toContainText('2024 annual average');
  await ask(app, 'inflation from 2000 to 2024');
  await expect(value(app)).toContainText('82.17%');
  await app.locator('#input').fill('$100 in 1900 in todays dollars');
  await app.locator('#input').press('Enter');
  await expect(app.locator('body')).toContainText('starts in 1913');
});

test('holiday calendars', async ({ app }) => {
  await ask(app, 'is July 4 2027 a holiday');
  await expect(value(app)).toContainText('Yes · Independence Day, observed Mon, Jul 5');
  await ask(app, 'holidays in 2026 in the UK');
  await expect(value(app)).toContainText('8 bank holidays');
  await expect(app.locator('table')).toContainText('Boxing Day (substitute day)');
  await ask(app, 'business days until christmas in germany');
  await expect(value(app)).toContainText('business days');
});

test('historical exchange rates: previous business day, cached per date, live-rates setting', async ({ app }) => {
  let calls = 0;
  await app.route('https://api.frankfurter.dev/v1/2015-03-01**', (r) => {
    calls++;
    return r.fulfill({ json: { amount: 1, base: 'EUR', date: '2015-02-27', rates: { USD: 1.124, GBP: 0.7273 } } });
  });
  await ask(app, '100 usd to eur on 2015-03-01');
  await expect(value(app)).toContainText('€88.97');
  await expect(app.locator('body')).toContainText('previous business day');
  await expect(app.locator('.source')).toContainText('2015-02-27');
  await ask(app, '100 usd to gbp on 2015-03-01');
  await expect(value(app)).toContainText('£64.71');
  expect(calls).toBe(1);

  await app.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('lemma.settings.v1') ?? '{}');
    localStorage.setItem('lemma.settings.v1', JSON.stringify({ ...s, liveRates: false }));
  });
  await app.reload();
  await app.locator('#input').fill('100 usd to eur on 2016-03-01');
  await app.locator('#input').press('Enter');
  await expect(app.locator('body')).toContainText('Live exchange rates are turned off');
});
