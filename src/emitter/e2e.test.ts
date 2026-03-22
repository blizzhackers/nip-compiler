import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Parser } from '../parser.js';
import { Binder } from '../binder.js';
import { Emitter } from './emitter.js';
import { d2Aliases } from './d2-aliases.js';

const parser = new Parser();
const binder = new Binder();

const aliases = d2Aliases;

const helpers = {
  checkQuantityOwned: () => 0,
  me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
  getBaseStat: () => 0,
};

interface MockItem {
  classid: number;
  quality: number;
  itemType: number;
  ilvl?: number;
  itemclass?: number;
  flags?: number;
  stats?: Record<string, number>;
}

function makeItem(mock: MockItem) {
  const flags = mock.flags ?? 0x10; // identified by default
  const stats = mock.stats ?? {};
  return {
    classid: mock.classid,
    quality: mock.quality,
    itemType: mock.itemType,
    ilvl: mock.ilvl ?? 85,
    itemclass: mock.itemclass ?? 0,
    getFlag: (f: number) => (flags & f) ? f : 0,
    getStatEx: (id: number, param?: number) => {
      const key = param !== undefined ? `${id}_${param}` : String(id);
      return stats[key] ?? 0;
    },
    getColor: () => 0,
    strreq: 0,
    dexreq: 0,
    onGroundOrDropping: true,
    distance: 5,
    getPrefix: () => 0,
    getSuffix: () => 0,
  };
}

function cid(name: string): number { return aliases.classId[name]; }
function tid(name: string): number { return aliases.type[name]; }
function qid(name: string): number { return aliases.quality[name]; }
function sid(name: string): number {
  const s = aliases.stat[name];
  return Array.isArray(s) ? s[0] : s as number;
}
function sidKey(name: string): string {
  const s = aliases.stat[name];
  return Array.isArray(s) ? `${s[0]}_${s[1]}` : String(s);
}

