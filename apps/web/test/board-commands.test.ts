import { describe, expect, it } from 'vitest';
import { worked } from '@lemma/practice-engine';
import { createLemma } from '@lemma/sdk';
import { BoardCommands } from '../src/whiteboard/commands';
import { toTex } from '../src/notes';
import type { Board, ObjId, Point, Rect } from '../src/whiteboard/engine';

/** A board that records what was put on it, with simple stacked layout. */
function fakeBoard() {
  const objs = new Map<ObjId, { kind: string; content: string; rect: Rect; style?: string; target?: ObjId; color?: string; xRange?: [number, number] }>();
  const order: ObjId[] = [];
  let n = 0;
  let y = 0;
  let selected: ObjId[] = [];
  const add = (kind: string, content: string, at?: Point, w = 300, h = 50, extra = {}) => {
    const id = `o${++n}`;
    const rect = { x: at?.x ?? 0, y: at?.y ?? y, w, h };
    y = rect.y + h + 10;
    objs.set(id, { kind, content, rect, ...extra });
    order.push(id);
    return id;
  };
  const log: string[] = [];
  const board: Board = {
    addText: (t, o) => add('text', t, o?.at, 300, o?.size ?? 30, { color: o?.color }),
    addMath: (t, o) => add('math', t, o?.at, 300, o?.size ?? 36),
    addGraph: (e, o) => add('graph', e.join(';'), undefined, 480, 320, { xRange: o?.xRange }),
    addShape: (k, o) => add('shape', `${k}${o?.from !== undefined ? ` ${o.from}..${o.until}` : ''}${o?.right ? ' right' : ''}${o?.label ? ` [${o.label}]` : ''}`, o?.at, o?.w ?? 100, o?.h ?? 100),
    mark: (t, s) => add('mark', s, undefined, 0, 0, { target: t, style: s }),
    group: (ids) => add('group', ids.join(','), undefined, 0, 0),
    remove: (id) => void (objs.delete(id), log.push(`remove ${id}`)),
    move: (id, by) => void log.push(`move ${id} ${by.x},${by.y}`),
    scale: (id, k) => {
      log.push(`scale ${id} ${k.toFixed(2)}`);
      const o = objs.get(id);
      if (o) o.rect = { ...o.rect, w: o.rect.w * k, h: o.rect.h * k };
    },
    bounds: (id) => objs.get(id)?.rect ?? null,
    last: () => [...order].reverse().find((id) => objs.has(id)) ?? null,
    selection: () => selected,
    select: (ids) => void (selected = ids),
    nextSpot: () => ({ x: 0, y }),
    reveal: () => undefined,
    zoomBy: (f) => void log.push(`zoom ${f.toFixed(2)}`),
    fit: () => void log.push('fit'),
    undo: () => void log.push('undo'),
    redo: () => void log.push('redo'),
    clear: () => void (objs.clear(), log.push('clear')),
    camera: () => ({ x: 0, y: 0, z: 2 }),
    exportPng: async () => new Blob(),
    ready: async () => undefined,
    setCommandText: () => undefined,
    setListening: () => undefined,
    status: () => undefined,
    title: 'Test',
    destroy: () => undefined,
  };
  return { board, objs, log, of: (kind: string) => [...objs.values()].filter((o) => o.kind === kind) };
}

async function setup() {
  const om = await createLemma({ liveRates: false });
  const fb = fakeBoard();
  const cmd = new BoardCommands(fb.board, {
    worked: async (q) => worked(q),
    compute: async (q) => {
      const r = await om.compute(q);
      return r.ok ? { ok: true, display: `${r.display}${r.unit ? ` ${r.unit}` : ''}` } : { ok: false, message: r.error?.message ?? 'error' };
    },
    toTex,
  });
  return { ...fb, cmd };
}

