/** Extension-wide constants. Change the app URL here when the real site is live. */
export const APP_URL = 'https://lemma.app';

/**
 * On-device OCR (tesseract.js 5). The worker script and the WebAssembly core ship inside the extension
 * (MV3 forbids remote code). The English language data is data, not code: if the build found
 * vendor/eng.traineddata.gz it is bundled at ocr/lang/ and OCR works offline from the first use; otherwise
 * it is downloaded once from this pinned CDN path and cached in the extension's own IndexedDB.
 */
export const OCR_LANG_CDN = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int';
export const OCR_WORKER_PATH = 'ocr/worker.min.js';
export const OCR_CORE_PATH = 'ocr/core/';
export const OCR_BUNDLED_LANG_PATH = 'ocr/lang';

/** How many calculator results the popup and side panel keep. */
export const HISTORY_LIMIT = 50;
