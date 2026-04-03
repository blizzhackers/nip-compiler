import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createItem, fromBuffer, wrapItem, MAX_STAT_ID } from './index.js';
import type { D2BSUnit, ItemMeta } from './index.js';

const baseMeta: ItemMeta = {
  classid: 522,
  itemType: 10,
  quality: 7,
  ilvl: 87,
  itemclass: 2,
  flags: 0x10, // identified
  strreq: 0,
  dexreq: 0,
};

describe('createItem', () => {
  it('reads simple stats from Int32Array', () => {
    const item = createItem(baseMeta, { 9: 120, 31: 50, 77: 25 });
    assert.strictEqual(item.stats[9], 120);
    assert.strictEqual(item.stats[31], 50);
    assert.strictEqual(item.stats[77], 25);
    assert.strictEqual(item.stats[0], 0);
  });

  it('reads stats via getStatEx', () => {
    const item = createItem(baseMeta, { 9: 120 });
    assert.strictEqual(item.getStatEx(9), 120);
    assert.strictEqual(item.getStatEx(999), 0);
  });

  it('reads parameterized stats via getStatEx(id, param)', () => {
    const item = createItem(baseMeta, {}, { '83,1': 3 });
    assert.strictEqual(item.getStatEx(83, 1), 3);
    assert.strictEqual(item.getStatEx(83, 0), 0);
    assert.strictEqual(item.getStatEx(83), 0);
  });

  it('reads properties', () => {
    const item = createItem(baseMeta);
    assert.strictEqual(item.classid, 522);
    assert.strictEqual(item.itemType, 10);
    assert.strictEqual(item.quality, 7);
    assert.strictEqual(item.ilvl, 87);
  });

  it('getFlag returns flag if set, 0 otherwise', () => {
    const item = createItem({ ...baseMeta, flags: 0x10 | 0x400000 });
    assert.strictEqual(item.getFlag(0x10), 0x10);
    assert.strictEqual(item.getFlag(0x400000), 0x400000);
    assert.strictEqual(item.getFlag(0x4000000), 0);
  });

  it('getColor returns color from meta', () => {
    const item = createItem({ ...baseMeta, color: 20 });
    assert.strictEqual(item.getColor(), 20);
  });

  it('getPrefix/getSuffix check equality', () => {
    const item = createItem({ ...baseMeta, prefix: 5, suffix: 3 });
    assert.strictEqual(item.getPrefix(5), 5);
    assert.strictEqual(item.getPrefix(6), 0);
    assert.strictEqual(item.getSuffix(3), 3);
    assert.strictEqual(item.getSuffix(4), 0);
  });
});

describe('fromBuffer', () => {
  it('reads stats from pre-populated ArrayBuffer', () => {
    const buffer = new ArrayBuffer(MAX_STAT_ID * 4);
    const view = new Int32Array(buffer);
    view[9] = 120;
    view[31] = 50;

    const item = fromBuffer(baseMeta, buffer);
    assert.strictEqual(item.stats[9], 120);
    assert.strictEqual(item.stats[31], 50);
    assert.strictEqual(item.getStatEx(9), 120);
  });

  it('shares the underlying buffer', () => {
    const buffer = new ArrayBuffer(MAX_STAT_ID * 4);
    const view = new Int32Array(buffer);
    view[9] = 100;

    const item = fromBuffer(baseMeta, buffer);
    assert.strictEqual(item.stats[9], 100);

    // Mutating the buffer is visible to the item
    view[9] = 200;
    assert.strictEqual(item.stats[9], 200);
  });
});

describe('wrapItem', () => {
  it('wraps a d2bs-style unit', () => {
    const unit: D2BSUnit = {
      classid: 522,
      itemType: 10,
      quality: 7,
      ilvl: 87,
      itemclass: 2,
      strreq: 0,
      dexreq: 0,
      getFlag: (f) => f === 0x10 ? 0x10 : 0,
      getStatEx: (id, param) => {
        if (param !== undefined) return id === 83 && param === 1 ? 3 : 0;
        return id === 9 ? 120 : id === 77 ? 25 : 0;
      },
      getColor: () => 20,
      getPrefix: (v) => v === 5 ? 5 : 0,
      getSuffix: (v) => v === 3 ? 3 : 0,
    };

    const item = wrapItem(unit);

    // Simple stats read from TypedArray (were copied from unit.getStatEx)
    assert.strictEqual(item.stats[9], 120);
    assert.strictEqual(item.stats[77], 25);

    // Compat methods
    assert.strictEqual(item.getStatEx(9), 120);
    assert.strictEqual(item.getFlag(0x10), 0x10);
    assert.strictEqual(item.getFlag(0x400000), 0);

    // Parameterized stat falls through to original unit
    assert.strictEqual(item.getStatEx(83, 1), 3);

    // Properties
    assert.strictEqual(item.classid, 522);
    assert.strictEqual(item.quality, 7);
  });
});
