/**
 * Motion: one easing curve and three durations (the same values as --ease and --dur-1/2/3 in style.css), and
 * nothing but transform and opacity. <html data-anim="answers panels …"> lists the groups that may move: it is
 * empty under Calm (and under reduced motion by default), so every CSS rule and every helper here falls back to
 * an instant change. Nothing waits on an animation: state changes first, the motion follows.
 */

export type MotionGroup = 'answers' | 'panels' | 'content' | 'feedback' | 'press' | 'mic';
export const MOTION_GROUPS: MotionGroup[] = ['answers', 'panels', 'content', 'feedback', 'press', 'mic'];

export const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
export const D1 = 120;
export const D2 = 180;
export const D3 = 240;

export const moves = (g: MotionGroup): boolean => (document.documentElement.dataset.anim ?? '').split(' ').includes(g);

/** Element.animate when the group may move; null (and nothing happens) otherwise. */
export function play(el: Element, frames: Keyframe[], duration: number, group: MotionGroup, opts: KeyframeAnimationOptions = {}): Animation | null {
  if (!moves(group) || !el.animate) return null;
  try {
    return el.animate(frames, { duration, easing: EASE, ...opts });
  } catch {
    return null; // e.g. a pseudo-element target this engine can't animate
  }
}

/** Folds a `.fold` box open or shut (grid rows 0fr ↔ 1fr with a fade); it's `hidden` once shut. */
const folds = new WeakMap<HTMLElement, { a: Animation; open: boolean }>();

export function fold(box: HTMLElement, open: boolean, group: MotionGroup = 'answers'): void {
  const running = folds.get(box);
  const settle = (a: Animation, to: boolean) => {
    a.onfinish = () => {
      folds.delete(box);
      box.classList.remove('folding');
      box.hidden = !to;
    };
  };
  // Turned around halfway: run the same motion back from where it is, rather than jumping to the far end first.
  if (running && running.a.playState === 'running') {
    if (running.open === open) return;
    running.a.reverse();
    running.open = open;
    return settle(running.a, open);
  }
  for (const x of box.getAnimations()) x.cancel();
  box.hidden = false;
  const a = play(box, [{ gridTemplateRows: open ? '0fr' : '1fr', opacity: +!open }, { gridTemplateRows: open ? '1fr' : '0fr', opacity: +open }], D2, group);
  if (!a) return void (box.hidden = !open);
  box.classList.add('folding');
  folds.set(box, { a, open });
  settle(a, open);
  a.oncancel = () => {
    folds.delete(box);
    box.classList.remove('folding');
  };
}

/** Where each `[data-id]` child of a list sits now, so `glide` can move them to where a re-render puts them. */
export function snapshot(list: HTMLElement): Map<string, number> | null {
  if (!moves('answers')) return null;
  const at = new Map<string, number>();
  for (const li of list.children as HTMLCollectionOf<HTMLElement>) if (li.dataset.id) at.set(li.dataset.id, li.getBoundingClientRect().top);
  return at;
}

/** FLIP: items that moved glide from their old place; new ones slide in from above. */
export function glide(list: HTMLElement, before: Map<string, number> | null): void {
  if (!before) return;
  for (const li of list.children as HTMLCollectionOf<HTMLElement>) {
    const was = before.get(li.dataset.id ?? '');
    if (was === undefined) play(li, [{ transform: 'translateY(-8px)', opacity: 0 }, { transform: 'none', opacity: 1 }], D2, 'answers');
    else {
      const dy = was - li.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) play(li, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], D2, 'answers');
    }
  }
}

/** A small check that pops on the button just pressed (copied, pinned, saved). */
export function confirmPop(btn: HTMLElement): void {
  if (!moves('feedback')) return;
  const mark = document.createElement('span');
  mark.className = 'pop-check';
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg>';
  if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
  btn.append(mark);
  const a = play(mark, [{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'scale(1)', offset: 0.3 }, { opacity: 1, transform: 'scale(1)', offset: 0.7 }, { opacity: 0, transform: 'scale(1)' }], 280, 'feedback');
  if (a) a.finished.finally(() => mark.remove()).catch(() => undefined);
  else mark.remove();
}

/** Counts the first number in an element's text up from zero (a score, a streak). The text is final at the end. */
export function countUp(el: HTMLElement, group: MotionGroup = 'feedback'): void {
  const text = el.textContent ?? '';
  const m = /\d[\d.,]*/.exec(text);
  // Whole numbers only: "4.5" or "1,200" are shown as they are.
  if (!m || !/^\d+$/.test(m[0]) || +m[0] < 2 || !moves(group)) return;
  const to = +m[0];
  const show = (v: number) => (el.textContent = text.slice(0, m.index) + v + text.slice(m.index + m[0].length));
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / D3);
    show(Math.round(to * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  show(0);
  requestAnimationFrame(step);
}

/** Fades a full-screen view (exam, whiteboard) out and removes it. It stops taking input at once. */
export function leave(view: HTMLElement): void {
  view.inert = true;
  view.classList.add('leaving');
  const a = play(view, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.98)' }], D2, 'panels', { fill: 'forwards' });
  if (a) a.finished.finally(() => view.remove()).catch(() => undefined);
  else view.remove();
}

/** A placeholder with a soft shimmer, for a tool that needs a moment the first time. */
export function skeleton(lines = 3): HTMLElement {
  const s = document.createElement('div');
  s.className = 'skeleton';
  s.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < lines; i++) s.append(document.createElement('i'));
  return s;
}

