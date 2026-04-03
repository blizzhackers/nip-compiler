import { D2ItemImpl, MAX_STAT_ID, type D2Item, type ItemMeta } from './item.js';

/**
 * A d2bs Unit object. This is the shape that d2bs/kolbot exposes.
 * We only read from it — no mutations.
 */
export interface D2BSUnit {
  readonly classid: number;
  readonly itemType: number;
  readonly quality: number;
  readonly ilvl: number;
  readonly itemclass: number;
  readonly strreq: number;
  readonly dexreq: number;
  getFlag(flag: number): number;
  getStatEx(id: number, param?: number): number;
  getColor(): number;
  getPrefix(value: number): number;
  getSuffix(value: number): number;
}

/** Stat IDs that are commonly used in NIP rules — populated first for performance. */
const COMMON_STATS = [
  0, 1, 2, 3, 7, 9, 11, 19, 20, 21, 22, 23, 24, 25, 27, 28, 31, 34, 35,
  36, 37, 39, 40, 41, 42, 43, 44, 45, 46, 48, 49, 50, 51, 52, 53, 54, 55,
  57, 58, 60, 62, 67, 72, 73, 74, 76, 77, 78, 79, 80, 83, 85, 89, 91, 93,
  96, 97, 99, 102, 105, 108, 110, 114, 115, 117, 118, 119, 120, 121, 122,
  123, 124, 127, 128, 134, 135, 136, 138, 141, 142, 143, 144, 145, 148,
  149, 150, 151, 152, 153, 156, 188, 194,
];

/**
 * Wrap a d2bs Unit into a D2Item.
 * Reads all simple stats once into a TypedArray. Subsequent stat checks
 * are O(1) array index lookups instead of function calls.
 */
export function wrapItem(unit: D2BSUnit): D2Item {
  const stats = new Int32Array(MAX_STAT_ID);

  for (const id of COMMON_STATS) {
    stats[id] = unit.getStatEx(id);
  }

  const meta: ItemMeta = {
    classid: unit.classid,
    itemType: unit.itemType,
    quality: unit.quality,
    ilvl: unit.ilvl,
    itemclass: unit.itemclass,
    flags: getFlags(unit),
    strreq: unit.strreq,
    dexreq: unit.dexreq,
    color: unit.getColor(),
  };

  // For parameterized stats, we wrap the original getStatEx
  // since we can't pre-enumerate all (id, param) pairs
  const paramProxy = new Map<number, number>();
  const item = new D2ItemImpl(meta, stats, paramProxy);

  // Override getStatEx to fall through to the original unit for parameterized stats
  const origGetStatEx = item.getStatEx.bind(item);
  (item as any).getStatEx = (id: number, param?: number): number => {
    if (param !== undefined) return unit.getStatEx(id, param);
    return origGetStatEx(id);
  };

  return item;
}

function getFlags(unit: D2BSUnit): number {
  let flags = 0;
  // Check common flags and build bitmask
  const FLAG_IDS = [0x10, 0x400000, 0x4000000]; // identified, ethereal, runeword
  for (const f of FLAG_IDS) {
    if (unit.getFlag(f)) flags |= f;
  }
  return flags;
}
