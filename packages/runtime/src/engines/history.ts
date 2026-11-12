// Dated-data engines as one lazily loaded chunk: inflation (bundled CPI table) and historical exchange rates.
import { HistoricalRates, type DateResolver } from '@lemma/currency-engine';
import { iso, parseDate, systemContext } from '@lemma/date-engine';

export { answerInflation, LOOKS_LIKE_INFLATION } from '@lemma/econ-engine';
export { HistoricalRates };

const storage = (() => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
})();

/** One cache per runtime chunk: past rates never change, so every surface can share them. */
export const fxHistory = new HistoricalRates({ storage });

/** Resolves "2015-03-01", "march 1 2015", "last christmas", "yesterday" with the user's date order. */
export const resolveDate: DateResolver = (text) => {
  const ctx = systemContext();
  const d = parseDate(text.replace(/^(?:on|the) /, ''), { today: ctx.now.toPlainDate(), dateOrder: ctx.dateOrder }, 'past');
  return d ? { iso: iso(d.date), notes: d.notes } : null;
};
