import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as vm from 'node:vm';
import { Parser } from '../parser.js';
import { Binder } from '../binder.js';
import { Emitter } from './emitter.js';
import { DispatchStrategy } from './types.js';
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
  _prefix?: number;
  _suffix?: number;
}

function makeItem(mock: MockItem) {
  const flags = mock.flags ?? 0x10;
  const stats = mock.stats ?? {};
  const prefix = mock._prefix ?? 0;
  const suffix = mock._suffix ?? 0;
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
    getPrefix: (v: number) => v === prefix ? v : 0,
    getSuffix: (v: number) => v === suffix ? v : 0,
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
  const aliasSource = readFileSync(join(ROOT, 'src/emitter/reference/NTItemAlias.js'), 'utf-8');
  const parserSource = readFileSync(join(ROOT, 'src/emitter/reference/NTItemParser.js'), 'utf-8');

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

const HELPERS = {
  checkQuantityOwned: () => 0,
  me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
  getBaseStat: () => 0,
};

function createOurEmitter(nipLines: string[], filename: string, strategy?: DispatchStrategy) {
  const content = nipLines.join('\n');
  const file = parser.parseFile(content, filename);
  binder.bindFile(file);
  const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: false, dispatchStrategy: strategy });
  const js = emitter.emit([file]);
  const factory = eval(js);
  return factory(HELPERS);
}

function createOurEmitterInVM(nipLines: string[], filename: string, strategy?: DispatchStrategy) {
  const content = nipLines.join('\n');
  const file = parser.parseFile(content, filename);
  binder.bindFile(file);
  const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: false, dispatchStrategy: strategy });
  const js = emitter.emit([file]);
  const ctx: Record<string, any> = { helpers: HELPERS };
  vm.createContext(ctx);
  const factory = vm.runInContext(js, ctx, { filename: 'emitted.js' });
  return factory(HELPERS);
}

function createMultiFileEmitterInVM(
  fileEntries: { lines: string[]; filename: string }[],
  strategy?: DispatchStrategy,
) {
  const files = fileEntries.map(({ lines, filename }) => {
    const file = parser.parseFile(lines.join('\n'), filename);
    binder.bindFile(file);
    return file;
  });
  const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: false, dispatchStrategy: strategy });
  const js = emitter.emit(files);
  const ctx: Record<string, any> = { helpers: HELPERS };
  vm.createContext(ctx);
  const factory = vm.runInContext(js, ctx, { filename: 'emitted.js' });
  return factory(HELPERS);
}

const TEST_LINES = [
  // Unique rings
  '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 // soj',
  '[name] == ring && [quality] == unique # [maxstamina] == 50 && [lifeleech] >= 3 // bk',
  '[name] == ring && [quality] == unique # [dexterity] == 20 && [tohit] == 250 // raven',
  '[name] == ring && [quality] == unique # [maxhp] == 40 && [magicdamagereduction] == 15 // dwarf',
  '[name] == ring && [quality] == unique # [itemabsorblightpercent] >= 20 || [itemmagicbonus] >= 20 && [itemabsorblightpercent] >= 10 // wisp',
  // Rare rings
  '[name] == ring && [quality] == rare # [fcr] == 10 && [tohit] >= 90 && [maxhp] >= 30 && [maxmana] >= 60 // bvc ring',
  '[name] == ring && [quality] == rare # [tohit] >= 100 && [strength]+[dexterity] >= 30 // dual stat',
  '[name] == ring && [quality] == rare # [fcr] == 10 && [dexterity] >= 12 && [maxhp] >= 30 && ([fireresist] >= 20 || [lightresist] >= 20 || [fireresist] >= 9 && [lightresist] >= 9) // hdin ring',
  // Magic rings
  '[name] == ring && [quality] == magic # [fcr] == 10 && [maxmana] >= 100 // caster ring',
  // Unique amulets
  '[name] == amulet && [quality] == unique # [strength] == 5 && [fireresist] >= 30 // mara',
  '[name] == amulet && [quality] == unique # [lightresist] == 35 // highlord',
  '[name] == amulet && [quality] == unique # [dexterity] == 25 // cats eye',
  '[name] == amulet && [quality] == unique # [tohit] >= 450 && [plusdefense] >= 350 && [fireresist] >= 35 // metalgrid',
  // Magic amulet
  '[name] == amulet && [quality] == magic # [itemmagicbonus] == 50 // magic mf ammy',
  // Unique armors — non-eth
  '[name] == serpentskinarmor && [quality] == unique # [fireresist] == 35 && [magicdamagereduction] == 13 // vipermagi',
  // Unique armors — eth required
  '[name] == wirefleece && [quality] == unique && [flag] == ethereal # [enhanceddefense] >= 200 // eth glad bane',
  '[name] == sacredarmor && [quality] == unique && [flag] == ethereal # [enhanceddefense] >= 220 // eth templars',
  '[name] == balrogskin && [quality] == unique && [flag] == ethereal # [itemallskills] == 2 && [enhanceddefense] >= 180 // eth arkaines',
  '[name] == mesharmor && [quality] == unique && [flag] == ethereal # [enhanceddefense] == 220 // eth shaftstop',
  // Unique armors — no eth restriction
  '[name] == sacredarmor && [quality] == unique # [strength] >= 20 // tyraels',
  // Unique armors — non-eth required
  '[name] == duskshroud && [quality] == unique && [flag] != ethereal # [passivecoldmastery] == 15 && [skillblizzard] == 3 // ormus cold',
  '[name] == duskshroud && [quality] == unique && [flag] != ethereal # [passivefiremastery] == 15 && [skillfireball] == 3 // ormus fire',
  // White bases
  '([name] == duskshroud || [name] == wyrmhide || [name] == archonplate) && [quality] <= superior && [flag] != ethereal # ([sockets] == 3 || [sockets] == 4)',
  '[name] == monarch && [quality] <= superior && [flag] != ethereal # [sockets] == 4',
  '[name] == monarch && [quality] == normal && [flag] == ethereal # [sockets] == 0 && [defense] == 148 || [sockets] == 4 && [defense] == 148',
  // Type-based rules
  '[type] == armor && [quality] == normal && [flag] == ethereal # [sockets] == 4 && [defense] >= 1000',
  '[type] == armor && [quality] == rare && [flag] == ethereal # [enhanceddefense] >= 150 && [sockets] == 2',
  '[type] == armor && [quality] == magic && [flag] != ethereal # [sockets] == 4 && [maxhp] >= 100',
  // Catch-all
  '[flag] == runeword # [sockets] == 4',
  // Gold
  '[name] == gold # [gold] >= 500',
  // Shields
  '[name] == monarch && [quality] == unique # [enhanceddefense] >= 150 // stormshield',
  // Weapons
  '[name] == phaseblade && [quality] == unique # [enhanceddefense] >= 300 // grief base',
  '[name] == berserkeraxe && [quality] == unique && [flag] == ethereal # [enhanceddamage] >= 370 // eth beast',
  // Helms
  '[name] == shako && [quality] == unique # [itemallskills] == 2 // harlequin',
  '[name] == demonhead && [quality] == unique && [flag] != ethereal # [strength] == 30 && [enhanceddefense] == 150 // andys',
  // Gloves/boots/belts
  '[name] == vampirebonegloves && [quality] == unique && [flag] != ethereal # [enhanceddefense] == 120 && [strength] == 15 // draculs',
  '[name] == mithrilcoil && [quality] == unique && [flag] != ethereal # [damageresist] == 15 && [vitality] == 40 // verdungos',
  // Set items
  '[name] == lacqueredplate && [quality] == set // tal armor',
  '[name] == swirlingcrystal && [quality] == set # [skillcoldmastery] == 2 // tal weapon',
  // Prefix/suffix
  '[name] == ring && [quality] == rare && [prefix] == 10 # [fcr] == 10',
  '[name] == ring && [quality] == rare && [suffix] == 20',
  // Runes
  '[name] == berrune // ber rune',
  '[name] == jahrune // jah rune',
  '[name] == istrune // ist rune',
];