type VTDoc = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void>; updateCallbackDone: Promise<void> } };
export const canTransition = (group: MotionGroup): boolean => !!(document as VTDoc).startViewTransition && moves(group);

/**
 * Runs `update` inside a view transition when the browser has them and the group may move (else at once);
 * resolves once the page has updated. `done` runs when the transition is over.
 */
export function viewTransition(update: () => void, group: MotionGroup, done?: () => void): Promise<void> {
  if (!canTransition(group)) {
    update();
    done?.();
    return Promise.resolve();
  }
  const t = (document as VTDoc).startViewTransition!(update);
  if (done) void t.finished.finally(done).catch(() => undefined);
  return t.updateCallbackDone.catch(() => undefined);
}

// ---------- dialogs ----------
const nativeClose = HTMLDialogElement.prototype.close;
const nativeShow = HTMLDialogElement.prototype.showModal;
const nativeShowPlain = HTMLDialogElement.prototype.show;

/**
 * <dialog>s play an exit instead of vanishing. close() (a close button, Escape, a `method="dialog"` form, any
 * code) really closes the dialog at once, so focus goes back and the page takes input straight away; then the
 * sheet is shown again as a still, non-modal picture (inert, `.closing`) that slides out (`--leave` in CSS says
 * where to) and goes. showModal() during the exit opens it for real.
 */
export function animateDialog(d: HTMLDialogElement): void {
  let exit: Animation | null = null;
  /** Where focus was when it opened: it goes back there (the browser's own restore can lose it to the copy). */
  let opener: Element | null = null;
  const settle = () => {
    exit?.cancel();
    exit = null;
    d.inert = false;
    d.classList.remove('closing');
    d.removeAttribute('closedby');
    // The copy goes without a second close event: the dialog closed (and said so) when asked.
    d.removeAttribute('open');
  };
  d.close = (value?: string) => {
    if (!d.open || exit) return;
    const had = d.contains(document.activeElement);
    nativeClose.call(d, value);
    if (!moves('panels')) return;
    const refocus = had || d.contains(document.activeElement);
    if (refocus) (document.activeElement as HTMLElement | null)?.blur();
    d.inert = true;
    d.classList.add('closing');
    // Chrome gives even a non-modal dialog a place in the Escape queue; this lets Escape reach it (and so the
    // 'cancel' handler below, which passes it on) instead of being swallowed.
    d.setAttribute('closedby', 'closerequest');
    nativeShowPlain.call(d);
    // After show(): showing the copy runs the dialog focusing steps, which would take focus off the opener again.
    if (refocus && opener instanceof HTMLElement && opener.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    const to = getComputedStyle(d).getPropertyValue('--leave').trim() || 'translateY(8px) scale(0.98)';
    const a = play(d, [{ transform: 'none', opacity: 1 }, { transform: to, opacity: 0 }], D2, 'panels', { fill: 'forwards' });
    if (!a) return settle();
    exit = a;
    a.onfinish = () => exit === a && settle();
    // Safari can drop the finish of an exit that starts while a view transition (a tool opening) is still running:
    // never leave the picture of a closed sheet on screen waiting for it.
    setTimeout(() => exit === a && settle(), D2 + 250);
  };
  let openedAt = 0;
  d.showModal = () => {
    if (exit) settle();
    if (d.open) return;
    opener = document.activeElement;
    openedAt = performance.now();
    nativeShow.call(d);
  };
  // The second click of a double-click (or a quick double tap) lands on the backdrop while the sheet is still
  // arriving: it shouldn't close what the first click just opened.
  d.addEventListener(
    'click',
    (e) => {
      if (e.target === d && performance.now() - openedAt < 350) e.stopImmediatePropagation();
    },
    { capture: true },
  );
  d.addEventListener('cancel', (e) => {
    if (!moves('panels')) return;
    e.preventDefault();
    if (!exit) return d.close('cancel');
    // The copy on its way out can still catch Escape: it belongs to the dialog underneath.
    [...document.querySelectorAll<HTMLDialogElement>('dialog')].filter((x) => x !== d && x.matches(':modal')).at(-1)?.close('cancel');
  });
  d.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    if (form.method !== 'dialog' || !moves('panels')) return;
    e.preventDefault();
    d.close((e.submitter as HTMLButtonElement | null)?.value ?? '');
  });
}
