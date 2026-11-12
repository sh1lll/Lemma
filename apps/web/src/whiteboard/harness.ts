// Dev-only harness, loaded by apps/web/whiteboard-harness.html (`npx vite apps/web`, then /whiteboard-harness.html).
// Not imported by the app. `?board=<id>` opens a specific board.
import '../style.css';
import { createWhiteboard } from './engine';

const log = { commands: [] as string[], mics: 0, closed: 0 };
const params = new URLSearchParams(location.search);

const board = await createWhiteboard(document.getElementById('board')!, {
  onCommand: (text) => {
    log.commands.push(text);
    board.status(`Command: ${text}`);
  },
  onMic: () => {
    log.mics++;
    board.setListening(log.mics % 2 === 1);
  },
  onClose: () => {
    log.closed++;
  },
  ...(params.get('board') ? { boardId: params.get('board')! } : {}),
});

document.getElementById('theme')!.addEventListener('click', () => {
  const r = document.documentElement;
  r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
});

// Exposed for e2e tests.
Object.assign(window, { wb: board, wbLog: log });
document.documentElement.dataset.wbReady = '1';