describe('whiteboard voice commands', () => {
  it('solves with steps and circles the answer when asked', async () => {
    const { cmd, of } = await setup();
    const said = await cmd.run('Solve 2x + 3 = 11 and circle the answer');
    expect(said).toMatch(/x = 4/);
    const marks = of('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.style).toBe('circle');
    expect(of('text').length).toBeGreaterThan(1); // the steps
    expect(of('group')).toHaveLength(1);
    // "x = 4" is the answer, written once (not also as the last step's math).
    expect(of('math').filter((m) => m.content.replace(/\s/g, '') === 'x=4')).toHaveLength(1);
  });

  it('"just the answer" skips the steps; plain questions box the answer by default', async () => {
    const { cmd, of } = await setup();
    await cmd.run('derivative of x^3 sin(x), just the answer');
    expect(of('text')).toHaveLength(0);
    expect(of('mark')[0]!.style).toBe('box');
  });

  it('falls back to the calculator for things without worked steps', async () => {
    const { cmd, of } = await setup();
    expect(await cmd.run("what's 17 * 23")).toBe('391');
    expect(of('text').some((t) => t.content === '= 391')).toBe(true);
  });

  it('graphs, shapes, number lines and axes', async () => {
    const { cmd, of } = await setup();
    await cmd.run('graph sin x and x^2/4');
    expect(of('graph')[0]!.content).toBe('sin x;x^2/4');
    await cmd.run('draw a number line from 5 to -3');
    expect(of('shape')[0]!.content).toBe('numberline -3..5');
    await cmd.run('draw a circle');
    await cmd.run('please draw the coordinate plane');
    expect(of('shape').map((s) => s.content)).toEqual(['numberline -3..5', 'ellipse', 'axes']);
  });

  it('writes text and math', async () => {
    const { cmd, of } = await setup();
    await cmd.run("write chain rule: f'(g(x))·g'(x)");
    expect(of('text').map((t) => t.content)).toContain('chain rule:');
    expect(of('math').map((t) => t.content).join(' ')).toMatch(/f'\(g\(x\)\)/);
    await cmd.run('write remember to check units');
    expect(of('text').map((t) => t.content)).toContain('remember to check units');
  });

  it('marks "that" and "the answer"; move, erase, undo, zoom', async () => {
    const { cmd, of, log } = await setup();
    await cmd.run('15% tip on 84.50, just the answer');
    await cmd.run('underline the answer');
    expect(of('mark').map((m) => m.style)).toEqual(['box', 'underline']);
    await cmd.run('check it');
    expect(of('mark').at(-1)!.style).toBe('check');
    await cmd.run('move it left');
    await cmd.run('zoom in');
    await cmd.run('undo');
    await cmd.run('show everything');
    expect(log.join(' | ')).toMatch(/move o\d+ -180,0 \| zoom 1.40 \| undo \| fit/);
  });

  it('"put the answer there" answers the question already on the board', async () => {
    const { cmd, of, board } = await setup();
    await cmd.run('write 12 * 12');
    const q = board.last()!;
    board.select([q]);
    expect(await cmd.run('put the answer there')).toBe('144');
    expect(of('mark')[0]!.style).toBe('circle');
  });

  it('clear the board', async () => {
    const { cmd, log } = await setup();
    await cmd.run('graph x^2');
    expect(await cmd.run('clear the board')).toMatch(/Cleared/);
    expect(log).toContain('clear');
  });
});

describe('whiteboard voice commands: how people actually say things', () => {
  it('spoken math is solved and written as math, with the right answer', async () => {
    const { cmd, of } = await setup();
    // The calculator alone answered "0" here; the words are now read as x^2 - 4 = 0.
    expect(await cmd.run('solve x squared minus 4 equals 0')).toMatch(/x = −2 or x = 2/);
    expect(of('math')[0]!.content).toBe('x^{2} - 4 = 0');
    expect(await cmd.run('hey, solve two x plus three equals eleven')).toMatch(/x = 4/);
    expect(await cmd.run('derivative of e to the x, just the answer')).toMatch(/^e\^x/);
    expect(await cmd.run('square root of 144')).toBe('12');
    expect(await cmd.run('how much is 20 percent of 150')).toMatch(/^30/);
  });

  it('the answer is written once when the last step is the answer as plain text', async () => {
    const { cmd, objs } = await setup();
    await cmd.run("what's 15% of 80");
    const twelves = [...objs.values()].filter((o) => (o.kind === 'math' || o.kind === 'text') && o.content.trim() === '12');
    expect(twelves).toHaveLength(1);
  });

  it('board actions it can’t do are answered with a hint, never written as "= undefined"', async () => {
    const { cmd, objs } = await setup();
    for (const p of ['draw a heart', 'draw a circle with a smiley', 'rotate it']) {
      expect(await cmd.run(p)).toMatch(/^(?:Not sure how to do|Didn’t catch an instruction)/);
    }
    // Things it now does, on an empty board, say there's nothing to act on instead.
    expect(await cmd.run('make it bigger')).toBe('Nothing to resize yet');
    expect(await cmd.run('cross it out')).toBe('Nothing to cross out');
    expect(await cmd.run('label it')).toMatch(/Say the label/);
    expect(objs.size).toBe(0);
  });

  it('number lines and graphs take spoken numbers, "y =" and an x range', async () => {
    const { cmd, of } = await setup();
    expect(await cmd.run('draw a number line from negative five to five')).toBe('Number line from -5 to 5');
    await cmd.run('plot y equals 2x plus 1');
    await cmd.run('graph of sin x');
    await cmd.run('plot y equals x squared from negative 3 to 3');
    await cmd.run('plot y=x^2 and y=2x');
    const graphs = of('graph');
    expect(graphs.map((g) => g.content)).toEqual(['2x + 1', 'sin x', 'x^2', 'x^2;2x']);
    expect(graphs[2]!.xRange).toEqual([-3, 3]);
  });

  it('shapes vs marks: "draw a circle" draws one, "draw a circle around it" marks', async () => {
    const { cmd, of } = await setup();
    await cmd.run('draw a big circle');
    expect(of('shape').map((s) => [s.content, s.rect.w])).toEqual([['ellipse', 320]]);
    await cmd.run('draw a circle around it');
    expect(of('mark').map((m) => m.style)).toEqual(['circle']);
    await cmd.run('put a check on it');
    expect(of('mark').map((m) => m.style)).toEqual(['circle', 'check']);
  });

  it('filler words, writing math said aloud, and titles', async () => {
    const { cmd, of } = await setup();
    await cmd.run('please write hello world');
    await cmd.run('write a squared plus b squared equals c squared');
    await cmd.run('write two apples and three pears');
    await cmd.run('add a title Algebra notes');
    expect(of('text').map((t) => t.content)).toEqual(['hello world', 'two apples and three pears', 'Algebra notes']);
    expect(of('math').map((m) => m.content)).toEqual(['a^{2} + b^{2} = c^{2}']);
  });

  it('control phrasings: undo that, redo that, clear, zoom a bit, reset zoom, move it to the left a little', async () => {
    const { cmd, log } = await setup();
    await cmd.run('write x');
    for (const p of ['undo that', 'never mind', 'redo that', 'zoom in a bit', 'zoom out a lot', 'reset zoom', 'move it to the left a little', 'move that up', 'clear']) await cmd.run(p);
    expect(log.join(' | ')).toMatch(/^undo \| undo \| redo \| zoom 1\.15 \| zoom 0\.50 \| zoom 0\.50 \| move o\d+ -60,0 \| move o\d+ 0,-180 \| clear$/);
  });

  it('"circle it" right after solving circles the answer; marks never point at something undone or erased', async () => {
    const { cmd, of, objs, board } = await setup();
    await cmd.run('solve 2x + 3 = 11');
    await cmd.run('circle it');
    const answer = of('mark')[0]!.target!;
    expect(of('mark')[1]!.target).toBe(answer);
    // The answer goes (erased); "circle the answer" must not mark a missing object.
    board.remove(answer);
    for (const id of [...objs.keys()]) if (objs.get(id)!.kind === 'mark') objs.delete(id);
    await cmd.run('write 7 * 6');
    await cmd.run('circle the answer');
    const m = of('mark');
    expect(m).toHaveLength(1);
    expect(objs.has(m[0]!.target!)).toBe(true);
    // "put the answer there" falls back to a question still on the board.
    expect(await cmd.run('put the answer there')).toBe('42');
  });
});

/** Objects of a kind with their ids (the fake board keys them by id). */
const withIds = (objs: Map<string, { kind: string }>, kind: string) => [...objs.entries()].filter(([, o]) => o.kind === kind).map(([id, o]) => ({ id, ...o }) as any);

describe('whiteboard voice commands: sizes, labels, crossing out, right triangles', () => {
  it('"make it bigger/smaller" scales what was just drawn (or the selection)', async () => {
    const { cmd, log, objs } = await setup();
    await cmd.run('draw a circle');
    const id = withIds(objs, 'shape')[0]!.id;
    expect(await cmd.run('make it bigger')).toBe('Bigger');
    expect(await cmd.run('make that a lot smaller')).toBe('Smaller');
    expect(await cmd.run('make it twice as big')).toBe('Bigger');
    expect(await cmd.run('make it half the size')).toBe('Smaller');
    expect(await cmd.run('shrink it a bit')).toBe('Smaller');
    expect(await cmd.run('scale it by 150%')).toBe('Bigger');
    expect(log.filter((l) => l.startsWith('scale'))).toEqual([`scale ${id} 1.40`, `scale ${id} 0.50`, `scale ${id} 2.00`, `scale ${id} 0.50`, `scale ${id} 0.87`, `scale ${id} 1.50`]);
  });

  it('"label it …" writes the label under the object, keeping its case; math labels are typeset', async () => {
    const { cmd, of, objs } = await setup();
    await cmd.run('draw a triangle');
    const tri = objs.get(withIds(objs, 'shape')[0]!.id)!;
    expect(await cmd.run('label it Triangle ABC')).toBe('Labelled');
    const label = of('text')[0]!;
    expect(label.content).toBe('Triangle ABC');
    expect(label.rect.y).toBeGreaterThan(tri.rect.y + tri.rect.h);
    await cmd.run('draw a square');
    await cmd.run('label that x squared');
    expect(of('math').map((m) => m.content)).toEqual(['x^{2}']);
  });

  it('"cross it out" strikes through the last thing, or the answer after solving', async () => {
    const { cmd, of, objs } = await setup();
    await cmd.run('write wrong idea');
    expect(await cmd.run('cross it out')).toBe('Crossed out');
    expect(of('mark').map((m) => [m.style, m.target])).toEqual([['strike', withIds(objs, 'text')[0]!.id]]);
    await cmd.run('what is 2 + 2');
    await cmd.run('cross out the answer');
    const answer = withIds(objs, 'text').find((t: any) => t.content === '= 4')!;
    expect(of('mark').at(-1)).toMatchObject({ style: 'strike', target: answer.id });
  });

  it('draws a right triangle with its right angle marked, and shapes at a stated size', async () => {
    const { cmd, of, objs } = await setup();
    expect(await cmd.run('draw a right triangle')).toBe('Right triangle');
    expect(await cmd.run('draw a right-angled triangle')).toBe('Right triangle');
    expect(await cmd.run('draw a triangle')).toBe('Triangle');
    expect(of('shape').map((s) => s.content)).toEqual(['triangle right', 'triangle right', 'triangle']);

    expect(await cmd.run('draw a circle with radius 5')).toBe('Circle with radius 5');
    expect(await cmd.run('draw a circle with radius 2')).toBe('Circle with radius 2');
    expect(await cmd.run('draw a circle of diameter three')).toBe('Circle with diameter 3');
    expect(await cmd.run('draw a square with side 4')).toBe('Square with side 4');
    expect(await cmd.run('draw a 6 by 3 rectangle')).toBe('Rectangle 6 by 3');
    const sized = withIds(objs, 'shape').slice(3).map((s: any) => [s.content, s.rect.w, s.rect.h]);
    expect(sized).toEqual([
      ['ellipse [r = 5]', 200, 200],
      ['ellipse [r = 2]', 80, 80],
      ['ellipse [d = 3]', 60, 60],
      ['rect [4]', 80, 80],
      ['rect [6 × 3]', 120, 60],
    ]);
    expect(await cmd.run('draw a circle with radius 0')).toMatch(/positive size/);
  });
});
