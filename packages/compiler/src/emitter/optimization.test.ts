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

    it('matches every individual item in the range', () => {
      const mod = compile(['[name] >= istrune && [name] <= zodrune']);
      const runes = ['istrune', 'gulrune', 'vexrune', 'ohmrune', 'lorune', 'surrune', 'berrune', 'jahrune', 'chamrune', 'zodrune'];
      for (const r of runes) {
        assert.strictEqual(mod.checkItem(item(cid(r), qid('normal'))), 1, `expected ${r} to match`);
      }
    });

    it('rejects item above range', () => {
      const mod = compile(['[name] >= istrune && [name] <= zodrune']);
      assert.strictEqual(mod.checkItem(item(cid('zodrune') + 1, qid('normal'))), 0);
    });

    it('rejects item just below range', () => {
      const mod = compile(['[name] >= istrune && [name] <= zodrune']);
      assert.strictEqual(mod.checkItem(item(cid('istrune') - 1, qid('normal'))), 0);
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

    it('returns -1 for unid item matching catch-all flag but failing stats', () => {
      const mod = compile(['[flag] == runeword # [sockets] == 4']);
      // unid (flags has runeword but NOT identified)
      const rw = item(100, qid('unique'), {}, 0x4000000);
      assert.strictEqual(mod.checkItem(rw), -1);
    });
  });

  describe('maxquantity', () => {
    it('matches when quantity not exceeded', () => {
      const mod = compile(['[name] == berrune # # [maxquantity] == 5']);
      assert.strictEqual(mod.checkItem(item(cid('berrune'), qid('normal'))), 1);
    });
  });

  describe('complement if/else chaining', () => {
    it('matches eth branch for eth item', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique && [flag] == ethereal # [maxhp] >= 40',
        '[name] == ring && [quality] == unique && [flag] != ethereal # [maxmana] >= 30',
      ]);
      const eth = item(cid('ring'), qid('unique'), { [sid('maxhp')]: 40 }, 0x10 | 0x400000);
      assert.strictEqual(mod.checkItem(eth), 1);
    });

    it('matches non-eth branch for non-eth item', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique && [flag] == ethereal # [maxhp] >= 40',
        '[name] == ring && [quality] == unique && [flag] != ethereal # [maxmana] >= 30',
      ]);
      const nonEth = item(cid('ring'), qid('unique'), { [sid('maxmana')]: 30 }, 0x10);
      assert.strictEqual(mod.checkItem(nonEth), 1);
    });

    it('rejects eth item failing eth branch stats', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique && [flag] == ethereal # [maxhp] >= 40',
        '[name] == ring && [quality] == unique && [flag] != ethereal # [maxmana] >= 30',
      ]);
      const eth = item(cid('ring'), qid('unique'), {}, 0x10 | 0x400000);
      assert.strictEqual(mod.checkItem(eth), 0);
    });

    it('verbose reports correct line for complement branches', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique && [flag] == ethereal # [maxhp] >= 40',
        '[name] == ring && [quality] == unique && [flag] != ethereal # [maxmana] >= 30',
      ]);
      const eth = item(cid('ring'), qid('unique'), { [sid('maxhp')]: 40 }, 0x10 | 0x400000);
      const r1 = mod.checkItem(eth, true);
      assert.strictEqual(r1.result, 1);
      assert.strictEqual(r1.line, 1);

      const nonEth = item(cid('ring'), qid('unique'), { [sid('maxmana')]: 30 }, 0x10);
      const r2 = mod.checkItem(nonEth, true);
      assert.strictEqual(r2.result, 1);
      assert.strictEqual(r2.line, 2);
    });
  });

  describe('quality sub-dispatch', () => {
    it('routes to correct quality branch', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25',
        '[name] == ring && [quality] == rare # [maxhp] >= 30',
        '[name] == ring && [quality] == magic # [maxmana] >= 20',
      ]);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'), { [sid('itemmaxmanapercent')]: 25 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('maxhp')]: 30 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('magic'), { [sid('maxmana')]: 20 })), 1);
    });

    it('rejects mismatched quality', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25',
        '[name] == ring && [quality] == rare # [maxhp] >= 30',
      ]);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('magic'), { [sid('itemmaxmanapercent')]: 25 })), 0);
    });
  });

  describe('shared condition grouping', () => {
    it('groups rules sharing a flag condition', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique && [flag] == ethereal # [maxhp] >= 40',
        '[name] == ring && [quality] == unique && [flag] == ethereal # [maxmana] >= 30',
      ]);
      const eth = item(cid('ring'), qid('unique'), { [sid('maxhp')]: 40, [sid('maxmana')]: 30 }, 0x10 | 0x400000);
      assert.strictEqual(mod.checkItem(eth), 1);
    });

    it('second grouped rule matches when first fails', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique && [flag] == ethereal # [maxhp] >= 100',
        '[name] == ring && [quality] == unique && [flag] == ethereal # [maxmana] >= 30',
      ]);
      const eth = item(cid('ring'), qid('unique'), { [sid('maxmana')]: 30 }, 0x10 | 0x400000);
      const result = mod.checkItem(eth, true);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 2);
    });
  });

  describe('identical classid dedup', () => {
    it('matches either classid when rules are identical', () => {
      const mod = compile([
        '[name] == ring # [maxhp] >= 20',
        '[name] == amulet # [maxhp] >= 20',
      ]);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 20 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('amulet'), qid('normal'), { [sid('maxhp')]: 20 })), 1);
    });

    it('rejects non-matching classid', () => {
      const mod = compile([
        '[name] == ring # [maxhp] >= 20',
        '[name] == amulet # [maxhp] >= 20',
      ]);
      assert.strictEqual(mod.checkItem(item(cid('monarch'), qid('normal'), { [sid('maxhp')]: 20 })), 0);
    });
  });

  describe('hoisted stat reuse', () => {
    it('works when same stat used in range check', () => {
      const mod = compile([
        '[name] == ring && [quality] == rare # [maxhp] >= 30 && [maxhp] <= 50',
      ]);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('maxhp')]: 30 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('maxhp')]: 50 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('maxhp')]: 29 })), 0);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('maxhp')]: 51 })), 0);
    });

    it('works with multiple hoisted stats', () => {
      const mod = compile([
        '[name] == ring && [quality] == rare # [maxhp] >= 30 && [maxhp] <= 50 && [maxmana] >= 20 && [maxmana] <= 40',
      ]);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('maxhp')]: 40, [sid('maxmana')]: 30 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('maxhp')]: 40, [sid('maxmana')]: 10 })), 0);
    });
  });

  describe('OR conditions', () => {
    it('matches either side of OR in properties', () => {
      const mod = compile(['([name] == ring || [name] == amulet) && [quality] == unique']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'))), 1);
      assert.strictEqual(mod.checkItem(item(cid('amulet'), qid('unique'))), 1);
      assert.strictEqual(mod.checkItem(item(cid('monarch'), qid('unique'))), 0);
    });
  });

  describe('me keyword', () => {
    it('matches charlvl condition', () => {
      const mod = compile(['[name] == ring && [quality] == unique && [charlvl] >= 85']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'))), 1);
    });

    it('rejects when charlvl too low', () => {
      const helpersLow = { ...helpers, me: { ...helpers.me, charlvl: 50 } };
      const file = parser.parseFile('[name] == ring && [quality] == unique && [charlvl] >= 85', 'test.nip');
      binder.bindFile(file);
      const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: false });
      const js = emitter.emit([file]);
      const mod = eval(js)(helpersLow);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'))), 0);
    });

    it('matches ladder condition', () => {
      const mod = compile(['[name] == ring && [ladder] == 1']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'))), 1);
    });

    it('rejects ladder when not on ladder', () => {
      const helpersNoLadder = { ...helpers, me: { ...helpers.me, ladder: 0 } };
      const file = parser.parseFile('[name] == ring && [ladder] == 1', 'test.nip');
      binder.bindFile(file);
      const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: false });
      const js = emitter.emit([file]);
      const mod = eval(js)(helpersNoLadder);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'))), 0);
    });
  });

  describe('type dispatch', () => {
    it('matches by item type', () => {
      // type 10 = ring
      const mod = compile(['[type] == ring']);
      const ringItem = { ...item(cid('ring'), qid('normal')), itemType: 10 };
      assert.strictEqual(mod.checkItem(ringItem), 1);
    });

    it('rejects wrong type', () => {
      const mod = compile(['[type] == ring']);
      const amuletItem = { ...item(cid('amulet'), qid('normal')), itemType: 12 };
      assert.strictEqual(mod.checkItem(amuletItem), 0);
    });

    it('matches type range', () => {
      // scepter=24, wand=25, staff=26, bow=27, axe=28
      const mod = compile(['[type] >= scepter && [type] <= axe']);
      const wand = { ...item(100, qid('normal')), itemType: 25 };
      const bow = { ...item(200, qid('normal')), itemType: 27 };
      const ring = { ...item(cid('ring'), qid('normal')), itemType: 10 };
      assert.strictEqual(mod.checkItem(wand), 1);
      assert.strictEqual(mod.checkItem(bow), 1);
      assert.strictEqual(mod.checkItem(ring), 0);
    });
  });

  describe('class dispatch', () => {
    it('matches by item class', () => {
      const mod = compile(['[name] == ring && [class] == normal']);
      const normalRing = { ...item(cid('ring'), qid('normal')), itemclass: 0 };
      assert.strictEqual(mod.checkItem(normalRing), 1);
    });

    it('rejects wrong class', () => {
      const mod = compile(['[name] == ring && [class] == elite']);
      const normalRing = { ...item(cid('ring'), qid('normal')), itemclass: 0 };
      assert.strictEqual(mod.checkItem(normalRing), 0);
    });
  });

  describe('stat operators', () => {
    it('> (greater than, non-inclusive)', () => {
      const mod = compile(['[name] == ring # [maxhp] > 30']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 31 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 30 })), 0);
    });

    it('< (less than, non-inclusive)', () => {
      const mod = compile(['[name] == ring # [maxhp] < 50']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 49 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 50 })), 0);
    });

    it('<= (less than or equal)', () => {
      const mod = compile(['[name] == ring # [maxhp] <= 40']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 40 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 41 })), 0);
    });

    it('!= (not equal)', () => {
      const mod = compile(['[name] == ring # [maxhp] != 0']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 10 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 0 })), 0);
    });
  });

  describe('OR in stat section', () => {
    it('matches when first OR branch passes', () => {
      const mod = compile(['[name] == ring # [maxhp] >= 40 || [maxmana] >= 30']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 40 })), 1);
    });

    it('matches when second OR branch passes', () => {
      const mod = compile(['[name] == ring # [maxhp] >= 40 || [maxmana] >= 30']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxmana')]: 30 })), 1);
    });

    it('rejects when neither OR branch passes', () => {
      const mod = compile(['[name] == ring # [maxhp] >= 40 || [maxmana] >= 30']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 10, [sid('maxmana')]: 10 })), 0);
    });
  });

  describe('property keywords', () => {
    it('[level] (ilvl) check', () => {
      const mod = compile(['[name] == ring && [level] >= 85']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'))), 1); // ilvl=85 from item()
    });

    it('[level] rejects low ilvl', () => {
      const mod = compile(['[name] == ring && [level] >= 90']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'))), 0); // ilvl=85
    });

    it('[strreq] check', () => {
      const mod = compile(['[name] == monarch && [strreq] > 0']);
      const shield = { ...item(cid('monarch'), qid('normal')), strreq: 156 };
      assert.strictEqual(mod.checkItem(shield), 1);
    });

    it('[strreq] rejects zero', () => {
      const mod = compile(['[name] == ring && [strreq] > 0']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'))), 0); // strreq=0 from item()
    });

    it('[dexreq] check', () => {
      const mod = compile(['[name] == ring && [dexreq] > 10']);
      const ring = { ...item(cid('ring'), qid('normal')), dexreq: 50 };
      assert.strictEqual(mod.checkItem(ring), 1);
    });

    it('[color] check', () => {
      const mod = compile(['[name] == ring && [color] == 3']);
      const blackRing = { ...item(cid('ring'), qid('normal')), getColor: () => 3 };
      assert.strictEqual(mod.checkItem(blackRing), 1);
    });

    it('[color] rejects wrong color', () => {
      const mod = compile(['[name] == ring && [color] == 3']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'))), 0); // getColor()=0
    });
  });

  describe('getBaseStat keywords', () => {
    it('[minimumsockets] via getBaseStat', () => {
      const helpersWithBase = {
        ...helpers,
        getBaseStat: (table: string, classid: number, col: string) => {
          if (table === 'items' && col === 'gemsockets') return 4;
          return 0;
        },
      };
      const file = parser.parseFile('[name] == monarch && [minimumsockets] >= 4', 'test.nip');
      binder.bindFile(file);
      const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: false });
      const js = emitter.emit([file]);
      const mod = eval(js)(helpersWithBase);
      assert.strictEqual(mod.checkItem(item(cid('monarch'), qid('normal'))), 1);
    });
  });

  describe('unid bail with base stats', () => {
    it('does NOT bail on defense-only rule (base stat readable on unid)', () => {
      const mod = compile(['[name] == monarch && [quality] == unique # [defense] >= 100']);
      // unid item (flags=0) but defense(31) is a BASE_STAT — should evaluate, not bail
      const shield = item(cid('monarch'), qid('unique'), { [sid('defense')]: 150 }, 0);
      assert.strictEqual(mod.checkItem(shield), 1);
    });

    it('bails on magical-stat-only rule when unid', () => {
      const mod = compile(['[name] == ring && [quality] == unique # [fcr] >= 10']);
      // unid (flags=0), fcr is magical — should bail with -1
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'), { [sid('fcr')]: 10 }, 0)), -1);
    });

    it('evaluates fully when mix of base + magical stats (no bail)', () => {
      const mod = compile(['[name] == monarch && [quality] == unique # [defense] >= 100 && [fcr] >= 10']);
      // Mixed: defense is base, fcr is magical. usesMagicalStatsOnly=false → no bail, runs fully
      const shield = item(cid('monarch'), qid('unique'), { [sid('defense')]: 150, [sid('fcr')]: 10 }, 0);
      assert.strictEqual(mod.checkItem(shield), 1);
    });
  });

  describe('empty property section', () => {
    it('stat-only rule matches any item', () => {
      const mod = compile(['# [maxhp] >= 40']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 40 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('amulet'), qid('rare'), { [sid('maxhp')]: 40 })), 1);
    });

    it('stat-only rule rejects when stat fails', () => {
      const mod = compile(['# [maxhp] >= 40']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), { [sid('maxhp')]: 10 })), 0);
    });
  });

  describe('negated flag', () => {
    it('[flag] != runeword matches non-runeword', () => {
      const mod = compile(['[name] == ring && [flag] != runeword']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), {}, 0x10)), 1);
    });

    it('[flag] != runeword rejects runeword', () => {
      const mod = compile(['[name] == ring && [flag] != runeword']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'), {}, 0x10 | 0x4000000)), 0);
    });
  });

  describe('prefix/suffix', () => {
    it('[prefix] == value matches', () => {
      const mod = compile(['[name] == ring && [prefix] == 5']);
      const ring = { ...item(cid('ring'), qid('normal')), getPrefix: () => 5 };
      assert.strictEqual(mod.checkItem(ring), 1);
    });

    it('[prefix] == value rejects mismatch', () => {
      const mod = compile(['[name] == ring && [prefix] == 5']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'))), 0); // getPrefix()=0
    });

    it('[prefix] != value matches non-matching', () => {
      const mod = compile(['[name] == ring && [prefix] != 5']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'))), 1); // getPrefix()=0 != 5
    });

    it('[suffix] == value matches', () => {
      const mod = compile(['[name] == ring && [suffix] == 3']);
      const ring = { ...item(cid('ring'), qid('normal')), getSuffix: () => 3 };
      assert.strictEqual(mod.checkItem(ring), 1);
    });
  });

  describe('complex AND/OR combos', () => {
    it('AND in stats with OR in properties', () => {
      const mod = compile(['([name] == ring || [name] == amulet) && [quality] == rare # [maxhp] >= 20 && [maxmana] >= 10']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('maxhp')]: 20, [sid('maxmana')]: 10 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('amulet'), qid('rare'), { [sid('maxhp')]: 20, [sid('maxmana')]: 10 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('maxhp')]: 20 })), 0);
    });

    it('OR in stats with AND in properties', () => {
      const mod = compile(['[name] == ring && [quality] == rare # [maxhp] >= 40 || [maxmana] >= 30']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('rare'), { [sid('maxmana')]: 30 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('unique'), { [sid('maxmana')]: 30 })), 0);
    });
  });

  describe('distance', () => {
    it('[distance] check for ground items', () => {
      const mod = compile(['[name] == ring && [distance] < 10']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'))), 1); // distance=5 from item()
    });

    it('[distance] rejects far items', () => {
      const mod = compile(['[name] == ring && [distance] < 3']);
      assert.strictEqual(mod.checkItem(item(cid('ring'), qid('normal'))), 0); // distance=5
    });
  });

  describe('merctier', () => {
    it('returns merctier value', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique # [maxhp] >= 20 # [merctier] == 50',
      ]);
      const ring = item(cid('ring'), qid('unique'), { [sid('maxhp')]: 20 });
      assert.strictEqual(mod.getMercTier(ring), 50);
    });

    it('returns -1 for no merctier match', () => {
      const mod = compile([
        '[name] == ring && [quality] == unique # [maxhp] >= 20 # [merctier] == 50',
      ]);
      assert.strictEqual(mod.getMercTier(item(999, qid('normal'))), -1);
    });
  });

  describe('impossible quality filtering', () => {
    it('rune with no quality restriction matches any quality', () => {
      const mod = compile(['[name] == berrune']);
      assert.strictEqual(mod.checkItem(item(cid('berrune'), qid('normal'))), 1);
      assert.strictEqual(mod.checkItem(item(cid('berrune'), qid('unique'))), 1);
    });

    it('rune never needs unid bail (always identified)', () => {
      const mod = compile(['[name] == berrune']);
      assert.strictEqual(mod.checkItem(item(cid('berrune'), qid('normal'), {}, 0)), 1);
    });

    it('rune quality==magic is impossible (dead code)', () => {
      const mod = compile(['[name] == berrune && [quality] == magic']);
      assert.strictEqual(mod.checkItem(item(cid('berrune'), qid('magic'))), 0);
    });

    it('charm quality==rare is impossible', () => {
      const mod = compile([
        '[name] == smallcharm && [quality] == magic # [maxhp] >= 20',
        '[name] == smallcharm && [quality] == rare # [maxhp] >= 20',
      ]);
      assert.strictEqual(mod.checkItem(item(cid('smallcharm'), qid('magic'), { [sid('maxhp')]: 20 })), 1);
      assert.strictEqual(mod.checkItem(item(cid('smallcharm'), qid('rare'), { [sid('maxhp')]: 20 })), 0);
    });

    it('charm quality==unique is valid', () => {
      const mod = compile(['[name] == smallcharm && [quality] == unique # [maxhp] >= 20']);
      assert.strictEqual(mod.checkItem(item(cid('smallcharm'), qid('unique'), { [sid('maxhp')]: 20 })), 1);
    });

    it('charm quality==set is impossible', () => {
      const mod = compile(['[name] == smallcharm && [quality] == set # [maxhp] >= 20']);
      assert.strictEqual(mod.checkItem(item(cid('smallcharm'), qid('set'), { [sid('maxhp')]: 20 })), 0);
    });

    it('charm quality==crafted is impossible', () => {
      const mod = compile(['[name] == smallcharm && [quality] == crafted # [maxhp] >= 20']);
      assert.strictEqual(mod.checkItem(item(cid('smallcharm'), qid('crafted'), { [sid('maxhp')]: 20 })), 0);
    });

    it('gold quality==rare is impossible', () => {
      const mod = compile(['[name] == gold && [quality] == rare # [gold] >= 500']);
      assert.strictEqual(mod.checkItem(item(cid('gold'), qid('rare'), { [sid('gold')]: 500 })), 0);
    });

    it('type-expanded rule works for valid quality', () => {
      const mod = compile(['[type] == armor && [quality] == rare # [enhanceddefense] >= 100']);
      const rareArmor = { ...item(cid('archonplate'), qid('rare'), { [sid('enhanceddefense')]: 100 }), itemType: 3 };
      assert.strictEqual(mod.checkItem(rareArmor), 1);
    });
  });
});
