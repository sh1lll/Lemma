/**
 * Cheap pre-check for answerReference: true for every phrasing it accepts (and some it then rejects).
 * No data imports, no lookbehind, only literal alternations, so it is safe to copy into the main bundle's router.
 */
export const MAYBE_REFERENCE =
  /\b(?:densit|dense|melting|boiling|freezing|sublim|atomic|molar|molecular|formula|electronegativ|electron|proton|symbol|group|period|block|category|state of|phase|discover|propert|facts|population|people|capital|gdp|gross domestic|economy|area|size|how big|how large|calori|kcal|energy|protein|fat|carb|fib(?:er|re)|sugar|nutri|macros|distance|how far|radius|diameter|mass|weight|heavy|massive|gravit|temperature|how hot|how cold|orbit|year|day|rotation|moons|escape velocity|golden|euler|mascheroni|napier|catalan|ap[eé]ry|feigenbaum|pythagoras|theodorus|archimedes|digits|value of|prime|fibonacci|squares|square numbers|cubes|cube numbers|triangular|triangle numbers|factorials|powers of|fine.structure|bohr|dalton|wien)/i;
