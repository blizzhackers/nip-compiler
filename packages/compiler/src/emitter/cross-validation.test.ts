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
  // --- No match ---
  { label: 'normal ring', mock: { classid: cid('ring'), quality: qid('normal'), itemType: tid('ring') } },
  { label: 'random unknown classid', mock: { classid: 999, quality: qid('normal'), itemType: 99 } },
  { label: 'low quality amulet', mock: { classid: cid('amulet'), quality: qid('lowquality'), itemType: tid('amulet') } },
  { label: 'normal sword', mock: { classid: cid('broadsword'), quality: qid('normal'), itemType: tid('sword') } },
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
    console.log(`  Switch vs lookup:      ${(elapsedLookup / elapsedSwitch).toFixed(1)}x`);
    console.log(`  (${totalChecks.toLocaleString()} checks, ${items.length} items × ${iterations.toLocaleString()} iterations)`);
  });
});
