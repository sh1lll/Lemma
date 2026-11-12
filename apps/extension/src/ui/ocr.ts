import { cleanOcr } from './ocr-clean';
import { OCR_BUNDLED_LANG_PATH, OCR_CORE_PATH, OCR_LANG_CDN, OCR_WORKER_PATH } from '../config';

type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
export type OcrProgress = (status: string, progress: number) => void;

let worker: Promise<OcrWorker> | null = null;
let progressCb: OcrProgress = () => {};

/** True when the build bundled eng.traineddata.gz (see config.ts); then OCR never touches the network. */
async function bundledLang(): Promise<boolean> {
  try {
    const r = await fetch(chrome.runtime.getURL(`${OCR_BUNDLED_LANG_PATH}/eng.traineddata.gz`), { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

function getWorker(): Promise<OcrWorker> {
  worker ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const local = await bundledLang();
    return createWorker('eng', 1, {
      // Worker script and WebAssembly core come from the extension package (MV3 allows no remote code).
      workerPath: chrome.runtime.getURL(OCR_WORKER_PATH),
      corePath: chrome.runtime.getURL(OCR_CORE_PATH),
      workerBlobURL: false,
      langPath: local ? chrome.runtime.getURL(OCR_BUNDLED_LANG_PATH) : OCR_LANG_CDN,
      // Downloaded data is cached in this extension's IndexedDB, so the CDN is contacted at most once.
      cacheMethod: local ? 'none' : 'write',
      logger: (m: { status: string; progress: number }) => progressCb(m.status, m.progress),
    });
  })().catch((e: unknown) => {
    worker = null;
    throw e;
  });
  return worker;
}

export { cleanOcr };

/** Reads text from an image on this device with tesseract.js. */
export async function recognize(image: string, onProgress: OcrProgress = () => {}): Promise<string> {
  progressCb = onProgress;
  const w = await getWorker();
  await w.setParameters({ tessedit_pageseg_mode: '6' as never, preserve_interword_spaces: '1' });
  const { data } = await w.recognize(image);
  return cleanOcr(data.text);
}
