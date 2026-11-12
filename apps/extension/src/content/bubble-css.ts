/** Styles for the in-page bubble, badge and region overlay. They live inside shadow roots, so pages can't restyle them. */
export const TOKENS = `
:host { all: initial; }
:host {
  --bg: #f2f0eb; --surface: #fbfaf7; --surface-2: #e9e6df; --ink: #2a2926; --muted: #68655e; --line: #e0ddd5;
  --accent: #467058; --accent-ink: #f4fbf6; --accent-soft: #e3ebe4; --warn: #a4521f;
  --sans: ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #1b1d1c; --surface: #242725; --surface-2: #2d302e; --ink: #ecebe6; --muted: #a3a59f; --line: #333735;
    --accent: #9cc5a8; --accent-ink: #14231a; --accent-soft: #2b3a30; --warn: #f0a875;
    color-scheme: dark;
  }
}
`;

export const BUBBLE_CSS = `${TOKENS}
.bubble {
  position: absolute; z-index: 2147483646; width: min(360px, calc(100vw - 24px)); box-sizing: border-box;
  background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0,0,0,.16), 0 2px 6px rgba(0,0,0,.08);
  font: 14px/1.45 var(--sans); padding: 12px 14px 12px; text-align: left;
}
.bubble * { box-sizing: border-box; }
.head { cursor: move; user-select: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.title { font-size: 12px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin: 0; }
.close { border: 0; background: transparent; color: var(--muted); width: 28px; height: 28px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 18px; line-height: 1; }
.close:hover { background: var(--surface-2); color: var(--ink); }
.query { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; margin: 0 0 4px; }
.answer { font-size: 20px; font-weight: 650; overflow-wrap: anywhere; margin: 2px 0 6px; }
.answer math { font-size: 1.05em; }
.error { color: var(--muted); margin: 4px 0; }
.hint { background: var(--accent-soft); border-radius: 9px; padding: 8px 10px; margin: 6px 0; }
ol.steps { margin: 6px 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow: auto; }
ol.steps li { border-left: 3px solid var(--accent-soft); padding-left: 8px; }
ol.steps .m { margin-top: 2px; overflow-x: auto; }
.notes { color: var(--muted); font-size: 12px; margin: 4px 0; }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
button.b { appearance: none; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 9px; padding: 6px 10px; font: inherit; font-size: 13px; font-weight: 550; cursor: pointer; }
button.b:hover { background: var(--surface-2); }
button.b.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
button.b:disabled { opacity: .55; cursor: not-allowed; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.fill { border-top: 1px solid var(--line); margin-top: 10px; padding-top: 8px; }
.status { color: var(--muted); font-size: 12px; margin: 4px 0 0; min-height: 1em; }
svg.graph { display: block; width: 100%; height: auto; background: var(--bg); border-radius: 9px; margin: 6px 0; }
.toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; background: var(--surface); color: var(--ink);
  border: 1px solid var(--accent); border-radius: 12px; padding: 8px 14px; font: 14px/1.4 var(--sans); box-shadow: 0 6px 18px rgba(0,0,0,.18); pointer-events: none; }
.toast[hidden], [hidden] { display: none !important; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

export const BADGE_CSS = `${TOKENS}
.badge { position: absolute; z-index: 2147483645; width: 18px; height: 18px; border-radius: 50%; background: var(--accent); color: var(--accent-ink);
  display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,.2); pointer-events: none; }
.badge svg { width: 12px; height: 12px; }
`;

export const OVERLAY_CSS = `${TOKENS}
.overlay { position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; background: rgba(20, 22, 21, .28); }
.tip { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: var(--surface); color: var(--ink); border: 1px solid var(--line);
  border-radius: 12px; padding: 8px 14px; font: 14px/1.4 var(--sans); box-shadow: 0 6px 18px rgba(0,0,0,.18); pointer-events: none; }
.rect { position: fixed; border: 2px solid var(--accent); background: rgba(255,255,255,.12); box-shadow: 0 0 0 9999px rgba(20,22,21,.18); border-radius: 4px; display: none; }
`;