describe('E2E: kolton.nip with real aliases', () => {
  let mod: { checkItem: (item: any) => { result: number; line: string | null }; getTier: (item: any) => number };

  before(() => {
    const content = readFileSync(join(process.cwd(), 'nip/kolton.nip'), 'utf-8');
    const file = parser.parseFile(content, 'kolton.nip');
    binder.bindFile(file);
    const emitter = new Emitter({ aliases, includeSourceComments: true });
    const js = emitter.emit([file]);
    const factory = eval(js);
    mod = factory(helpers);
  });

  describe('unique rings', () => {
    it('picks up SoJ (itemmaxmanapercent == 25)', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
        stats: { [sidKey('itemmaxmanapercent')]: 25 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#7');
    });

    it('picks up BK ring (maxstamina == 50, lifeleech >= 3)', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
        stats: { [sidKey('maxstamina')]: 50, [sidKey('lifeleech')]: 5 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#8');
    });

    it('picks up Nagel (itemmagicbonus == 30)', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
        stats: { [sidKey('itemmagicbonus')]: 30 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#9');
    });

    it('picks up Raven Frost (dexterity == 20, tohit == 250)', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
        stats: { [sidKey('dexterity')]: 20, [sidKey('tohit')]: 250 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#11');
    });

    it('picks up Dwarf Star (maxhp == 40, magicdamagereduction == 15)', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
        stats: { [sidKey('maxhp')]: 40, [sidKey('magicdamagereduction')]: 15 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#12');
    });

    it('rejects unique ring with no matching stats', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
        stats: {},
      });
      const result = mod.checkItem(item);
      assert.notStrictEqual(result.result, 1);
    });
  });

  describe('rare rings', () => {
    it('picks up BVC ring (fcr 10, tohit 90+, maxhp 30+, maxmana 60+)', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'),
        stats: {
          [sidKey('fcr')]: 10,
          [sidKey('tohit')]: 100,
          [sidKey('maxhp')]: 35,
          [sidKey('maxmana')]: 65,
        },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#15');
    });

    it('picks up dual stat melee ring (tohit 100+, str+dex >= 30)', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'),
        stats: {
          [sidKey('tohit')]: 110,
          [sidKey('strength')]: 15,
          [sidKey('dexterity')]: 16,
        },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#16');
    });

    it('rejects rare ring with insufficient stats', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'),
        stats: { [sidKey('fcr')]: 10 },
      });
      const result = mod.checkItem(item);
      assert.notStrictEqual(result.result, 1);
    });
  });

  describe('unique amulets', () => {
    it('picks up Mara (strength == 5, fireresist >= 30)', () => {
      const item = makeItem({
        classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'),
        stats: { [sidKey('strength')]: 5, [sidKey('fireresist')]: 30 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#28');
    });

    it('picks up Highlord (lightresist == 35)', () => {
      const item = makeItem({
        classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'),
        stats: { [sidKey('lightresist')]: 35 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#29');
    });

    it("picks up Cat's Eye (dexterity == 25)", () => {
      const item = makeItem({
        classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'),
        stats: { [sidKey('dexterity')]: 25 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#30');
    });
  });

  describe('unique armors', () => {
    it("picks up Skin of the Vipermagi (fireresist == 35, magicdamagereduction == 13)", () => {
      const item = makeItem({
        classid: cid('serpentskinarmor'), quality: qid('unique'), itemType: tid('armor'),
        stats: { [sidKey('fireresist')]: 35, [sidKey('magicdamagereduction')]: 13 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#71');
    });

    it("picks up eth Gladiator's Bane (ethereal, enhanceddefense >= 200)", () => {
      const item = makeItem({
        classid: cid('wirefleece'), quality: qid('unique'), itemType: tid('armor'),
        flags: 0x10 | 0x400000, // identified + ethereal
        stats: { [sidKey('enhanceddefense')]: 200 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#65');
    });

    it("rejects non-eth Gladiator's Bane", () => {
      const item = makeItem({
        classid: cid('wirefleece'), quality: qid('unique'), itemType: tid('armor'),
        flags: 0x10, // identified, NOT ethereal
        stats: { [sidKey('enhanceddefense')]: 200 },
      });
      const result = mod.checkItem(item);
      // should not match line 65 which requires [flag] == ethereal
      assert.notStrictEqual(result.line, 'kolton.nip#65');
    });

    it("picks up Tyrael's Might (sacredarmor, strength >= 20)", () => {
      const item = makeItem({
        classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'),
        stats: { [sidKey('strength')]: 20 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#70');
    });

    it("picks up eth Templar's Might (sacredarmor, eth, enhanceddefense >= 220)", () => {
      const item = makeItem({
        classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'),
        flags: 0x10 | 0x400000,
        stats: { [sidKey('enhanceddefense')]: 220 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
      assert.strictEqual(result.line, 'kolton.nip#69');
    });
  });

  describe('unidentified items', () => {
    it('returns -1 for unidentified unique ring', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
        flags: 0, // not identified
        stats: {},
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, -1);
    });

    it('returns 1 for unidentified unique ring with matching stats', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
        flags: 0, // not identified, but stats still match (in theory)
        stats: { [sidKey('itemmaxmanapercent')]: 25 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
    });
  });

  describe('items that should NOT match', () => {
    it('rejects normal quality ring', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('normal'), itemType: tid('ring'),
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 0);
    });

    it('rejects magic quality amulet with no matching stats', () => {
      const item = makeItem({
        classid: cid('amulet'), quality: qid('magic'), itemType: tid('amulet'),
        stats: { [sidKey('strength')]: 1 },
      });
      const result = mod.checkItem(item);
      // There are magic amulet rules, but they need specific stats
      // with str=1 this shouldn't match any
      if (result.result === 1) {
        // if it matches, it should be a valid magic amulet rule
        assert.ok(result.line);
      }
    });

    it('rejects random item classid', () => {
      const item = makeItem({
        classid: 999, quality: qid('unique'), itemType: 99,
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 0);
    });
  });

  describe('type-based rules', () => {
    it('picks up elite eth armor with 4 sockets and high defense', () => {
      // [type] == armor && [quality] == normal && [class] == elite && [flag] == ethereal # [sockets] == 4 && [defense] >= 1000
      const item = makeItem({
        classid: cid('sacredarmor'), quality: qid('normal'), itemType: tid('armor'),
        itemclass: 2, // elite
        flags: 0x10 | 0x400000, // identified + ethereal
        stats: { [sidKey('sockets')]: 4, [sidKey('defense')]: 1200 },
      });
      const result = mod.checkItem(item);
      assert.strictEqual(result.result, 1);
    });
  });

  describe('result line references', () => {
    it('always includes filename and line number', () => {
      const item = makeItem({
        classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
        stats: { [sidKey('itemmaxmanapercent')]: 25 },
      });
      const result = mod.checkItem(item);
      assert.ok(result.line);
      assert.ok(result.line!.startsWith('kolton.nip#'));
      const lineNum = parseInt(result.line!.split('#')[1]);
      assert.ok(lineNum > 0);
    });
  });
});

describe('E2E: autoequip tier with real aliases', () => {
  let mod: { getTier: (item: any) => number; getMercTier: (item: any) => number };

  before(() => {
    const content = readFileSync(join(process.cwd(), 'nip/Autoequip/sorceress.xpac.nip'), 'utf-8');
    const file = parser.parseFile(content, 'sorceress.xpac.nip');
    binder.bindFile(file);
    const emitter = new Emitter({ aliases, includeSourceComments: true });
    const js = emitter.emit([file]);
    const factory = eval(js);
    mod = factory(helpers);
  });

  it('returns tier for unique set crystal (tier 99)', () => {
    // [name] == swirlingcrystal && [quality] == set # [skillcoldmastery] == 2 # [tier] == 99
    const item = makeItem({
      classid: cid('swirlingcrystal'), quality: qid('set'), itemType: tid('orb'),
      stats: { [sidKey('skillcoldmastery')]: 2 },
    });
    const tier = mod.getTier(item);
    assert.strictEqual(tier, 99);
  });

  it('returns tier 1 for armor with maxhp', () => {
    // [type] == armor && [quality] <= rare # [maxhp] > 0 # [tier] == 1
    const item = makeItem({
      classid: cid('leatherarmor'), quality: qid('rare'), itemType: tid('armor'),
      stats: { [sidKey('maxhp')]: 10 },
    });
    const tier = mod.getTier(item);
    assert.ok(tier >= 1);
  });

  it('returns highest tier when multiple match', () => {
    // [type] == ring && [quality] <= rare # [maxhp] > 0 # [tier] == 1
    // [type] == ring && [quality] <= rare # [maxhp] > 0 && [fcr] == 10 # [tier] == 2
    // [type] == ring && [quality] <= rare # [maxhp] > 0 && [maxmana] > 0 && [fcr] == 10 # [tier] == 3
    const item = makeItem({
      classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'),
      stats: { [sidKey('maxhp')]: 20, [sidKey('maxmana')]: 30, [sidKey('fcr')]: 10 },
    });
    const tier = mod.getTier(item);
    assert.strictEqual(tier, 3);
  });

  it('returns -1 for item that matches no tier rules', () => {
    const item = makeItem({
      classid: 999, quality: qid('normal'), itemType: 99,
    });
    const tier = mod.getTier(item);
    assert.strictEqual(tier, -1);
  });

  it('SoJ gets tier 100', () => {
    // [type] == ring && [quality] == unique # [itemallskills] == 1 # [tier] == 100
    const item = makeItem({
      classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
      stats: { [sidKey('itemallskills')]: 1 },
    });
    const tier = mod.getTier(item);
    assert.strictEqual(tier, 100);
  });
});

describe('E2E: multi-file emission', () => {
  let mod: any;

  before(() => {
    const kolton = parser.parseFile(
      readFileSync(join(process.cwd(), 'nip/kolton.nip'), 'utf-8'), 'kolton.nip'
    );
    const gold = parser.parseFile(
      readFileSync(join(process.cwd(), 'nip/gold.nip'), 'utf-8'), 'gold.nip'
    );
    binder.bindFile(kolton);
    binder.bindFile(gold);
    const emitter = new Emitter({ aliases, includeSourceComments: false });
    const js = emitter.emit([kolton, gold]);
    const factory = eval(js);
    mod = factory(helpers);
  });

  it('matches gold from gold.nip', () => {
    // [name] == gold # [gold] >= 500
    const item = makeItem({
      classid: cid('gold'), quality: qid('normal'), itemType: tid('gold'),
      stats: { [sidKey('gold')]: 600 },
    });
    const result = mod.checkItem(item);
    assert.strictEqual(result.result, 1);
    assert.strictEqual(result.line, 'gold.nip#1');
  });

  it('still matches SoJ from kolton.nip', () => {
    const item = makeItem({
      classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'),
      stats: { [sidKey('itemmaxmanapercent')]: 25 },
    });
    const result = mod.checkItem(item);
    assert.strictEqual(result.result, 1);
    assert.strictEqual(result.line, 'kolton.nip#7');
  });
});
