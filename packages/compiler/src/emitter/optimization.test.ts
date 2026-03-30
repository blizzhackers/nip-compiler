/**
 * E2E tests for emitter optimizations.
 * These verify behavior, not implementation — they must pass for
 * any emitter backend (string-based, ESTree, future backends).
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Parser } from '../parser.js';
import { Binder } from '../binder.js';
import { Emitter } from './emitter.js';
import { d2Aliases } from './d2-aliases.js';

const parser = new Parser();
const binder = new Binder();

const helpers = {
  checkQuantityOwned: () => 0,
  me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
  getBaseStat: () => 0,
};

function cid(name: string): number { return d2Aliases.classId[name]; }
function qid(name: string): number { return d2Aliases.quality[name]; }
function sid(name: string): string {
  const s = d2Aliases.stat[name];
  return Array.isArray(s) ? `${s[0]}_${s[1]}` : String(s);
}

function compile(lines: string[], filename = 'test.nip') {
  const file = parser.parseFile(lines.join('\n'), filename);
  binder.bindFile(file);
  const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: false });
  const js = emitter.emit([file]);
  return eval(js)(helpers);
}

function compileMulti(entries: { name: string; lines: string[] }[]) {
  const files = entries.map(({ name, lines }) => {
    const file = parser.parseFile(lines.join('\n'), name);
    binder.bindFile(file);
    return file;
  });
  const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: false });
  const js = emitter.emit(files);
  return eval(js)(helpers);
}

function item(classid: number, quality: number, stats: Record<string, number> = {}, flags = 0x10) {
  return {
    classid, quality, itemType: 0, ilvl: 85, itemclass: 0,
    getFlag: (f: number) => (flags & f) ? f : 0,
    getStatEx: (id: number, param?: number) => {
      const key = param !== undefined ? `${id}_${param}` : String(id);
      return stats[key] ?? 0;
    },
    getColor: () => 0, strreq: 0, dexreq: 0, onGroundOrDropping: true, distance: 5,
    getPrefix: () => 0, getSuffix: () => 0, getParent: () => null, isInStorage: false,
  };
}

describe('E2E: emitter optimization correctness', () => {
  describe('basic dispatch', () => {
    it('matches by classid + quality + stat', () => {
      const mod = compile(['[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'), { [sid('itemmaxmanapercent')]: 25 })), 1);
    });

    it('rejects wrong classid', () => {
      const mod = compile(['[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25']);
      assert.strictEqual(mod.checkItem(item(cid('amulet'), qid('unique'), { [sid('itemmaxmanapercent')]: 25 })), 0);
    });

    it('rejects wrong quality', () => {
      const mod = compile(['[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('itemmaxmanapercent')]: 25 })), 0);
    });

    it('rejects wrong stats', () => {
      const mod = compile(['[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'), {})), 0);
    });
  });

  describe('unid bail', () => {
    it('returns -1 for unid item matching property but not stats', () => {
      const mod = compile(['[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'), {}, 0)), -1);
    });

    it('returns -1 even if magical stats happen to match (unid = not readable)', () => {
      const mod = compile(['[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'), { [sid('itemmaxmanapercent')]: 25 }, 0)), -1);
    });
  });

  describe('multiple rules same classid', () => {
    it('first matching rule wins', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 // soj',
        '[name] == ring && [quality] == unique # [maxstamina] == 50 // bk',
      ]);
      const soj = item(cid('ring'), qid('unique'), { [sid('itemmaxmanapercent')]: 25 });
      const result = mod.checkItem(soj, true);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 1);
    });

    it('second rule matches if first doesnt', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25',
        '[name] == ring && [quality] == unique # [maxstamina] == 50',
      ]);
      const bk = item(cid('ring'), qid('unique'), { [sid('maxstamina')]: 50 });
      const result = mod.checkItem(bk, true);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 2);
    });
  });

  describe('quality range', () => {
    it('[quality] <= superior matches normal', () => {
      const mod = compile(['[name] == monarch && [quality] <= superior # [sockets] == 4']);
      const monarch = item(cid('monarch'), qid('normal'), { [sid('sockets')]: 4 });
      assert.strictEqual(mod.checkItem(monarch), 1);
    });

    it('[quality] <= superior matches superior', () => {
      const mod = compile(['[name] == monarch && [quality] <= superior # [sockets] == 4']);
      const monarch = item(cid('monarch'), qid('superior'), { [sid('sockets')]: 4 });
      assert.strictEqual(mod.checkItem(monarch), 1);
    });

    it('[quality] <= superior rejects rare', () => {
      const mod = compile(['[name] == monarch && [quality] <= superior # [sockets] == 4']);
      const monarch = item(cid('monarch'), qid('rare'), { [sid('sockets')]: 4 });
      assert.strictEqual(mod.checkItem(monarch), 0);
    });
  });

  describe('flag checks', () => {
    it('matches ethereal flag', () => {
      const mod = compile(['[name] == ring && [quality] == unique && [flag] == ethereal # [maxhp] >= 40']);
      const ethRing = item(cid('ring'), qid('unique'), { [sid('maxhp')]: 40 }, 0x10 | 0x400000);
      assert.strictEqual(mod.checkItem(ethRing), 1);
    });

    it('rejects non-ethereal when eth required', () => {
      const mod = compile(['[name] == ring && [quality] == unique && [flag] == ethereal # [maxhp] >= 40']);
      const nonEth = item(cid('ring'), qid('unique'), { [sid('maxhp')]: 40 }, 0x10);
      assert.strictEqual(mod.checkItem(nonEth), 0);
    });

    it('matches !ethereal', () => {
      const mod = compile(['[name] == ring && [quality] == unique && [flag] != ethereal # [maxhp] >= 40']);
      const nonEth = item(cid('ring'), qid('unique'), { [sid('maxhp')]: 40 }, 0x10);
      assert.strictEqual(mod.checkItem(nonEth), 1);
    });
  });

  describe('range dispatch', () => {
    it('matches item in range', () => {
      const mod = compile(['[name] >= istrune && [name] <= zodrune']);
      assert.strictEqual(mod.checkItem(item(cid('berrune'), qid('normal'))), 1);
    });

    it('rejects item below range', () => {
      const mod = compile(['[name] >= istrune && [name] <= zodrune']);
      assert.strictEqual(mod.checkItem(item(cid('eldrune'), qid('normal'))), 0);
    });
  });

  describe('multi-file', () => {
    it('rules from both files work', () => {
      const mod = compileMulti([
        { name: 'rings.nip', lines: ['[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25'] },
        { name: 'runes.nip', lines: ['[name] == berrune'] },
      ]);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'), { [sid('itemmaxmanapercent')]: 25 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('berrune'), qid('normal'))), 1);
    });

    it('verbose returns correct file', () => {
      const mod = compileMulti([
        { name: 'rings.nip', lines: ['[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25'] },
        { name: 'runes.nip', lines: ['[name] == berrune'] },
      ]);
      const r1 = mod.checkItem(item(cid('ring'), qid('unique'), { [sid('itemmaxmanapercent')]: 25 }), true);
      assert.strictEqual(r1.file, 'rings.nip');
      const r2 = mod.checkItem(item(cid('berrune'), qid('normal')), true);
      assert.strictEqual(r2.file, 'runes.nip');
    });
  });

  describe('tier', () => {
    it('returns highest matching tier', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique # # [tier] == 5',
        '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 # [tier] == 100',
      ]);
      const soj = item(cid('ring'), qid('unique'), { [sid('itemmaxmanapercent')]: 25 });
      assert.strictEqual(mod.getTier(soj), 100);
    });

    it('returns lower tier when high tier stat doesnt match', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique # # [tier] == 5',
        '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 # [tier] == 100',
      ]);
      const ring = item(cid('ring'), qid('unique'), {});
      assert.strictEqual(mod.getTier(ring), 5);
    });

    it('returns -1 for no match', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique # # [tier] == 5',
      ]);
      assert.strictEqual(mod.getTier(item(999, qid('normal'))), -1);
    });
  });

  describe('catch-all rules', () => {
    it('matches flag-only rule (no classid dispatch)', () => {
      const mod = compile(['[flag] == runeword # [sockets] == 4']);
      const rw = item(100, qid('unique'), { [sid('sockets')]: 4 }, 0x10 | 0x4000000);
      assert.strictEqual(mod.checkItem(rw), 1);
    });
  });

  describe('maxquantity', () => {
    it('matches when quantity not exceeded', () => {
      const mod = compile(['[name] == berrune # # [maxquantity] == 5']);
      assert.strictEqual(mod.checkItem(item(cid('berrune'), qid('normal'))), 1);
    });
  });
});
