import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vm from 'node:vm';
import { Parser } from '../parser.js';
import { Binder } from '../binder.js';
import { Emitter } from './emitter.js';
import { d2Aliases } from './d2-aliases.js';

const ROOT = process.cwd();
const parser = new Parser();
const binder = new Binder();

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
  const flags = mock.flags ?? 0x10;
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
    getParent: () => null,
    isInStorage: false,
    fname: 'Test Item',
    mode: 0,
    location: 0,
  };
}

function cid(name: string): number { return d2Aliases.classId[name]; }
function tid(name: string): number { return d2Aliases.type[name]; }
function qid(name: string): number { return d2Aliases.quality[name]; }
function sidKey(name: string): string {
  const s = d2Aliases.stat[name];
  return Array.isArray(s) ? `${s[0]}_${s[1]}` : String(s);
}

function createOriginalNTIP(): { addLine: (line: string, file?: string) => void; checkItem: (item: any, verbose?: boolean) => any } {
  const aliasSource = readFileSync(join(ROOT, 'kolbot/d2bs/kolbot/libs/core/GameData/NTItemAlias.js'), 'utf-8');
  const parserSource = readFileSync(join(ROOT, 'kolbot/d2bs/kolbot/libs/core/NTItemParser.js'), 'utf-8');

  const ctx: Record<string, any> = {
    includeIfNotIncluded: () => {},
    console: { log: () => {} },
    ScriptError: class ScriptError extends Error {},
    showConsole: () => {},
    Misc: { errorReport: () => {} },
    getTickCount: () => Date.now(),
    getBaseStat: () => 0,
    me: {
      charlvl: 90, ladder: 1, playertype: 0, gametype: 1,
      realm: 'europe', name: 'TestChar',
      getItemsEx: () => [],
    },
    sdk: {
      items: { mode: { inStorage: 0 }, flags: { Identified: 0x10 } },
      storage: { Stash: 0, Inventory: 0 },
      skills: {
        Valkyrie: 32, Warmth: 37, Inferno: 41, FireBall: 47, FireWall: 51,
        Teleport: 54, Meteor: 56, FireMastery: 61, Hydra: 62, Zeal: 106,
        Vengeance: 111, Whirlwind: 151, Berserk: 152, ArcticBlast: 230,
        Werebear: 228,
      },
    },
  };

  vm.createContext(ctx);
  vm.runInContext(aliasSource, ctx, { filename: 'NTItemAlias.js' });
  // Wrap parser in a function that returns NTIP so we can access it from outside
  const wrappedParser = `(function() {\n${parserSource}\nreturn NTIP;\n})()`;
  const NTIP = vm.runInContext(wrappedParser, ctx, { filename: 'NTItemParser.js' });

  return {
    addLine: (line: string, file?: string) => NTIP.addLine(line, file),
    checkItem: (item: any, verbose?: boolean) => {
      if (verbose) {
        return NTIP.CheckItem(item, undefined, true);
      }
      return NTIP.CheckItem(item);
    },
  };
}

function createOurEmitter(nipLines: string[], filename: string) {
  const content = nipLines.join('\n');
  const file = parser.parseFile(content, filename);
  binder.bindFile(file);
  const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: false });
  const js = emitter.emit([file]);
  const factory = eval(js);
  return factory({
    checkQuantityOwned: () => 0,
    me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
    getBaseStat: () => 0,
  });
}

