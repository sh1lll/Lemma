import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { continues, joinPhrases, needsMore, PATIENCE_MS, PhraseGate, waitFor } from '../src/patience';

describe('end-of-speech patience', () => {
  it('knows when the words so far need more', () => {
    for (const t of ['twelve plus', '5 times', 'square root of', '10 divided by', '2 to the power', 'x equals', '3 * (4 +', 'twenty', 'what is', '5 and']) expect(needsMore(t), t).toBe(true);
    for (const t of ['twelve plus eight', '12 + 8', '5 squared', 'twenty five', '(3 + 4)', 'open the whiteboard']) expect(needsMore(t), t).toBe(false);
  });

  it('waits longer after a connector', () => {
    expect(waitFor('12 plus 8', 900)).toBe(900);
    expect(waitFor('12 plus', 900)).toBe(1620);
    expect(waitFor('12 plus', 500)).toBe(900);
    expect(PATIENCE_MS).toEqual({ short: 500, normal: 900, long: 1500 });
  });

  it('joins continuations, keeps new phrases apart', () => {
    expect(continues('twelve plus', 'eight')).toBe(true);
    expect(continues('12 plus 8', 'times 3')).toBe(true);
    expect(continues('12 plus', '12 plus 8')).toBe(true);
    expect(continues('write 2 + 2 = 4', 'close the whiteboard')).toBe(false);
    expect(joinPhrases('twelve plus', 'eight')).toBe('twelve plus eight');
    expect(joinPhrases('12 plus 8', 'times 3')).toBe('12 plus 8 then times 3');
    expect(joinPhrases('12 plus', '12 plus 8')).toBe('12 plus 8');
    expect(joinPhrases('twenty', 'five')).toBe('twenty five');
  });
});

describe('PhraseGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const gate = (wait = 900) => {
    const commits: string[] = [];
    const g = new PhraseGate({ wait: () => wait, commit: (t) => commits.push(t) });
    return { g, commits };
  };

  it('commits once, after the pause', () => {
    const { g, commits } = gate();
    g.final('12 plus 8');
    vi.advanceTimersByTime(800);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(commits).toEqual(['12 plus 8']);
  });

  it('a phrase split across quick finals is one phrase', () => {
    const { g, commits } = gate();
    g.final('twelve plus');
    vi.advanceTimersByTime(700);
    g.final('eight');
    vi.advanceTimersByTime(2000);
    expect(commits).toEqual(['twelve plus eight']);
  });

  it('many short finals (some browsers) still make one phrase', () => {
    const { g, commits } = gate();
    for (const piece of ['what is', 'twenty', 'five', 'times', 'four']) {
      g.final(piece);
      vi.advanceTimersByTime(300);
    }
    vi.advanceTimersByTime(1000);
    expect(commits).toEqual(['what is twenty five times four']);
  });

  it('speech still coming holds the phrase until its final', () => {
    const { g, commits } = gate();
    g.final('12 plus 8');
    vi.advanceTimersByTime(500);
    g.partial('times');
    vi.advanceTimersByTime(1500);
    expect(commits).toEqual([]);
    g.final('times 3');
    vi.advanceTimersByTime(900);
    expect(commits).toEqual(['12 plus 8 then times 3']);
  });

  it('ending on a connector waits longer', () => {
    const { g, commits } = gate();
    g.final('12 plus');
    vi.advanceTimersByTime(1200);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(commits).toEqual(['12 plus']);
  });

  it('a new, unrelated phrase commits the one before at once', () => {
    const { g, commits } = gate();
    g.final('write 2 + 2 = 4');
    g.final('close the whiteboard');
    expect(commits).toEqual(['write 2 + 2 = 4']);
    vi.advanceTimersByTime(900);
    expect(commits).toEqual(['write 2 + 2 = 4', 'close the whiteboard']);
  });

  it('instant commands bypass the wait; cancel drops a held phrase', () => {
    const commits: string[] = [];
    const g: PhraseGate = new PhraseGate({ wait: () => 900, commit: (t) => commits.push(t), instant: (t) => t === 'scratch that' && (g.cancel(), true) });
    g.final('9 times 9');
    g.final('scratch that');
    vi.advanceTimersByTime(3000);
    expect(commits).toEqual([]);
  });
});
