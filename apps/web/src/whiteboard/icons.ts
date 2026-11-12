// Quiet line icons (24×24 viewBox, currentColor). No emoji.
const P: Record<string, string> = {
  select: 'M6 3.5l12.5 7.2-5.6 1.4-2.4 5.4z',
  hand: 'M8 13V6a1.5 1.5 0 013 0v5m0-6.5a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v7.5a6.5 6.5 0 01-6.5 6.5h-.6a6 6 0 01-4.8-2.4l-2.6-3.6a1.5 1.5 0 012.4-1.8L8 13',
  pen: 'M4.5 19.5l3.8-.9L19 7.9a2 2 0 000-2.8l-.1-.1a2 2 0 00-2.8 0L5.4 15.7zM14.5 6.5l3 3',
  highlighter: 'M4 20h7M7.5 16.5l-1-1 9.8-9.8a2 2 0 012.8 0l.2.2a2 2 0 010 2.8L9.5 18.5zM7 16l-2 2.5h3',
  eraser: 'M9 20h11M5.2 15.8l8.9-8.9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 19H8.4zM9.5 11.5l5 5',
  text: 'M5 7V5h14v2M12 5v14M9 19h6',
  rect: 'M6.5 6h11A2.5 2.5 0 0120 8.5v7a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 15.5v-7A2.5 2.5 0 016.5 6z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L19 5M10 5h9v9',
  more: 'M7 10l5 5 5-5',
  triangle: 'M12 5l8 14H4z',
  numberline: 'M3 12h18M6 9v6M12 9v6M18 9v6',
  axes: 'M6 4v14h14M6 4L4 7M6 4l2 3M20 18l-3-2M20 18l-3 2',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  minus: 'M6 12h12',
  plus: 'M12 6v12M6 12h12',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  export: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14',
  boards: 'M4 6h16M4 12h16M4 18h10',
  mic: 'M12 3.5a3 3 0 013 3V12a3 3 0 01-6 0V6.5a3 3 0 013-3zM5.5 11.5a6.5 6.5 0 0013 0M12 18v2.5',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
};

export function icon(name: keyof typeof P | string): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] ?? ''}"/></svg>`;
}
