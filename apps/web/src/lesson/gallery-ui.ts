import './lesson.css';
import { gallery, VIDEOS_CHANGED_EVENT, type VideoSummary } from './gallery';
import { formatTime } from './timeline';

export const EMPTY_GALLERY_TEXT = 'No videos yet. Make one from any answer with Create video.';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'lesson'
  );
}

const extFor = (mime: string) => (mime.includes('mp4') ? 'mp4' : 'webm');

function button(label: string, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `ol-btn ${cls}`.trim();
  b.textContent = label;
  return b;
}

/** Renders the saved-video list into `container`; returns a cleanup function. */
export function openVideoGallery(container: HTMLElement, opts: { onPlay?(id: string): void } = {}): () => void {
  const root = document.createElement('div');
  root.className = 'ol-gallery';
  container.append(root);
  const urls = new Set<string>();
  let disposed = false;
  let generation = 0;
  const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  const revokeAll = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
  };

  async function blobUrl(id: string): Promise<{ url: string; mime: string; title: string; vtt?: string } | null> {
    const rec = await gallery.get(id);
    if (!rec) return null;
    const url = URL.createObjectURL(rec.blob);
    urls.add(url);
    return { url, mime: rec.mime, title: rec.title, ...(rec.vtt ? { vtt: rec.vtt } : {}) };
  }

  function save(href: string, name: string) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
  }

  function item(v: VideoSummary): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'ol-gallery-item';
    li.dataset.id = v.id;
    const row = document.createElement('div');
    row.className = 'ol-gallery-row';
    const info = document.createElement('div');
    info.className = 'ol-gallery-info';
    const title = document.createElement('p');
    title.className = 'ol-gallery-title';
    title.textContent = v.title;
    const meta = document.createElement('p');
    meta.className = 'ol-gallery-meta';
    meta.textContent = `${v.style ? `${v.style} · ` : ''}${dateFmt.format(new Date(v.createdAt))} · ${formatTime(v.duration)} · ${formatBytes(v.size)}`;
    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'ol-gallery-actions';
    const play = button('Play', 'ol-gallery-play');
    const download = button('Download', 'ol-gallery-download');
    const del = button('Delete', 'ol-danger ol-gallery-delete');
    play.setAttribute('aria-label', `Play ${v.title}`);
    download.setAttribute('aria-label', `Download ${v.title}`);
    del.setAttribute('aria-label', `Delete ${v.title}`);
    actions.append(play, download);
    // The narration as a WebVTT file, to load next to the video in any player.
    if (v.captions) {
      const cc = button('Captions', 'ol-gallery-captions');
      cc.setAttribute('aria-label', `Download captions for ${v.title}`);
      cc.addEventListener('click', async () => {
        try {
          const got = await blobUrl(v.id);
          if (!got?.vtt) return void render();
          const url = URL.createObjectURL(new Blob([got.vtt], { type: 'text/vtt' }));
          urls.add(url);
          save(url, `${slug(got.title)}.vtt`);
        } catch (e) {
          showError(e);
        }
      });
      actions.append(cc);
    }
    actions.append(del);
    row.append(info, actions);
    li.append(row);

    play.addEventListener('click', async () => {
      if (opts.onPlay) {
        opts.onPlay(v.id);
        return;
      }
      const existing = li.querySelector('video');
      if (existing) {
        existing.remove();
        play.textContent = 'Play';
        return;
      }
      try {
        const got = await blobUrl(v.id);
        if (!got) return void render();
        const video = document.createElement('video');
        video.className = 'ol-gallery-video';
        video.controls = true;
        video.playsInline = true;
        video.src = got.url;
        li.append(video);
        play.textContent = 'Close';
        void video.play().catch(() => {});
      } catch (e) {
        showError(e);
      }
    });

    download.addEventListener('click', async () => {
      try {
        const got = await blobUrl(v.id);
        if (!got) return void render();
        save(got.url, `${slug(got.title)}.${extFor(got.mime)}`);
      } catch (e) {
        showError(e);
      }
    });

    let confirmTimer = 0;
    del.addEventListener('click', async () => {
      if (del.dataset.confirm !== 'true') {
        del.dataset.confirm = 'true';
        del.textContent = 'Confirm delete';
        confirmTimer = window.setTimeout(() => {
          del.dataset.confirm = 'false';
          del.textContent = 'Delete';
        }, 4000);
        return;
      }
      clearTimeout(confirmTimer);
      del.disabled = true;
      try {
        await gallery.remove(v.id); // fires VIDEOS_CHANGED_EVENT -> re-render
      } catch (e) {
        showError(e);
      }
    });
    return li;
  }

  function showError(e: unknown) {
    if (disposed) return;
    const p = document.createElement('p');
    p.className = 'ol-gallery-error';
    p.setAttribute('role', 'alert');
    p.textContent = e instanceof Error ? e.message : String(e);
    root.replaceChildren(p);
  }

  async function render() {
    const gen = ++generation;
    let videos: VideoSummary[];
    try {
      videos = await gallery.list();
    } catch (e) {
      if (gen === generation) showError(e);
      return;
    }
    if (disposed || gen !== generation) return;
    revokeAll();
    if (!videos.length) {
      const p = document.createElement('p');
      p.className = 'ol-gallery-empty';
      p.textContent = EMPTY_GALLERY_TEXT;
      root.replaceChildren(p);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'ol-gallery-list';
    ul.setAttribute('aria-label', 'Saved videos');
    ul.append(...videos.map(item));
    root.replaceChildren(ul);
  }

  const onChange = () => void render();
  window.addEventListener(VIDEOS_CHANGED_EVENT, onChange);
  void render();

  return () => {
    disposed = true;
    window.removeEventListener(VIDEOS_CHANGED_EVENT, onChange);
    revokeAll();
    root.remove();
  };
}
