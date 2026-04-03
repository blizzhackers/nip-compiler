/**
 * D2Item — high-performance Diablo 2 item interface.
 *
 * Stats are backed by an Int32Array for O(1) indexed access.
 * Instead of calling getStatEx(id) per stat check (function call overhead),
 * the stats array is populated once and all subsequent reads are direct
 * array index lookups.
 *
 * Simple stats (id 0-358): stats[id]
 * Parameterized stats [id, param]: getStatEx(id, param) fallback
 */

/** Maximum stat ID in D2 1.13. Stats array is allocated to this size. */
export const MAX_STAT_ID = 359;

/** The read-only item interface that compiled NIP code evaluates against. */
export interface D2Item {
  readonly classid: number;
  readonly itemType: number;
  readonly quality: number;
  readonly ilvl: number;
  readonly itemclass: number;
  readonly flags: number;
  readonly strreq: number;
  readonly dexreq: number;

  /** TypedArray-backed stat access. stats[statId] for simple (single-ID) stats. */
  readonly stats: Int32Array;

  /** Flag check compatible with d2bs. Returns the flag value if set, 0 otherwise. */
  getFlag(flag: number): number;

  /**
   * Stat access compatible with d2bs.
   * For simple stats, reads from the TypedArray.
   * For parameterized stats (id + param), uses the parameterized lookup.
   */
  getStatEx(id: number, param?: number): number;

  /** Get item color. */
  getColor(): number;

  /** Prefix check compatible with d2bs. */
  getPrefix(value: number): number;

  /** Suffix check compatible with d2bs. */
  getSuffix(value: number): number;
}

/** Metadata for constructing a D2Item from a raw buffer or object. */
export interface ItemMeta {
  classid: number;
  itemType: number;
  quality: number;
  ilvl: number;
  itemclass: number;
  flags: number;
  strreq: number;
  dexreq: number;
  color?: number;
  prefix?: number;
  suffix?: number;
}

/**
 * Concrete D2Item backed by an Int32Array for stats.
 * Parameterized stats are stored in a separate Map.
 */
export class D2ItemImpl implements D2Item {
  readonly classid: number;
  readonly itemType: number;
  readonly quality: number;
  readonly ilvl: number;
  readonly itemclass: number;
  readonly flags: number;
  readonly strreq: number;
  readonly dexreq: number;
  readonly stats: Int32Array;

  private readonly paramStats: Map<number, number>;
  private readonly _color: number;
  private readonly _prefix: number;
  private readonly _suffix: number;

  constructor(
    meta: ItemMeta,
    stats: Int32Array,
    paramStats?: Map<number, number>,
  ) {
    this.classid = meta.classid;
    this.itemType = meta.itemType;
    this.quality = meta.quality;
    this.ilvl = meta.ilvl;
    this.itemclass = meta.itemclass;
    this.flags = meta.flags;
    this.strreq = meta.strreq;
    this.dexreq = meta.dexreq;
    this.stats = stats;
    this.paramStats = paramStats ?? new Map();
    this._color = meta.color ?? 0;
    this._prefix = meta.prefix ?? 0;
    this._suffix = meta.suffix ?? 0;
  }

  getFlag(flag: number): number {
    return (this.flags & flag) ? flag : 0;
  }

  getStatEx(id: number, param?: number): number {
    if (param !== undefined) {
      return this.paramStats.get(id * 65536 + param) ?? 0;
    }
    return id < this.stats.length ? this.stats[id] : 0;
  }

  getColor(): number {
    return this._color;
  }

  getPrefix(value: number): number {
    return this._prefix === value ? value : 0;
  }

  getSuffix(value: number): number {
    return this._suffix === value ? value : 0;
  }
}
