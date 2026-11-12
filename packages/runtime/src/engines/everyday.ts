// Everyday engines (dates, finance & shopping, currency) as one lazily loaded chunk.
export { answerDate, systemContext, LOOKS_LIKE_DATE } from '@lemma/date-engine';
export { answerFinance, LOOKS_LIKE_FINANCE } from '@lemma/finance-engine';
export { answerCurrency, fetchRates, LOOKS_LIKE_CURRENCY, type RatesSnapshot } from '@lemma/currency-engine';
export { answerProductivity, type ProductivityAction } from '@lemma/productivity-engine';
