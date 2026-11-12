// Video export for lesson scripts: the same canvas renderer as the player, recorded with MediaRecorder.
//
// Narration is NOT in the file: browsers give no way to capture speechSynthesis output into a MediaStream
// (it plays straight to the system audio device), so the video is silent. Instead the narration is burned
// into the frames as captions, and a WebVTT file with one cue per scene is returned alongside the video.
import { recordCanvas, type ExportedVideo, type ExportOptions } from './export';
import { createScriptCanvasRenderer } from './script-render';
import { buildVtt, type LessonScript, type StyleId } from './script-timeline';

export async function exportScriptVideo(script: LessonScript, opts: ExportOptions & { style?: StyleId } = {}): Promise<ExportedVideo & { vtt: string }> {
  const r = await createScriptCanvasRenderer(script, { width: opts.width, height: opts.height, style: opts.style, captions: true });
  if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const video = await recordCanvas(r, opts);
  return { ...video, vtt: buildVtt(r.timeline) };
}
