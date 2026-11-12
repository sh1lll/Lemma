/**
 * @lemma/agenda-engine: the study agenda (ROADMAP Phase 8). Pure and DOM-free.
 *
 *  - parseTask: "Problem set 4 due Friday, 12 problems" → Task, or { ask } when something is missing
 *  - taskProgress / makeActivity: tasks advance as problems are solved in the app ("7 of 12")
 *  - reviewsDue / topicMemory: SM-2 spaced review per topic from right/wrong answers and idle time
 *  - planExam: countdown plan to an exam with a mock exam near the end
 *  - progress / streaks: problems per topic, accuracy trend, streaks, weekly summary
 *
 * Storage model (for sync): one list of records, each `{ id, type: 'task' | 'activity', ... }`. Tasks carry an
 * `updated` timestamp (last writer wins); activities are append-only, so merging is a union. Progress and the
 * review schedule are always derived, never stored.
 */
export * from './types';
export { addDays, dayOf, diffDays, formatDay, isDay, relativeDay, weekday } from './days';
export { dateOrderFor, isAsk, newId, parseTask, toZoned, type Now, type ParseOptions, type ParseResult } from './parse';
export { normalizeTopic, subjectTopics, topicAdjective, topicLabel, topicNoun, topicsIn, TOPIC_IDS } from './topics';
export { MAX_INTERVAL, quality, reviewsDue, sm2, STALE_DAYS, topicMemory, type ReviewOptions, type ReviewReason, type ReviewSuggestion, type TopicMemory } from './review';
export { describeWeights, planExam, topicWeights, type ExamPlan, type PlanDay, type PlanItem, type PlanOptions, type TopicWeight } from './plan';
export { progress, streaks, weekSentence, type ProgressStats, type Streak, type TopicStat, type TrendPoint, type WeekSummary } from './progress';
export { agendaView, makeActivity, pruneActivities, splitRecords, taskProgress, type AgendaView, type TaskProgress } from './tasks';

/** localStorage key and sync collection name. */
export const AGENDA_STORAGE_KEY = 'lemma.agenda.v1';
export const AGENDA_COLLECTION = 'agenda';
