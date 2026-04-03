import { D2ItemImpl, MAX_STAT_ID, type D2Item, type ItemMeta } from './item.js';

/**
 * Create a D2Item from plain object data. Useful for testing and
 * scenarios where item data comes from a non-d2bs source.
 */
export function createItem(
  meta: ItemMeta,
  stats?: Record<number, number>,
  paramStats?: Record<string, number>,
): D2Item {
  const arr = new Int32Array(MAX_STAT_ID);
  if (stats) {
    for (const [id, value] of Object.entries(stats)) {
      const idx = Number(id);
      if (idx < MAX_STAT_ID) arr[idx] = value;
    }
  }

  const paramMap = new Map<number, number>();
  if (paramStats) {
    for (const [key, value] of Object.entries(paramStats)) {
      const [id, param] = key.split(',').map(Number);
      paramMap.set(id * 65536 + param, value);
    }
  }

  return new D2ItemImpl(meta, arr, paramMap);
}

/**
 * Create a D2Item directly from an ArrayBuffer.
 * The buffer must contain a pre-populated Int32Array of stat values
 * at the given byte offset.
 */
export function fromBuffer(
  meta: ItemMeta,
  buffer: ArrayBuffer,
  statsByteOffset = 0,
  paramStats?: Map<number, number>,
): D2Item {
  const stats = new Int32Array(buffer, statsByteOffset, MAX_STAT_ID);
  return new D2ItemImpl(meta, stats, paramStats);
}
