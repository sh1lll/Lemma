/**
 * US Consumer Price Index for All Urban Consumers (CPI-U), U.S. city average, all items, not seasonally
 * adjusted, annual averages, 1982–84 = 100. BLS series CUUR0000SA0. US government work (public domain).
 *
 * Values are as published by BLS: one decimal place through 2006, three from 2007 (when BLS started
 * publishing the index to three decimals). Nothing here is estimated or interpolated; a year that isn't
 * in the table is refused rather than guessed.
 */
export const US_CPI = {
  name: 'US BLS CPI-U (U.S. city average, all items, annual average, 1982–84 = 100)',
  series: 'CUUR0000SA0',
  url: 'https://www.bls.gov/cpi/',
  first: 1913,
  // prettier-ignore
  values: [
    // 1913–1919
    9.9, 10.0, 10.1, 10.9, 12.8, 15.1, 17.3,
    // 1920s
    20.0, 17.9, 16.8, 17.1, 17.1, 17.5, 17.7, 17.4, 17.1, 17.1,
    // 1930s
    16.7, 15.2, 13.7, 13.0, 13.4, 13.7, 13.9, 14.4, 14.1, 13.9,
    // 1940s
    14.0, 14.7, 16.3, 17.3, 17.6, 18.0, 19.5, 22.3, 24.1, 23.8,
    // 1950s
    24.1, 26.0, 26.5, 26.7, 26.9, 26.8, 27.2, 28.1, 28.9, 29.1,
    // 1960s
    29.6, 29.9, 30.2, 30.6, 31.0, 31.5, 32.4, 33.4, 34.8, 36.7,
    // 1970s
    38.8, 40.5, 41.8, 44.4, 49.3, 53.8, 56.9, 60.6, 65.2, 72.6,
    // 1980s
    82.4, 90.9, 96.5, 99.6, 103.9, 107.6, 109.6, 113.6, 118.3, 124.0,
    // 1990s
    130.7, 136.2, 140.3, 144.5, 148.2, 152.4, 156.9, 160.5, 163.0, 166.6,
    // 2000s
    172.2, 177.1, 179.9, 184.0, 188.9, 195.3, 201.6, 207.342, 215.303, 214.537,
    // 2010s
    218.056, 224.939, 229.594, 232.957, 236.736, 237.017, 240.007, 245.120, 251.107, 255.657,
    // 2020s
    258.811, 270.970, 292.655, 304.702, 313.689,
  ] as readonly number[],
};

export const US_CPI_LAST = US_CPI.first + US_CPI.values.length - 1;

/** The annual-average index for a year, or undefined outside the table. */
export function cpi(year: number): number | undefined {
  if (!Number.isInteger(year)) return undefined;
  return US_CPI.values[year - US_CPI.first];
}
