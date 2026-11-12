import { BoardCommands } from './commands';
import { createWhiteboard, type Board } from './engine';
import { leave } from '../motion';

/**
 * The whiteboard as a full-screen view, with voice: while the mic is on it keeps listening, shows what it hears
 * in the command bar, and carries out each finished phrase on the board ("solve 2x + 3 = 11 and circle the
 * answer", "graph sin x", "undo"). "Stop listening" or the mic button ends it.
 */
export interface WhiteboardHost {
  /** Starts continuous recognition; returns a function that stops it. */
  listen(h: { onPartial(text: string): void; onFinal(text: string): void; onEnd(): void; onError(message: string): void }): () => void;
  voiceSupported: boolean;
  toast(message: string): void;
  /** The app's angle mode, read at each calculation so the board answers like the calculator ("sin(pi/2)" in RAD). */
  angle?(): 'deg' | 'rad';
  /** Start listening as soon as the board opens (it was opened hands-free, by voice or with the mic on). */
  listening?: boolean;
  /**
   * Called after the board closes, once focus is back where it was when the board opened (if that still exists).
   * `wasListening`: the board's mic was on, so the host can carry on listening.
   */
  onClosed?(wasListening: boolean): void;
}

let open: { board: Board; view: HTMLElement; stop: (() => void) | null } | null = null;
/** Set while a board is being opened, so a second request (double click, "open the whiteboard" twice) joins it. */
let opening: Promise<void> | null = null;

export function openWhiteboard(host: WhiteboardHost): Promise<void> {
  if (open) return Promise.resolve();
  opening ??= openNow(host).finally(() => {
    opening = null;
  });
  return opening;
}

async function openNow(host: WhiteboardHost): Promise<void> {
  // Focus goes back here on close: the exam's "Open whiteboard" button, a Study row, the calculator input.
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const view = document.createElement('div');
  view.className = 'wb-view';
  view.setAttribute('role', 'application');
  view.setAttribute('aria-label', 'Whiteboard');
  document.body.append(view);
  document.documentElement.classList.add('wb-open');
  // Whatever is behind (the app, or an exam in progress) stays out of focus while the board is open.
  const behind = [...document.body.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c !== view && !c.inert);
  behind.forEach((c) => (c.inert = true));
  const release = () => behind.forEach((c) => (c.inert = false));

  const { createSession } = await import('@lemma/math-core');
  const session = createSession();
  const { toTex } = await import('../notes');

  let commands: BoardCommands;
  const state: { board: Board; view: HTMLElement; stop: (() => void) | null } = { board: null as unknown as Board, view, stop: null };

  // One command at a time, in the order said: "solve 2x + 3 = 11" then "circle it" must circle that answer,
  // even though solving is still typesetting when the second phrase arrives.
  // "Stop" and "close" act at once; they don't wait behind a command still running.
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  const run = (text: string): Promise<void> => {
    // "Okay, stop listening" stops too: leading filler doesn't hide the instruction.
    const t = text.trim().replace(/^(?:(?:ok(?:ay)?|alright|so|now|um+|uh+)[\s,]+)+/i, '');
    if (!t) return queue;
    if (/^(?:stop(?: listening)?|that'?s all|i'?m done)\.?$/i.test(t)) return stopVoice(), queue;
    if (/^(?:close|exit|leave)(?: the)? (?:whiteboard|board)\.?$/i.test(t)) return close(), queue;
    return (queue = queue.then(() => runNow(t)));
  };
  const runNow = async (t: string) => {
    if (closed) return;
    state.board.setCommandText(t);
    try {
      const said = await commands.run(t);
      if (said) state.board.status(said);
    } catch (e) {
      state.board.status(e instanceof Error ? e.message : String(e));
    }
    state.board.setCommandText('');
  };

  const stopVoice = () => {
    state.stop?.();
    state.stop = null;
    state.board.setListening(false);
    state.board.status('Stopped listening');
  };

  const startVoice = () => {
    if (!host.voiceSupported) return state.board.status('Voice isn’t available in this browser. Type instead.');
    state.board.setListening(true);
    state.board.status('Listening. Try “solve 2x + 3 = 11 and circle the answer”');
    state.stop = host.listen({
      onPartial: (text) => state.board.setCommandText(text),
      onFinal: (text) => void run(text),
      onEnd: () => {
        state.stop = null;
        state.board.setListening(false);
      },
      onError: (message) => {
        state.stop = null;
        state.board.setListening(false);
        state.board.status(message);
      },
    });
  };

  const close = () => {
    if (!open || closed) return;
    closed = true;
    const wasListening = !!state.stop;
    state.stop?.();
    state.board.destroy();
    leave(view);
    document.documentElement.classList.remove('wb-open');
    release();
    open = null;
    if (opener?.isConnected && !opener.closest('[inert]')) opener.focus();
    host.onClosed?.(wasListening);
  };

  try {
    state.board = await createWhiteboard(view, {
      onCommand: (text) => void run(text),
      onMic: () => (state.stop ? stopVoice() : startVoice()),
      onClose: close,
    });
  } catch (e) {
    view.remove();
    document.documentElement.classList.remove('wb-open');
    release();
    host.toast(`Couldn’t open the whiteboard: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  // Keyboard and screen-reader focus moves onto the board (its canvas takes the drawing shortcuts).
  if (!view.contains(document.activeElement)) view.querySelector<HTMLElement>('canvas[tabindex]')?.focus({ preventScroll: true });

  commands = new BoardCommands(state.board, {
    worked: async (q) => (await import('@lemma/practice-engine')).worked(q),
    compute: async (q) => {
      const { runtime } = await import('../engine');
      const { outcomeToJSON } = await import('@lemma/runtime');
      if (host.angle) session.angle = host.angle();
      const o = outcomeToJSON(await runtime.compute(q, session), q);
      if (!o.ok) return { ok: false, message: o.error?.message ?? 'Lemma couldn’t work that out' };
      if (o.kind === 'calc' && o.value) {
        const { D } = await import('@lemma/math-core');
        session.ans = new D(o.value);
      }
      return { ok: true, display: `${o.display ?? ''}${o.unit ? ` ${o.unit}` : ''}`.trim() };
    },
    toTex,
  });
  open = state;
  if (host.listening) startVoice();
}

/** For tests and the desktop app: the open board, if any. */
export const currentBoard = (): Board | null => open?.board ?? null;
