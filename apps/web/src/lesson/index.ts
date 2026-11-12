// "Create video": animated step-by-step lessons, video export, and a local gallery of saved videos.
// Importing this module also loads ./lesson.css (via player.ts / gallery-ui.ts); no separate CSS import is needed.
export type { Lesson, LessonStep, Timeline } from './timeline';
export { buildTimeline, lessonDuration, texToPlain } from './timeline';
export { createLessonPlayer, type LessonPlayer } from './player';
export {
  exportLessonVideo,
  createLessonCanvasRenderer,
  canExportVideo,
  pickVideoMime,
  type ExportOptions,
  type ExportedVideo,
  type LessonCanvasRenderer,
} from './export';
export { gallery, VIDEOS_CHANGED_EVENT, type VideoRecord, type VideoSummary, type VideoGallery } from './gallery';
export { openVideoGallery, EMPTY_GALLERY_TEXT } from './gallery-ui';

// Lesson scripts (tutor-engine LessonScript) in teaching styles: player, video export with captions + WebVTT.
export { createScriptPlayer, type ScriptPlayer, type ScriptPlayerOptions } from './script-player';
export { exportScriptVideo } from './script-export';
export { createScriptCanvasRenderer, type ScriptCanvasRenderer, type ScriptRenderOptions } from './script-render';
export {
  STYLE_LOOKS,
  scriptDuration,
  buildScriptTimeline,
  buildVtt,
  speechEstimate,
  type ScriptTimeline,
  type ScriptSceneTiming,
} from './script-timeline';
export { recordCanvas } from './export';
export { isLessonScript } from './gallery';