const TEST_LINES = [
  '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 // soj',
  '[name] == ring && [quality] == unique # [maxstamina] == 50 && [lifeleech] >= 3 // bk',
  '[name] == ring && [quality] == unique # [dexterity] == 20 && [tohit] == 250 // raven',
  '[name] == ring && [quality] == unique # [maxhp] == 40 && [magicdamagereduction] == 15 // dwarf',
  '[name] == ring && [quality] == rare # [fcr] == 10 && [tohit] >= 90 && [maxhp] >= 30 && [maxmana] >= 60 // bvc ring',
  '[name] == ring && [quality] == rare # [tohit] >= 100 && [strength]+[dexterity] >= 30 // dual stat',
  '[name] == amulet && [quality] == unique # [strength] == 5 && [fireresist] >= 30 // mara',
  '[name] == amulet && [quality] == unique # [lightresist] == 35 // highlord',
  '[name] == amulet && [quality] == unique # [dexterity] == 25 // cats eye',
  '[name] == serpentskinarmor && [quality] == unique # [fireresist] == 35 && [magicdamagereduction] == 13 // vipermagi',
  '[name] == wirefleece && [quality] == unique && [flag] == ethereal # [enhanceddefense] >= 200 // eth glad bane',
  '[name] == sacredarmor && [quality] == unique # [strength] >= 20 // tyraels',
  '[name] == sacredarmor && [quality] == unique && [flag] == ethereal # [enhanceddefense] >= 220 // eth templars',
  '[type] == armor && [quality] == normal && [flag] == ethereal # [sockets] == 4 && [defense] >= 1000',
  '[flag] == runeword # [sockets] == 4',
  '[name] == monarch && [quality] <= superior && [flag] != ethereal # [sockets] == 4',
  '[name] == gold # [gold] >= 500',
  '([name] == duskshroud || [name] == wyrmhide || [name] == archonplate) && [quality] <= superior && [flag] != ethereal # [sockets] == 4',
];

interface TestItem {
  label: string;
  mock: MockItem;
}

