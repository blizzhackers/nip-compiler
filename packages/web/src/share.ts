import type { NipFileEntry } from './nip-files';
import type { CompileOptions } from './compiler';

interface SharePayload {
  enabled: string[];
  customFiles: { name: string; content: string }[];
  options: CompileOptions;
}

export async function encodeShareUrl(files: NipFileEntry[], options: CompileOptions): Promise<string> {
  const payload: SharePayload = {
    enabled: files.filter(f => f.enabled).map(f => f.name),
    customFiles: files
      .filter(f => !f.builtin)
      .map(f => ({ name: f.name, content: f.content })),
    options,
  };

  const json = JSON.stringify(payload);
  const compressed = await gzip(new TextEncoder().encode(json));
  const base64 = btoa(String.fromCharCode(...compressed));
  const hash = `#config=${encodeURIComponent(base64)}`;
  return `${location.origin}${location.pathname}${hash}`;
}

export async function decodeShareUrl(): Promise<SharePayload | null> {
  try {
    const hash = location.hash;
    if (!hash.startsWith('#config=')) return null;
    const base64 = decodeURIComponent(hash.slice('#config='.length));
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const decompressed = await ungzip(bytes);
    const json = new TextDecoder().decode(decompressed);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function ungzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
