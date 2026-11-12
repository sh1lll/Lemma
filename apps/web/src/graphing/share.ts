import { sanitize, type State } from './model';

/**
 * Share links: the whole workspace, compressed (deflate) and base64url-encoded into the URL hash — no server.
 * "#graph=z…" is compressed; "#graph=j…" is plain JSON for browsers without CompressionStream. Pictures aren't
 * included (they stay on the device that added them).
 */

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeState(s: State): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ ...s, rows: s.rows.map((r) => (r.type === 'image' ? { ...r, key: '' } : r)) }));
  if (typeof CompressionStream === 'function') {
    try {
      return `z${b64(await pipe(json, new CompressionStream('deflate-raw')))}`;
    } catch {
      // Fall through to plain.
    }
  }
  return `j${b64(json)}`;
}

export async function decodeState(code: string): Promise<State | null> {
  try {
    const body = unb64(code.slice(1));
    const bytes = code[0] === 'z' ? await pipe(body, new DecompressionStream('deflate-raw')) : body;
    return sanitize(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export async function shareLink(s: State): Promise<string> {
  return `${location.origin}${location.pathname}${location.search}#graph=${await encodeState(s)}`;
}

/** A file download from a string or a data URL. */
export function download(name: string, data: string, type = 'image/svg+xml'): void {
  const a = document.createElement('a');
  a.download = name;
  a.href = data.startsWith('data:') ? data : URL.createObjectURL(new Blob([data], { type }));
  a.click();
  if (!data.startsWith('data:')) setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
