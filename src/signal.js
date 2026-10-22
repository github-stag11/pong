// Encodes WebRTC session descriptions into short copy/paste-friendly strings.
// "z." prefix = deflate-compressed, "p." prefix = plain (browsers without CompressionStream).

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeSignal(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') return 'p.' + toBase64Url(bytes);
  return 'z.' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

export async function decodeSignal(code) {
  const clean = String(code).replace(/\s+/g, '');
  const [kind, body] = [clean.slice(0, 2), clean.slice(2)];
  try {
    let bytes;
    if (kind === 'p.') bytes = fromBase64Url(body);
    else if (kind === 'z.') bytes = await pipe(fromBase64Url(body), new DecompressionStream('deflate-raw'));
    else throw new Error('bad prefix');
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('That code is not valid. Copy the whole code and try again.');
  }
}