const TEST_ITEMS: TestItem[] = [
  { label: 'SoJ', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('itemmaxmanapercent')]: 25 } } },
  { label: 'BK ring', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('maxstamina')]: 50, [sidKey('lifeleech')]: 5 } } },
  { label: 'Raven Frost', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('dexterity')]: 20, [sidKey('tohit')]: 250 } } },
  { label: 'Dwarf Star', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('maxhp')]: 40, [sidKey('magicdamagereduction')]: 15 } } },
  { label: 'BVC rare ring', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), stats: { [sidKey('fcr')]: 10, [sidKey('tohit')]: 100, [sidKey('maxhp')]: 35, [sidKey('maxmana')]: 65 } } },
  { label: 'dual stat melee ring', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), stats: { [sidKey('tohit')]: 110, [sidKey('strength')]: 15, [sidKey('dexterity')]: 16 } } },
  { label: 'Mara amulet', mock: { classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'), stats: { [sidKey('strength')]: 5, [sidKey('fireresist')]: 30 } } },
  { label: 'Highlord', mock: { classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'), stats: { [sidKey('lightresist')]: 35 } } },
  { label: "Cat's Eye", mock: { classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'), stats: { [sidKey('dexterity')]: 25 } } },
  { label: 'Vipermagi', mock: { classid: cid('serpentskinarmor'), quality: qid('unique'), itemType: tid('armor'), stats: { [sidKey('fireresist')]: 35, [sidKey('magicdamagereduction')]: 13 } } },
  { label: 'eth Glad Bane', mock: { classid: cid('wirefleece'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddefense')]: 200 } } },
  { label: 'non-eth Glad Bane', mock: { classid: cid('wirefleece'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('enhanceddefense')]: 200 } } },
  { label: "Tyrael's", mock: { classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'), stats: { [sidKey('strength')]: 20 } } },
  { label: "eth Templar's", mock: { classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddefense')]: 220 } } },
  { label: 'eth elite 4os armor', mock: { classid: cid('sacredarmor'), quality: qid('normal'), itemType: tid('armor'), itemclass: 2, flags: 0x10 | 0x400000, stats: { [sidKey('sockets')]: 4, [sidKey('defense')]: 1200 } } },
  { label: 'runeword 4 sockets', mock: { classid: 100, quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x4000000, stats: { [sidKey('sockets')]: 4 } } },
  { label: '4os non-eth monarch', mock: { classid: cid('monarch'), quality: qid('normal'), itemType: tid('shield'), flags: 0x10, stats: { [sidKey('sockets')]: 4 } } },
  { label: 'gold 600', mock: { classid: cid('gold'), quality: qid('normal'), itemType: tid('gold'), stats: { [sidKey('gold')]: 600 } } },
  { label: 'normal ring (no match)', mock: { classid: cid('ring'), quality: qid('normal'), itemType: tid('ring') } },
  { label: 'random junk (no match)', mock: { classid: 999, quality: qid('normal'), itemType: 99 } },
  { label: 'unique ring no stats (no match)', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: {} } },
  { label: 'unidentified SoJ', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), flags: 0, stats: { [sidKey('itemmaxmanapercent')]: 25 } } },
  { label: 'unidentified unique ring', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), flags: 0, stats: {} } },
  { label: '4os non-eth archonplate', mock: { classid: cid('archonplate'), quality: qid('normal'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('sockets')]: 4 } } },
  { label: '4os non-eth duskshroud', mock: { classid: cid('duskshroud'), quality: qid('normal'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('sockets')]: 4 } } },
];

describe('Cross-validation: our emitter vs original NTIP', () => {
  let original: ReturnType<typeof createOriginalNTIP>;
  let ours: ReturnType<typeof createOurEmitter>;

  before(() => {
    original = createOriginalNTIP();
    for (const line of TEST_LINES) {
      original.addLine(line, 'test.nip');
    }
    ours = createOurEmitter(TEST_LINES, 'test.nip');
  });

  for (const testItem of TEST_ITEMS) {
    it(`agrees on "${testItem.label}"`, () => {
      const item = makeItem(testItem.mock);
      const origResult = original.checkItem(item);
      const ourResult = ours.checkItem(item);

      assert.strictEqual(
        ourResult, origResult,
        `Mismatch for "${testItem.label}": ours=${ourResult}, original=${origResult}`
      );
    });
  }

  it('agrees on all items in verbose mode', () => {
    for (const testItem of TEST_ITEMS) {
      const item = makeItem(testItem.mock);
      const origResult = original.checkItem(item, true);
      const ourResult = ours.checkItem(item, true);

      assert.strictEqual(
        ourResult.result, origResult.result,
        `Verbose result mismatch for "${testItem.label}": ours=${ourResult.result}, original=${origResult.result}`
      );
    }
  });
});

describe('Benchmark: our emitter vs original NTIP', () => {
  let original: ReturnType<typeof createOriginalNTIP>;
  let ours: ReturnType<typeof createOurEmitter>;
  let items: ReturnType<typeof makeItem>[];

  before(() => {
    // Use full kolton.nip
    const koltonContent = readFileSync(join(ROOT, 'nip/kolton.nip'), 'utf-8');
    const koltonLines = koltonContent.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('//'));

    original = createOriginalNTIP();
    for (const line of koltonLines) {
      try { original.addLine(line, 'kolton.nip'); } catch {}
    }
    ours = createOurEmitter(koltonLines, 'kolton.nip');

    items = TEST_ITEMS.map(t => makeItem(t.mock));
  });

  it('benchmarks original NTIP.CheckItem', () => {
    const iterations = 10000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      for (const item of items) {
        original.checkItem(item);
      }
    }
    const elapsed = performance.now() - start;
    const opsPerSec = Math.round((iterations * items.length) / (elapsed / 1000));
    console.log(`  Original NTIP: ${elapsed.toFixed(1)}ms for ${iterations * items.length} checks (${opsPerSec.toLocaleString()} ops/s)`);
  });

  it('benchmarks our emitter checkItem', () => {
    const iterations = 10000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      for (const item of items) {
        ours.checkItem(item);
      }
    }
    const elapsed = performance.now() - start;
    const opsPerSec = Math.round((iterations * items.length) / (elapsed / 1000));
    console.log(`  Our emitter:   ${elapsed.toFixed(1)}ms for ${iterations * items.length} checks (${opsPerSec.toLocaleString()} ops/s)`);
  });
});
