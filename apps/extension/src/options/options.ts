import { STYLES, type StyleId } from '@lemma/tutor-engine';
import { OCR_BUNDLED_LANG_PATH, OCR_LANG_CDN } from '../config';
import { normalizeDomain, saveSettings, type Settings } from '../core/settings';
import { $, h } from '../ui/dom';
import { initTheme } from '../ui/theme';

let s: Settings = await initTheme();
const saved = $('#saved');

async function save(patch: Partial<Settings>) {
  s = { ...s, ...patch };
  await saveSettings(patch);
  saved.textContent = 'Saved.';
}

for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
  r.checked = r.value === s.mode;
  r.addEventListener('change', () => r.checked && void save({ mode: r.value as Settings['mode'] }));
}

const style = $('#style') as HTMLSelectElement;
const blurb = $('#style-blurb');
for (const st of STYLES) style.append(h('option', { value: st.id }, st.label));
style.value = s.tutorStyle;
const showBlurb = () => (blurb.textContent = STYLES.find((x) => x.id === style.value)?.blurb ?? '');
showBlurb();
style.addEventListener('change', () => {
  showBlurb();
  void save({ tutorStyle: style.value as StyleId });
});

const lf = $('#learning-first') as HTMLInputElement;
lf.checked = s.learningFirst;
lf.addEventListener('change', () => void save({ learningFirst: lf.checked }));

const theme = $('#theme') as HTMLSelectElement;
theme.value = s.theme;
theme.addEventListener('change', () => void save({ theme: theme.value as Settings['theme'] }));

const list = $('#domains');
const domainInput = $('#domain') as HTMLInputElement;
const domainError = $('#domain-error');
function drawDomains() {
  list.replaceChildren(
    ...s.assessmentDomains.map((d) =>
      h(
        'li',
        { class: 'row', style: 'justify-content:space-between' },
        h('span', {}, d),
        h('button', { class: 'btn', type: 'button', 'aria-label': `Remove ${d}`, onclick: () => void save({ assessmentDomains: s.assessmentDomains.filter((x) => x !== d) }).then(drawDomains) }, 'Remove'),
      ),
    ),
  );
  if (!s.assessmentDomains.length) list.append(h('li', { class: 'muted' }, 'None yet. Add the sites where you take graded tests or quizzes.'));
}
drawDomains();
$('#add-domain').addEventListener('submit', (e) => {
  e.preventDefault();
  const d = normalizeDomain(domainInput.value);
  if (!d) {
    domainError.textContent = 'That does not look like a site name. Try something like quiz.example.edu.';
    return;
  }
  domainError.textContent = '';
  domainInput.value = '';
  if (!s.assessmentDomains.includes(d)) void save({ assessmentDomains: [...s.assessmentDomains, d] }).then(drawDomains);
});

void fetch(chrome.runtime.getURL(`${OCR_BUNDLED_LANG_PATH}/eng.traineddata.gz`), { method: 'HEAD' })
  .then((r) => r.ok)
  .catch(() => false)
  .then((bundled) => {
    $('#ocr-note').textContent = bundled
      ? 'Text recognition runs on this device with tesseract.js. English recognition data is included in the extension, so it works offline. Other languages are not available yet; handwriting and complex layouts may be misread, which is why you always get to edit the text before solving.'
      : `Text recognition runs on this device with tesseract.js. The first time you use it, the English recognition data (about 3 MB) is downloaded once from ${OCR_LANG_CDN} and stored in the extension; after that it works offline. Only that data file is requested: your screenshot never leaves the device. Other languages are not available yet, and you always get to edit the text before solving.`;
  });
