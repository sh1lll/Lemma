import type { Question, Topic } from '@lemma/practice-engine';

/**
 * Practice questions answered wrong (or only after seeing the steps), kept so they can be practised again: the
 * same question first, then fresh ones on the same topics. A question leaves the list once it's answered right.
 * Questions are regenerated from topic, level and seed, so only those are stored.
 */
const KEY = 'lemma.mistakes.v1';
const MAX = 60;

export interface Mistake {
  id: string;
  topic: Topic;
  difficulty: 1 | 2 | 3;
  seed: number;
  prompt: string;
  at: number;
  misses: number;
}

export function listMistakes(): Mistake[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Mistake[];
    return Array.isArray(v) ? v.filter((m) => m && typeof m.topic === 'string' && Number.isFinite(m.seed)) : [];
  } catch {
    return [];
  }
}

function save(list: Mistake[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* storage full or blocked: practising still works, it just isn't remembered */
  }
}

export function addMistake(q: Question): void {
  const list = listMistakes();
  const had = list.find((m) => m.id === q.id);
  if (had) {
    had.misses++;
    had.at = Date.now();
  } else list.push({ id: q.id, topic: q.topic, difficulty: q.difficulty as 1 | 2 | 3, seed: q.seed, prompt: q.prompt, at: Date.now(), misses: 1 });
  save(list);
}

/** Answered right: it's learned. Returns whether it was on the list. */
export function clearMistake(id: string): boolean {
  const list = listMistakes();
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) return false;
  save(next);
  return true;
}