interface TestItem {
  label: string;
  mock: MockItem;
}

const TEST_ITEMS: TestItem[] = [
  // --- Unique rings ---
  { label: 'SoJ', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('itemmaxmanapercent')]: 25 } } },
  { label: 'BK ring', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('maxstamina')]: 50, [sidKey('lifeleech')]: 5 } } },
  { label: 'Raven Frost', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('dexterity')]: 20, [sidKey('tohit')]: 250 } } },
  { label: 'Dwarf Star', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('maxhp')]: 40, [sidKey('magicdamagereduction')]: 15 } } },
  { label: 'Wisp (absorb path)', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('itemabsorblightpercent')]: 20 } } },
  { label: 'Wisp (mf+absorb path)', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('itemmagicbonus')]: 25, [sidKey('itemabsorblightpercent')]: 10 } } },
  { label: 'bad unique ring (no match)', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: {} } },
  { label: 'imperfect BK (lifeleech too low)', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), stats: { [sidKey('maxstamina')]: 50, [sidKey('lifeleech')]: 2 } } },
  // --- Rare rings ---
  { label: 'BVC rare ring', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), stats: { [sidKey('fcr')]: 10, [sidKey('tohit')]: 100, [sidKey('maxhp')]: 35, [sidKey('maxmana')]: 65 } } },
  { label: 'dual stat melee ring', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), stats: { [sidKey('tohit')]: 110, [sidKey('strength')]: 15, [sidKey('dexterity')]: 16 } } },
  { label: 'hdin ring (fire res path)', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), stats: { [sidKey('fcr')]: 10, [sidKey('dexterity')]: 15, [sidKey('maxhp')]: 35, [sidKey('fireresist')]: 25 } } },
  { label: 'hdin ring (dual res path)', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), stats: { [sidKey('fcr')]: 10, [sidKey('dexterity')]: 12, [sidKey('maxhp')]: 30, [sidKey('fireresist')]: 10, [sidKey('lightresist')]: 10 } } },
  { label: 'bad rare ring (no match)', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), stats: { [sidKey('fcr')]: 10 } } },
  // --- Magic rings ---
  { label: 'magic caster ring', mock: { classid: cid('ring'), quality: qid('magic'), itemType: tid('ring'), stats: { [sidKey('fcr')]: 10, [sidKey('maxmana')]: 110 } } },
  { label: 'bad magic ring (no match)', mock: { classid: cid('ring'), quality: qid('magic'), itemType: tid('ring'), stats: { [sidKey('maxmana')]: 50 } } },
  // --- Unique amulets ---
  { label: 'Mara', mock: { classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'), stats: { [sidKey('strength')]: 5, [sidKey('fireresist')]: 30 } } },
  { label: 'Highlord', mock: { classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'), stats: { [sidKey('lightresist')]: 35 } } },
  { label: "Cat's Eye", mock: { classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'), stats: { [sidKey('dexterity')]: 25 } } },
  { label: 'Metalgrid', mock: { classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'), stats: { [sidKey('tohit')]: 500, [sidKey('plusdefense')]: 400, [sidKey('fireresist')]: 35 } } },
  // --- Magic amulet ---
  { label: 'magic 50mf ammy', mock: { classid: cid('amulet'), quality: qid('magic'), itemType: tid('amulet'), stats: { [sidKey('itemmagicbonus')]: 50 } } },
  { label: 'bad magic ammy (no match)', mock: { classid: cid('amulet'), quality: qid('magic'), itemType: tid('amulet'), stats: { [sidKey('itemmagicbonus')]: 20 } } },
  // --- Unique armors ---
  { label: 'Vipermagi', mock: { classid: cid('serpentskinarmor'), quality: qid('unique'), itemType: tid('armor'), stats: { [sidKey('fireresist')]: 35, [sidKey('magicdamagereduction')]: 13 } } },
  { label: 'eth Glad Bane', mock: { classid: cid('wirefleece'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddefense')]: 200 } } },
  { label: 'non-eth Glad Bane (no match)', mock: { classid: cid('wirefleece'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('enhanceddefense')]: 200 } } },
  { label: "Tyrael's", mock: { classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'), stats: { [sidKey('strength')]: 20 } } },
  { label: "eth Templar's", mock: { classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddefense')]: 220 } } },
  { label: "eth Arkaine's", mock: { classid: cid('balrogskin'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('itemallskills')]: 2, [sidKey('enhanceddefense')]: 190 } } },
  { label: 'eth Shaftstop', mock: { classid: cid('mesharmor'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddefense')]: 220 } } },
  { label: 'non-eth Shaftstop (no match)', mock: { classid: cid('mesharmor'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('enhanceddefense')]: 220 } } },
  // --- Ormus ---
  { label: 'Ormus cold (non-eth)', mock: { classid: cid('duskshroud'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('passivecoldmastery')]: 15, [sidKey('skillblizzard')]: 3 } } },
  { label: 'Ormus fire (non-eth)', mock: { classid: cid('duskshroud'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('passivefiremastery')]: 15, [sidKey('skillfireball')]: 3 } } },
  { label: 'eth Ormus (no match for non-eth rules)', mock: { classid: cid('duskshroud'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('passivecoldmastery')]: 15, [sidKey('skillblizzard')]: 3 } } },
  // --- White bases ---
  { label: '4os non-eth monarch', mock: { classid: cid('monarch'), quality: qid('normal'), itemType: tid('shield'), flags: 0x10, stats: { [sidKey('sockets')]: 4 } } },
  { label: '3os non-eth monarch (no match)', mock: { classid: cid('monarch'), quality: qid('normal'), itemType: tid('shield'), flags: 0x10, stats: { [sidKey('sockets')]: 3 } } },
  { label: '4os non-eth archonplate', mock: { classid: cid('archonplate'), quality: qid('normal'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('sockets')]: 4 } } },
  { label: '3os non-eth duskshroud', mock: { classid: cid('duskshroud'), quality: qid('normal'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('sockets')]: 3 } } },
  { label: '4os eth monarch', mock: { classid: cid('monarch'), quality: qid('normal'), itemType: tid('shield'), flags: 0x10 | 0x400000, stats: { [sidKey('sockets')]: 4, [sidKey('defense')]: 148 } } },
  { label: 'eth 0os monarch def 148', mock: { classid: cid('monarch'), quality: qid('normal'), itemType: tid('shield'), flags: 0x10 | 0x400000, stats: { [sidKey('sockets')]: 0, [sidKey('defense')]: 148 } } },
  // --- Type-based rules ---
  { label: 'eth elite 4os armor high def', mock: { classid: cid('sacredarmor'), quality: qid('normal'), itemType: tid('armor'), itemclass: 2, flags: 0x10 | 0x400000, stats: { [sidKey('sockets')]: 4, [sidKey('defense')]: 1200 } } },
  { label: 'eth rare armor ed 150 2os', mock: { classid: cid('archonplate'), quality: qid('rare'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddefense')]: 160, [sidKey('sockets')]: 2 } } },
  { label: 'non-eth rare armor (no match for eth rule)', mock: { classid: cid('archonplate'), quality: qid('rare'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('enhanceddefense')]: 160, [sidKey('sockets')]: 2 } } },
  { label: 'magic 4os armor 100hp', mock: { classid: cid('archonplate'), quality: qid('magic'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('sockets')]: 4, [sidKey('maxhp')]: 100 } } },
  // --- Catch-all ---
  { label: 'runeword 4os', mock: { classid: 100, quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x4000000, stats: { [sidKey('sockets')]: 4 } } },
  { label: 'runeword 3os (no match)', mock: { classid: 100, quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x4000000, stats: { [sidKey('sockets')]: 3 } } },
  // --- Gold ---
  { label: 'gold 600', mock: { classid: cid('gold'), quality: qid('normal'), itemType: tid('gold'), stats: { [sidKey('gold')]: 600 } } },
  { label: 'gold 100 (no match)', mock: { classid: cid('gold'), quality: qid('normal'), itemType: tid('gold'), stats: { [sidKey('gold')]: 100 } } },
  // --- Helms ---
  { label: 'Harlequin (shako)', mock: { classid: cid('shako'), quality: qid('unique'), itemType: tid('helm'), stats: { [sidKey('itemallskills')]: 2 } } },
  { label: "Andy's non-eth", mock: { classid: cid('demonhead'), quality: qid('unique'), itemType: tid('helm'), flags: 0x10, stats: { [sidKey('strength')]: 30, [sidKey('enhanceddefense')]: 150 } } },
  // --- Gloves/belts ---
  { label: "Dracul's non-eth", mock: { classid: cid('vampirebonegloves'), quality: qid('unique'), itemType: tid('gloves'), flags: 0x10, stats: { [sidKey('enhanceddefense')]: 120, [sidKey('strength')]: 15 } } },
  { label: "Verdungo's non-eth", mock: { classid: cid('mithrilcoil'), quality: qid('unique'), itemType: tid('belt'), flags: 0x10, stats: { [sidKey('damageresist')]: 15, [sidKey('vitality')]: 40 } } },
  // --- Set items ---
  { label: 'Tal armor', mock: { classid: cid('lacqueredplate'), quality: qid('set'), itemType: tid('armor') } },
  { label: 'Tal weapon (cold mastery 2)', mock: { classid: cid('swirlingcrystal'), quality: qid('set'), itemType: tid('orb'), stats: { [sidKey('skillcoldmastery')]: 2 } } },
  // --- Runes ---
  { label: 'Ber rune', mock: { classid: cid('berrune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Jah rune', mock: { classid: cid('jahrune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Ist rune', mock: { classid: cid('istrune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Eld rune (no match)', mock: { classid: cid('eldrune'), quality: qid('normal'), itemType: tid('rune') } },
  // --- Prefix/suffix ---
  { label: 'rare ring with prefix 10 and fcr', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), stats: { [sidKey('fcr')]: 10 }, _prefix: 10 } },
  { label: 'rare ring with suffix 20', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), _suffix: 20 } },
  { label: 'rare ring without matching prefix', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), stats: { [sidKey('fcr')]: 10 }, _prefix: 5 } },
  // --- Unidentified items (realistic: magical stats are 0 on unid) ---
  { label: 'unidentified unique ring empty stats', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), flags: 0, stats: {} } },
  { label: 'unidentified rare ring', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), flags: 0, stats: {} } },
  { label: 'unidentified unique amulet', mock: { classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'), flags: 0, stats: {} } },
  // --- Quality range items (triggers [quality] <= superior switch cases) ---
  { label: 'lowquality monarch 4os', mock: { classid: cid('monarch'), quality: qid('lowquality'), itemType: tid('shield'), flags: 0x10, stats: { [sidKey('sockets')]: 4 } } },
  { label: 'superior monarch 4os', mock: { classid: cid('monarch'), quality: qid('superior'), itemType: tid('shield'), flags: 0x10, stats: { [sidKey('sockets')]: 4 } } },
  { label: 'magic monarch 4os (fails quality range)', mock: { classid: cid('monarch'), quality: qid('magic'), itemType: tid('shield'), flags: 0x10, stats: { [sidKey('sockets')]: 4 } } },
  { label: 'rare monarch (fails quality range)', mock: { classid: cid('monarch'), quality: qid('rare'), itemType: tid('shield'), flags: 0x10, stats: { [sidKey('sockets')]: 4 } } },
  { label: 'normal duskshroud 3os non-eth', mock: { classid: cid('duskshroud'), quality: qid('normal'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('sockets')]: 3 } } },
  { label: 'superior wyrmhide 4os non-eth', mock: { classid: cid('wyrmhide'), quality: qid('superior'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('sockets')]: 4 } } },
  { label: 'eth superior duskshroud 3os (fails non-eth)', mock: { classid: cid('duskshroud'), quality: qid('superior'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('sockets')]: 3 } } },
  // --- Complement chains (eth vs non-eth on same classid) ---
  { label: 'eth unique sacred armor ed220', mock: { classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddefense')]: 220, [sidKey('strength')]: 20 } } },
  { label: 'non-eth unique sacred armor str20', mock: { classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('strength')]: 20 } } },
  { label: 'non-eth unique sacred armor no str', mock: { classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10, stats: {} } },
  // --- Unid items with base stats (defense readable on unid) ---
  { label: 'unid unique monarch', mock: { classid: cid('monarch'), quality: qid('unique'), itemType: tid('shield'), flags: 0, stats: { [sidKey('defense')]: 148 } } },
  { label: 'unid unique shako', mock: { classid: cid('shako'), quality: qid('unique'), itemType: tid('helm'), flags: 0, stats: {} } },
  { label: 'identified rare archonplate no stats', mock: { classid: cid('archonplate'), quality: qid('rare'), itemType: tid('armor'), flags: 0x10, stats: {} } },
  { label: 'unid rare archonplate', mock: { classid: cid('archonplate'), quality: qid('rare'), itemType: tid('armor'), flags: 0, stats: {} } },
  { label: 'unid set lacqueredplate', mock: { classid: cid('lacqueredplate'), quality: qid('set'), itemType: tid('armor'), flags: 0, stats: {} } },
  // --- Various weapon types ---
  { label: 'unique phase blade ed300', mock: { classid: cid('phaseblade'), quality: qid('unique'), itemType: tid('sword'), stats: { [sidKey('enhanceddamage')]: 300 } } },
  { label: 'eth unique berserker axe ed370', mock: { classid: cid('berserkeraxe'), quality: qid('unique'), itemType: tid('axe'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddamage')]: 370 } } },
  { label: 'non-eth unique berserker axe', mock: { classid: cid('berserkeraxe'), quality: qid('unique'), itemType: tid('axe'), flags: 0x10, stats: { [sidKey('enhanceddamage')]: 370 } } },
  // --- All rune range (istrune..zodrune) ---
  { label: 'Gul rune', mock: { classid: cid('gulrune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Vex rune', mock: { classid: cid('vexrune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Ohm rune', mock: { classid: cid('ohmrune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Lo rune', mock: { classid: cid('lorune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Sur rune', mock: { classid: cid('surrune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Cham rune', mock: { classid: cid('chamrune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Zod rune', mock: { classid: cid('zodrune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Mal rune (below ist, no match)', mock: { classid: cid('malrune'), quality: qid('normal'), itemType: tid('rune') } },
  { label: 'Um rune (below ist, no match)', mock: { classid: cid('umrune'), quality: qid('normal'), itemType: tid('rune') } },
  // --- Runeword items (catch-all flag dispatch) ---
  { label: 'runeword armor 4os identified', mock: { classid: cid('archonplate'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x4000000, stats: { [sidKey('sockets')]: 4 } } },
  { label: 'runeword armor 0os', mock: { classid: cid('archonplate'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x4000000, stats: { [sidKey('sockets')]: 0 } } },
  { label: 'runeword sword 4os', mock: { classid: cid('phaseblade'), quality: qid('unique'), itemType: tid('sword'), flags: 0x10 | 0x4000000, stats: { [sidKey('sockets')]: 4 } } },
  // --- Shields (stormshield) ---
  { label: 'unique monarch ed150 (stormshield)', mock: { classid: cid('monarch'), quality: qid('unique'), itemType: tid('shield'), stats: { [sidKey('enhanceddefense')]: 150 } } },
  { label: 'unique monarch ed140 (low stormshield)', mock: { classid: cid('monarch'), quality: qid('unique'), itemType: tid('shield'), stats: { [sidKey('enhanceddefense')]: 140 } } },
  // --- Type-based with various qualities ---
  { label: 'normal eth armor def500 4os', mock: { classid: cid('sacredarmor'), quality: qid('normal'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('sockets')]: 4, [sidKey('defense')]: 500 } } },
  { label: 'normal eth armor def1500 4os', mock: { classid: cid('sacredarmor'), quality: qid('normal'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('sockets')]: 4, [sidKey('defense')]: 1500 } } },
  { label: 'non-eth normal armor 4os def1200', mock: { classid: cid('sacredarmor'), quality: qid('normal'), itemType: tid('armor'), flags: 0x10, stats: { [sidKey('sockets')]: 4, [sidKey('defense')]: 1200 } } },
  // --- Misc edge cases ---
  { label: 'crafted ring (quality 8)', mock: { classid: cid('ring'), quality: qid('crafted'), itemType: tid('ring'), stats: { [sidKey('fcr')]: 10, [sidKey('maxhp')]: 40 } } },
  { label: 'set ring', mock: { classid: cid('ring'), quality: qid('set'), itemType: tid('ring'), stats: {} } },
  { label: 'eth non-unique duskshroud', mock: { classid: cid('duskshroud'), quality: qid('rare'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddefense')]: 100 } } },
  { label: 'normal broadsword 4os', mock: { classid: cid('broadsword'), quality: qid('normal'), itemType: tid('sword'), stats: { [sidKey('sockets')]: 4 } } },
  { label: 'magic amulet low mf', mock: { classid: cid('amulet'), quality: qid('magic'), itemType: tid('amulet'), stats: { [sidKey('itemmagicbonus')]: 35 } } },
  // --- Various weapon types ---
  { label: 'unique flail (HotO base)', mock: { classid: cid('flail'), quality: qid('unique'), itemType: tid('mace'), stats: { [sidKey('itemallskills')]: 3, [sidKey('fcr')]: 40 } } },
  { label: 'eth thresher unique', mock: { classid: cid('thresher'), quality: qid('unique'), itemType: tid('polearm'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddamage')]: 300 } } },
  { label: 'eth giant thresher unique', mock: { classid: cid('giantthresher'), quality: qid('unique'), itemType: tid('polearm'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddamage')]: 280 } } },
  { label: 'unique caduceus', mock: { classid: cid('caduceus'), quality: qid('unique'), itemType: tid('scepter'), stats: { [sidKey('itemallskills')]: 2 } } },
  { label: 'normal crystal sword', mock: { classid: cid('crystalsword'), quality: qid('normal'), itemType: tid('sword'), stats: { [sidKey('sockets')]: 4 } } },
  { label: 'rare longbow', mock: { classid: cid('longbow'), quality: qid('rare'), itemType: tid('bow'), stats: { [sidKey('enhanceddamage')]: 80 } } },
  { label: 'magic katar', mock: { classid: cid('katar'), quality: qid('magic'), itemType: tid('handtohand'), stats: { [sidKey('ias')]: 20 } } },
  // --- Various armor types ---
  { label: 'unique mageplate (Enigma base)', mock: { classid: cid('mageplate'), quality: qid('unique'), itemType: tid('armor'), stats: { [sidKey('itemallskills')]: 2, [sidKey('enhanceddefense')]: 200 } } },
  { label: 'eth mageplate unique', mock: { classid: cid('mageplate'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x400000, stats: { [sidKey('enhanceddefense')]: 200 } } },
  { label: 'unique greaves (sandstorm trek)', mock: { classid: cid('greaves'), quality: qid('unique'), itemType: tid('boots'), stats: { [sidKey('frw')]: 20, [sidKey('strength')]: 15, [sidKey('vitality')]: 15 } } },
  { label: 'unique gauntlets', mock: { classid: cid('gauntlets'), quality: qid('unique'), itemType: tid('gloves'), stats: { [sidKey('ias')]: 20, [sidKey('strength')]: 25 } } },
  { label: 'unique lightgauntlets (magefist)', mock: { classid: cid('lightgauntlets'), quality: qid('unique'), itemType: tid('gloves'), stats: { [sidKey('fcr')]: 20 } } },
  { label: 'rare helm with life+res', mock: { classid: cid('basinet'), quality: qid('rare'), itemType: tid('helm'), stats: { [sidKey('maxhp')]: 40, [sidKey('fireresist')]: 30, [sidKey('lightresist')]: 20, [sidKey('coldresist')]: 15 } } },
  // --- Charms ---
  { label: 'small charm life+mf', mock: { classid: cid('smallcharm'), quality: qid('magic'), itemType: tid('smallcharm'), stats: { [sidKey('maxhp')]: 20, [sidKey('itemmagicbonus')]: 7 } } },
  { label: 'large charm life', mock: { classid: cid('largecharm'), quality: qid('magic'), itemType: tid('largecharm'), stats: { [sidKey('maxhp')]: 35 } } },
  { label: 'unid small charm', mock: { classid: cid('smallcharm'), quality: qid('magic'), itemType: tid('smallcharm'), flags: 0 } },
  // --- Gems and misc ---
  { label: 'perfect amethyst', mock: { classid: cid('perfectamethyst'), quality: qid('normal'), itemType: tid('gem') } },
  { label: 'perfect topaz', mock: { classid: cid('perfecttopaz'), quality: qid('normal'), itemType: tid('gem') } },
  { label: 'skull', mock: { classid: cid('skull'), quality: qid('normal'), itemType: tid('gem') } },
  // --- Maxquantity items (rules have # [maxquantity] == N) ---
  { label: 'unique studded leather (mq=1)', mock: { classid: cid('studdedleather'), quality: qid('unique'), itemType: tid('armor') } },
  { label: 'unique greaves classic (mq=1)', mock: { classid: cid('greaves'), quality: qid('unique'), itemType: tid('boots') } },
  { label: 'unique skullcap (mq=1)', mock: { classid: cid('skullcap'), quality: qid('unique'), itemType: tid('helm') } },
  { label: 'set ringmail ed40 (mq=1)', mock: { classid: cid('ringmail'), quality: qid('set'), itemType: tid('armor'), stats: { [sidKey('enhanceddefense')]: 40 } } },
  { label: 'set sabre tohit75 (mq=1)', mock: { classid: cid('sabre'), quality: qid('set'), itemType: tid('sword'), stats: { [sidKey('tohit')]: 75 } } },
  { label: 'set ring hp20 (mq=2)', mock: { classid: cid('ring'), quality: qid('set'), itemType: tid('ring'), stats: { [sidKey('maxhp')]: 20 } } },
  // --- Tier items (follower.nip has tier rules) ---
  { label: 'gloves with hp (tier=1)', mock: { classid: cid('gauntlets'), quality: qid('magic'), itemType: tid('gloves'), stats: { [sidKey('maxhp')]: 15 } } },
  { label: 'gloves with hp+mana (tier=2)', mock: { classid: cid('gauntlets'), quality: qid('magic'), itemType: tid('gloves'), stats: { [sidKey('maxhp')]: 15, [sidKey('maxmana')]: 15 } } },
  { label: 'unique heavygloves hp (tier=3)', mock: { classid: cid('heavygloves'), quality: qid('unique'), itemType: tid('gloves'), stats: { [sidKey('maxhp')]: 20 } } },
  { label: 'set lightgauntlets coldres (tier=101)', mock: { classid: cid('lightgauntlets'), quality: qid('set'), itemType: tid('gloves'), stats: { [sidKey('coldresist')]: 30 } } },
  { label: 'lightbelt (tier=1)', mock: { classid: cid('lightbelt'), quality: qid('normal'), itemType: tid('belt') } },
  { label: 'lightbelt with hp (tier=2)', mock: { classid: cid('lightbelt'), quality: qid('magic'), itemType: tid('belt'), stats: { [sidKey('maxhp')]: 20 } } },
  { label: 'set heavybelt mindmg (tier=101)', mock: { classid: cid('heavybelt'), quality: qid('set'), itemType: tid('belt'), stats: { [sidKey('mindamage')]: 5 } } },
  { label: 'boots with 30 total res (tier=1)', mock: { classid: cid('chainboots'), quality: qid('magic'), itemType: tid('boots'), stats: { [sidKey('fireresist')]: 10, [sidKey('lightresist')]: 10, [sidKey('coldresist')]: 10 } } },
  { label: 'boots with 50 total res (tier=3)', mock: { classid: cid('chainboots'), quality: qid('magic'), itemType: tid('boots'), stats: { [sidKey('fireresist')]: 20, [sidKey('lightresist')]: 15, [sidKey('coldresist')]: 15 } } },
  { label: 'unique greaves fireres (tier=101)', mock: { classid: cid('greaves'), quality: qid('unique'), itemType: tid('boots'), stats: { [sidKey('fireresist')]: 40 } } },
  { label: 'helm with hp (tier=1)', mock: { classid: cid('casque'), quality: qid('magic'), itemType: tid('helm'), stats: { [sidKey('maxhp')]: 20 } } },
  { label: 'rare helm hp30+res40 (tier=101)', mock: { classid: cid('casque'), quality: qid('rare'), itemType: tid('helm'), stats: { [sidKey('maxhp')]: 35, [sidKey('fireresist')]: 15, [sidKey('lightresist')]: 15, [sidKey('coldresist')]: 15 } } },
  { label: 'set crown fireres+lightres (tier=101)', mock: { classid: cid('crown'), quality: qid('set'), itemType: tid('helm'), stats: { [sidKey('fireresist')]: 30, [sidKey('lightresist')]: 30 } } },
  // --- Crafted quality ---
  { label: 'crafted amulet fcr', mock: { classid: cid('amulet'), quality: qid('crafted'), itemType: tid('amulet'), stats: { [sidKey('fcr')]: 20, [sidKey('fireresist')]: 25 } } },
  { label: 'crafted ring', mock: { classid: cid('ring'), quality: qid('crafted'), itemType: tid('ring'), stats: { [sidKey('fcr')]: 10, [sidKey('maxhp')]: 35 } } },
  // --- Unid variants for items that have base stats ---
  { label: 'id normal monarch def148 4os', mock: { classid: cid('monarch'), quality: qid('normal'), itemType: tid('shield'), flags: 0x10, stats: { [sidKey('defense')]: 148, [sidKey('sockets')]: 4 } } },
  { label: 'id normal monarch def100 4os', mock: { classid: cid('monarch'), quality: qid('normal'), itemType: tid('shield'), flags: 0x10, stats: { [sidKey('defense')]: 100, [sidKey('sockets')]: 4 } } },
  { label: 'unid normal monarch 4os (sockets visible on normal)', mock: { classid: cid('monarch'), quality: qid('normal'), itemType: tid('shield'), flags: 0, stats: { [sidKey('defense')]: 148, [sidKey('sockets')]: 4 } } },
  // Normal/superior items always have identified flag in-game — unid normal is impossible.
  // So sockets (194) being quality-aware only matters as an optimization detail, not a correctness issue.
  { label: 'unid eth sacred armor', mock: { classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'), flags: 0x400000, stats: { [sidKey('defense')]: 900 } } },
  { label: 'unid non-eth unique shako def141', mock: { classid: cid('shako'), quality: qid('unique'), itemType: tid('helm'), flags: 0, stats: { [sidKey('defense')]: 141 } } },
  { label: 'unid non-eth unique shako def130', mock: { classid: cid('shako'), quality: qid('unique'), itemType: tid('helm'), flags: 0, stats: { [sidKey('defense')]: 130 } } },
  // --- Runeword items ---
  { label: 'runeword armor eth 4os', mock: { classid: cid('archonplate'), quality: qid('unique'), itemType: tid('armor'), flags: 0x10 | 0x4000000 | 0x400000, stats: { [sidKey('sockets')]: 4 } } },
  { label: 'runeword shield 4os', mock: { classid: cid('monarch'), quality: qid('unique'), itemType: tid('shield'), flags: 0x10 | 0x4000000, stats: { [sidKey('sockets')]: 4 } } },
  { label: 'runeword sword non-eth 6os', mock: { classid: cid('phaseblade'), quality: qid('unique'), itemType: tid('sword'), flags: 0x10 | 0x4000000, stats: { [sidKey('sockets')]: 6 } } },
  // --- Multiple classids/unknown ---
  { label: 'unknown classid 777', mock: { classid: 777, quality: qid('normal'), itemType: tid('sword') } },
  { label: 'unknown classid 888 unique', mock: { classid: 888, quality: qid('unique'), itemType: tid('armor'), stats: { [sidKey('defense')]: 200 } } },
  // --- Realistic unid items (most items in-game are unid) ---
  // Unid unique items — common drops you'd encounter
  { label: 'unid unique ring', mock: { classid: cid('ring'), quality: qid('unique'), itemType: tid('ring'), flags: 0 } },
  { label: 'unid unique amulet', mock: { classid: cid('amulet'), quality: qid('unique'), itemType: tid('amulet'), flags: 0 } },
  { label: 'unid unique shako', mock: { classid: cid('shako'), quality: qid('unique'), itemType: tid('helm'), flags: 0 } },
  { label: 'unid unique vipermagi', mock: { classid: cid('serpentskinarmor'), quality: qid('unique'), itemType: tid('armor'), flags: 0 } },
  { label: 'unid unique phaseblade', mock: { classid: cid('phaseblade'), quality: qid('unique'), itemType: tid('sword'), flags: 0 } },
  { label: 'unid unique berserker axe', mock: { classid: cid('berserkeraxe'), quality: qid('unique'), itemType: tid('axe'), flags: 0 } },
  { label: 'unid unique monarch', mock: { classid: cid('monarch'), quality: qid('unique'), itemType: tid('shield'), flags: 0 } },
  { label: 'unid unique demonhead', mock: { classid: cid('demonhead'), quality: qid('unique'), itemType: tid('helm'), flags: 0 } },
  { label: 'unid unique wirefleece', mock: { classid: cid('wirefleece'), quality: qid('unique'), itemType: tid('armor'), flags: 0 } },
  { label: 'unid unique lacqueredplate', mock: { classid: cid('lacqueredplate'), quality: qid('unique'), itemType: tid('armor'), flags: 0 } },
  // Unid rare items — very common drops
  { label: 'unid rare ring', mock: { classid: cid('ring'), quality: qid('rare'), itemType: tid('ring'), flags: 0 } },
  { label: 'unid rare amulet', mock: { classid: cid('amulet'), quality: qid('rare'), itemType: tid('amulet'), flags: 0 } },
  { label: 'unid rare archonplate', mock: { classid: cid('archonplate'), quality: qid('rare'), itemType: tid('armor'), flags: 0 } },
  { label: 'unid rare diadem', mock: { classid: cid('diadem'), quality: qid('rare'), itemType: tid('helm'), flags: 0 } },
  { label: 'unid rare gauntlets', mock: { classid: cid('gauntlets'), quality: qid('rare'), itemType: tid('gloves'), flags: 0 } },
  { label: 'unid rare boots', mock: { classid: cid('greaves'), quality: qid('rare'), itemType: tid('boots'), flags: 0 } },
  // Unid magic items — most common
  { label: 'unid magic ring', mock: { classid: cid('ring'), quality: qid('magic'), itemType: tid('ring'), flags: 0 } },
  { label: 'unid magic amulet', mock: { classid: cid('amulet'), quality: qid('magic'), itemType: tid('amulet'), flags: 0 } },
  { label: 'unid magic small charm', mock: { classid: cid('smallcharm'), quality: qid('magic'), itemType: tid('smallcharm'), flags: 0 } },
  { label: 'unid magic large charm', mock: { classid: cid('largecharm'), quality: qid('magic'), itemType: tid('largecharm'), flags: 0 } },
  { label: 'unid magic monarch', mock: { classid: cid('monarch'), quality: qid('magic'), itemType: tid('shield'), flags: 0 } },
  // Unid set items
  { label: 'unid set ring', mock: { classid: cid('ring'), quality: qid('set'), itemType: tid('ring'), flags: 0 } },
  { label: 'unid set lacqueredplate', mock: { classid: cid('lacqueredplate'), quality: qid('set'), itemType: tid('armor'), flags: 0 } },
  { label: 'unid set swirlingcrystal', mock: { classid: cid('swirlingcrystal'), quality: qid('set'), itemType: tid('orb'), flags: 0 } },
  // Unid eth unique (common valuable drops)
  { label: 'unid eth unique sacredarmor', mock: { classid: cid('sacredarmor'), quality: qid('unique'), itemType: tid('armor'), flags: 0x400000 } },
  { label: 'unid eth unique berserkeraxe', mock: { classid: cid('berserkeraxe'), quality: qid('unique'), itemType: tid('axe'), flags: 0x400000 } },
  { label: 'unid eth unique wirefleece', mock: { classid: cid('wirefleece'), quality: qid('unique'), itemType: tid('armor'), flags: 0x400000 } },
  // Junk items — no rules match, should reject instantly (most items in-game are junk)
  { label: 'unid magic longsword', mock: { classid: cid('longsword'), quality: qid('magic'), itemType: tid('sword'), flags: 0 } },
  { label: 'unid rare club', mock: { classid: cid('club'), quality: qid('rare'), itemType: tid('club'), flags: 0 } },
  { label: 'unid magic shortbow', mock: { classid: cid('shortbow'), quality: qid('magic'), itemType: tid('bow'), flags: 0 } },
  { label: 'normal cap', mock: { classid: cid('cap'), quality: qid('normal'), itemType: tid('helm') } },
  { label: 'normal skullcap', mock: { classid: cid('skullcap'), quality: qid('normal'), itemType: tid('helm') } },
  { label: 'normal quiltedarmor', mock: { classid: cid('quiltedarmor'), quality: qid('normal'), itemType: tid('armor') } },
  { label: 'normal leatherarmor', mock: { classid: cid('leatherarmor'), quality: qid('normal'), itemType: tid('armor') } },
  { label: 'normal ringmail', mock: { classid: cid('ringmail'), quality: qid('normal'), itemType: tid('armor') } },
  { label: 'normal buckler', mock: { classid: cid('buckler'), quality: qid('normal'), itemType: tid('shield') } },
  { label: 'normal smallshield', mock: { classid: cid('smallshield'), quality: qid('normal'), itemType: tid('shield') } },
  { label: 'normal handaxe', mock: { classid: cid('handaxe'), quality: qid('normal'), itemType: tid('axe') } },
  { label: 'normal doubleaxe', mock: { classid: cid('doubleaxe'), quality: qid('normal'), itemType: tid('axe') } },
  { label: 'normal shortsword', mock: { classid: cid('shortsword'), quality: qid('normal'), itemType: tid('sword') } },
  { label: 'normal scimitar', mock: { classid: cid('scimitar'), quality: qid('normal'), itemType: tid('sword') } },
  { label: 'normal mace', mock: { classid: cid('mace'), quality: qid('normal'), itemType: tid('mace') } },
  { label: 'normal dagger', mock: { classid: cid('dagger'), quality: qid('normal'), itemType: tid('knife') } },
  { label: 'normal javelin', mock: { classid: cid('javelin'), quality: qid('normal'), itemType: tid('javelin') } },
  { label: 'normal spear', mock: { classid: cid('spear'), quality: qid('normal'), itemType: tid('spear') } },
  { label: 'normal shortstaff', mock: { classid: cid('shortstaff'), quality: qid('normal'), itemType: tid('staff') } },
  { label: 'normal wand', mock: { classid: cid('wand'), quality: qid('normal'), itemType: tid('wand') } },
  { label: 'normal leathergloves', mock: { classid: cid('leathergloves'), quality: qid('normal'), itemType: tid('gloves') } },
  { label: 'normal heavyboots', mock: { classid: cid('heavyboots'), quality: qid('normal'), itemType: tid('boots') } },
  { label: 'normal sash', mock: { classid: cid('sash'), quality: qid('normal'), itemType: tid('belt') } },
  { label: 'magic cap', mock: { classid: cid('cap'), quality: qid('magic'), itemType: tid('helm'), flags: 0x10 } },
  { label: 'magic leatherarmor', mock: { classid: cid('leatherarmor'), quality: qid('magic'), itemType: tid('armor'), flags: 0x10 } },
  { label: 'rare handaxe', mock: { classid: cid('handaxe'), quality: qid('rare'), itemType: tid('axe'), flags: 0x10 } },
  { label: 'rare dagger', mock: { classid: cid('dagger'), quality: qid('rare'), itemType: tid('knife'), flags: 0x10 } },
  { label: 'unid rare scimitar', mock: { classid: cid('scimitar'), quality: qid('rare'), itemType: tid('sword'), flags: 0 } },
  { label: 'unid magic spear', mock: { classid: cid('spear'), quality: qid('magic'), itemType: tid('spear'), flags: 0 } },
  { label: 'unid unique dagger', mock: { classid: cid('dagger'), quality: qid('unique'), itemType: tid('knife'), flags: 0 } },
  // --- No match ---
  { label: 'normal ring', mock: { classid: cid('ring'), quality: qid('normal'), itemType: tid('ring') } },
  { label: 'random unknown classid', mock: { classid: 999, quality: qid('normal'), itemType: 99 } },
  { label: 'low quality amulet', mock: { classid: cid('amulet'), quality: qid('lowquality'), itemType: tid('amulet') } },
  { label: 'normal sword', mock: { classid: cid('broadsword'), quality: qid('normal'), itemType: tid('sword') } },
  { label: 'normal potion', mock: { classid: 500, quality: qid('normal'), itemType: tid('potion') } },
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

describe('Impossible quality: we reject what OG NTIP incorrectly matches', () => {
  // D2 has strict quality rules per item type. The OG NTIP doesn't know these —
  // it evaluates rules blindly. We use typeProperties to skip impossible combos
  // at compile time, which is both faster and more correct.

  const impossibleItems: { rule: string; label: string; classid: number; quality: number; stats?: Record<string, number> }[] = [
    { rule: '[name] == smallcharm && [quality] == rare # [maxhp] >= 20', label: 'rare charm',
      classid: cid('smallcharm'), quality: qid('rare'), stats: { [sidKey('maxhp')]: 20 } },
    { rule: '[name] == smallcharm && [quality] == set # [maxhp] >= 20', label: 'set charm',
      classid: cid('smallcharm'), quality: qid('set'), stats: { [sidKey('maxhp')]: 20 } },
    { rule: '[name] == smallcharm && [quality] == crafted # [maxhp] >= 20', label: 'crafted charm',
      classid: cid('smallcharm'), quality: qid('crafted'), stats: { [sidKey('maxhp')]: 20 } },
    { rule: '[name] == berrune && [quality] == magic', label: 'magic rune',
      classid: cid('berrune'), quality: qid('magic') },
    { rule: '[name] == berrune && [quality] == rare', label: 'rare rune',
      classid: cid('berrune'), quality: qid('rare') },
    { rule: '[name] == gold && [quality] == unique # [gold] >= 500', label: 'unique gold',
      classid: cid('gold'), quality: qid('unique'), stats: { [sidKey('gold')]: 500 } },
  ];

  for (const t of impossibleItems) {
    it(`rejects "${t.label}" (OG NTIP would match)`, () => {
      // OG NTIP: blindly matches because rule conditions pass on the fake item
      const original = createOriginalNTIP();
      original.addLine(t.rule, 'test.nip');
      const item = makeItem({ classid: t.classid, quality: t.quality, itemType: 0, stats: t.stats ?? {} });
      const origResult = original.checkItem(item);
      assert.strictEqual(origResult, 1, 'OG NTIP should match (it does not know D2 type rules)');

      // Ours: rejects because we know this quality is impossible for this item type
      const ours = createOurEmitter([t.rule], 'test.nip');
      const ourResult = ours.checkItem(item);
      assert.strictEqual(ourResult, 0, 'We should reject (impossible quality for this type)');
    });
  }
});

describe('Benchmark: fair comparison (all in VM)', () => {
  let original: ReturnType<typeof createOriginalNTIP>;
  let switchVM: ReturnType<typeof createOurEmitter>;
  let lookupVM: ReturnType<typeof createOurEmitter>;
  let items: ReturnType<typeof makeItem>[];

  const nipDir = join(ROOT, 'nip');
  const nipFilenames = readdirSync(nipDir).filter(f => f.endsWith('.nip'));

  before(() => {
    const fileEntries = nipFilenames.map(f => {
      const content = readFileSync(join(nipDir, f), 'utf-8');
      const lines = content.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('//'));
      return { lines, filename: f };
    });

    original = createOriginalNTIP();
    for (const { lines, filename } of fileEntries) {
      for (const line of lines) {
        try { original.addLine(line, filename); } catch {}
      }
    }
    switchVM = createMultiFileEmitterInVM(fileEntries, DispatchStrategy.Switch);
    lookupVM = createMultiFileEmitterInVM(fileEntries, DispatchStrategy.ObjectLookup);

    items = TEST_ITEMS.map(t => makeItem(t.mock));

    // Verify VM versions produce same results
    for (const item of items) {
      const orig = original.checkItem(item);
      const sw = switchVM.checkItem(item);
      const lu = lookupVM.checkItem(item);
      if (sw !== orig) throw new Error(`Switch VM mismatch: switch=${sw}, original=${orig}`);
      if (lu !== orig) throw new Error(`Lookup VM mismatch: lookup=${lu}, original=${orig}`);
    }
  });

  it('benchmarks all three in VM (apples-to-apples)', () => {
    const iterations = 10000;
    const totalChecks = iterations * items.length;

    function bench(fn: () => void): number {
      fn();
      const start = performance.now();
      for (let i = 0; i < iterations; i++) fn();
      return performance.now() - start;
    }

    const elapsedOrig = bench(() => { for (const item of items) original.checkItem(item); });
    const elapsedSwitch = bench(() => { for (const item of items) switchVM.checkItem(item); });
    const elapsedLookup = bench(() => { for (const item of items) lookupVM.checkItem(item); });

    const fmt = (ms: number) => {
      const ops = Math.round(totalChecks / (ms / 1000));
      return `${ms.toFixed(1)}ms (${ops.toLocaleString()} ops/s)`;
    };

    console.log('');
    console.log(`  All running in VM (fair comparison, ${nipFilenames.length} nip files):`);
    console.log(`  Original NTIP:         ${fmt(elapsedOrig)}`);
    console.log(`  Switch dispatch:       ${fmt(elapsedSwitch)}`);
    console.log(`  Object lookup:         ${fmt(elapsedLookup)}`);
    console.log(`  Switch vs original:    ${(elapsedOrig / elapsedSwitch).toFixed(1)}x`);
    console.log(`  Lookup vs original:    ${(elapsedOrig / elapsedLookup).toFixed(1)}x`);
    console.log(`  Switch vs lookup:      ${(elapsedLookup / elapsedSwitch).toFixed(2)}x`);
    console.log(`  (${totalChecks.toLocaleString()} checks, ${items.length} items × ${iterations.toLocaleString()} iterations)`);
  });
});
