import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Parser } from '../parser.js';
import { Binder } from '../binder.js';
import { Analyzer } from './analyzer.js';
import { Grouper } from './grouper.js';
import { CodeGen } from './codegen.js';
import { Emitter } from './emitter.js';
import { AliasMapSet, DispatchKind } from './types.js';
import { NodeKind } from '../types.js';

const parser = new Parser();
const binder = new Binder();

const testAliases: AliasMapSet = {
  classId: { ring: 85, amulet: 520, duskshroud: 467, monarch: 443, archonplate: 415 },
  type: { ring: 10, amulet: 12, armor: 3, shield: 2, helm: 37, boots: 15, belt: 19 },
  quality: { lowquality: 1, normal: 2, superior: 3, magic: 4, set: 5, rare: 6, unique: 7, crafted: 8 },
  flag: { identified: 0x10, ethereal: 0x400000, runeword: 0x4000000 },
  stat: {
    strength: 0, dexterity: 2, maxhp: 39, maxmana: 41,
    enhanceddefense: 31, sockets: 194, defense: 31,
    fcr: 105, tohit: 19, itemmaxmanapercent: 9,
    itemmagicbonus: 80, itemabsorblightpercent: 89,
    lifeleech: 60, maxstamina: 11,
    fireresist: 39, coldresist: 43, lightresist: 41,
    dexterity2: [2, 0],
  },
  color: { white: 20, black: 3 },
  class: { normal: 0, exceptional: 1, elite: 2 },
};

describe('Analyzer', () => {
  const analyzer = new Analyzer(testAliases);

  it('extracts classid dispatch from [name] == ring', () => {
    const line = parser.parseLine('[name] == ring && [quality] == unique');
    binder.bindLine(line);
    const result = analyzer.analyze(line, 0, 'test.nip');
    assert.ok(result.dispatch);
    assert.strictEqual(result.dispatch!.kind, DispatchKind.Classid);
    assert.deepStrictEqual(result.dispatch!.values, [85]);
    assert.strictEqual(result.dispatch!.quality, 7);
  });

  it('extracts type dispatch from [type] == armor', () => {
    const line = parser.parseLine('[type] == armor && [quality] == rare');
    binder.bindLine(line);
    const result = analyzer.analyze(line, 0, 'test.nip');
    assert.ok(result.dispatch);
    assert.strictEqual(result.dispatch!.kind, DispatchKind.Type);
    assert.deepStrictEqual(result.dispatch!.values, [3]);
    assert.strictEqual(result.dispatch!.quality, 6);
  });

  it('extracts multi-classid from OR group', () => {
    const line = parser.parseLine('([name] == ring || [name] == amulet) && [quality] == unique');
    binder.bindLine(line);
    const result = analyzer.analyze(line, 0, 'test.nip');
    assert.ok(result.dispatch);
    assert.strictEqual(result.dispatch!.kind, DispatchKind.Classid);
    assert.deepStrictEqual(result.dispatch!.values, [85, 520]);
  });

  it('returns null dispatch for flag-only rules', () => {
    const line = parser.parseLine('[flag] == runeword');
    binder.bindLine(line);
    const result = analyzer.analyze(line, 0, 'test.nip');
    assert.strictEqual(result.dispatch, null);
  });

  it('extracts tier meta', () => {
    const line = parser.parseLine('[name] == ring # # [tier] == 5');
    binder.bindLine(line);
    const result = analyzer.analyze(line, 0, 'test.nip');
    assert.strictEqual(result.tier, 5);
  });

  it('extracts maxquantity meta', () => {
    const line = parser.parseLine('[name] == monarch # [sockets] == 4 # [maxquantity] == 1');
    binder.bindLine(line);
    const result = analyzer.analyze(line, 0, 'test.nip');
    assert.strictEqual(result.maxQuantity, 1);
  });

  it('quality is null when not a fixed ==', () => {
    const line = parser.parseLine('[name] == ring && [quality] <= rare');
    binder.bindLine(line);
    const result = analyzer.analyze(line, 0, 'test.nip');
    assert.ok(result.dispatch);
    assert.strictEqual(result.dispatch!.quality, null);
  });
});

describe('Grouper', () => {
  const analyzer = new Analyzer(testAliases);
  const grouper = new Grouper(testAliases);

  it('groups classid rules into classidGroups', () => {
    const line = parser.parseLine('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25');
    binder.bindLine(line);
    const analyzed = [analyzer.analyze(line, 0, 'test.nip')];
    const plan = grouper.group(analyzed);
    assert.ok(plan.classidGroups.has(85));
    assert.ok(plan.classidGroups.get(85)!.has(7));
    assert.strictEqual(plan.classidGroups.get(85)!.get(7)!.length, 1);
  });

  it('strips dispatch conditions from residual', () => {
    const line = parser.parseLine('[name] == ring && [quality] == unique && [flag] != ethereal');
    binder.bindLine(line);
    const analyzed = [analyzer.analyze(line, 0, 'test.nip')];
    const plan = grouper.group(analyzed);
    const rule = plan.classidGroups.get(85)!.get(7)![0];
    // residual should only be [flag] != ethereal
    assert.ok(rule.residualProperty);
    assert.strictEqual(rule.residualProperty!.kind, NodeKind.BinaryExpr);
    if (rule.residualProperty!.kind === NodeKind.BinaryExpr) {
      assert.strictEqual(rule.residualProperty!.op, '!=');
    }
  });

  it('puts non-dispatchable rules in catchAll', () => {
    const line = parser.parseLine('[flag] == runeword # [sockets] == 4');
    binder.bindLine(line);
    const analyzed = [analyzer.analyze(line, 0, 'test.nip')];
    const plan = grouper.group(analyzed);
    assert.strictEqual(plan.catchAll.length, 1);
  });

  it('handles OR group dispatch into multiple classids', () => {
    const line = parser.parseLine('([name] == ring || [name] == amulet) && [quality] == unique');
    binder.bindLine(line);
    const analyzed = [analyzer.analyze(line, 0, 'test.nip')];
    const plan = grouper.group(analyzed);
    assert.ok(plan.classidGroups.has(85));
    assert.ok(plan.classidGroups.has(520));
  });
});

describe('CodeGen', () => {
  const codegen = new CodeGen(testAliases);

  it('emits property keyword', () => {
    const line = parser.parseLine('[name] == ring');
    const js = codegen.emitPropertyExpr(line.property!.expr);
    assert.strictEqual(js, '(item.classid==85)');
  });

  it('emits quality comparison', () => {
    const line = parser.parseLine('[quality] == unique');
    const js = codegen.emitPropertyExpr(line.property!.expr);
    assert.strictEqual(js, '(item.quality==7)');
  });

  it('emits flag check (== becomes call)', () => {
    const line = parser.parseLine('[flag] == ethereal');
    const js = codegen.emitPropertyExpr(line.property!.expr);
    assert.strictEqual(js, 'item.getFlag(4194304)');
  });

  it('emits negated flag check', () => {
    const line = parser.parseLine('[flag] != ethereal');
    const js = codegen.emitPropertyExpr(line.property!.expr);
    assert.strictEqual(js, '(!item.getFlag(4194304))');
  });

  it('emits stat keyword', () => {
    const line = parser.parseLine('[name] == ring # [strength] >= 20');
    const js = codegen.emitStatExpr(line.stats!.expr);
    assert.strictEqual(js, '(item.getStatEx(0)>=20)');
  });

  it('emits stat addition', () => {
    const line = parser.parseLine('[name] == ring # [strength] + [dexterity] >= 30');
    const js = codegen.emitStatExpr(line.stats!.expr);
    assert.strictEqual(js, '((item.getStatEx(0)+item.getStatEx(2))>=30)');
  });

  it('emits AND conjunction', () => {
    const line = parser.parseLine('[name] == ring && [quality] == unique');
    const js = codegen.emitPropertyExpr(line.property!.expr);
    assert.strictEqual(js, '((item.classid==85)&&(item.quality==7))');
  });

  it('collects stat IDs for hoisting', () => {
    const line = parser.parseLine('[name] == ring # [fcr] == 10 && [maxhp] >= 30');
    const stats = codegen.collectStatIds(line.stats!.expr);
    assert.ok(stats.has('fcr'));
    assert.ok(stats.has('maxhp'));
    assert.strictEqual(stats.get('fcr'), 105);
  });

  it('uses hoisted var when provided', () => {
    const line = parser.parseLine('[name] == ring # [fcr] == 10');
    const hoisted = new Map<number | string, string>([[105, '_h0']]);
    const js = codegen.emitStatExprWithHoisted(line.stats!.expr, hoisted);
    assert.strictEqual(js, '(_h0==10)');
  });
});

describe('Emitter', () => {
  const emitter = new Emitter({ aliases: testAliases, includeSourceComments: true });

  it('emits valid JavaScript from a simple rule', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 // soj', 'test.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    assert.ok(js.includes('function checkItem'));
    assert.ok(js.includes('function getTier'));
    assert.ok(js.includes('function getMercTier'));
    assert.ok(js.includes('case 85'));
    assert.ok(js.includes('case 7'));
  });

  it('emitted code is valid JS (can be eval\'d)', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'test.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    const factory = eval(js);
    assert.strictEqual(typeof factory, 'function');
  });

  it('checkItem returns match for matching item', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'test.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    const factory = eval(js);
    const mod = factory({
      checkQuantityOwned: () => 0,
      me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
      getBaseStat: () => 0,
    });

    const mockItem = {
      classid: 85,
      quality: 7,
      itemType: 10,
      getFlag: (f: number) => f === 0x10 ? 0x10 : 0,
      getStatEx: (id: number) => id === 9 ? 25 : 0,
    };

    const result = mod.checkItem(mockItem);
    assert.strictEqual(result.result, 1);
    assert.strictEqual(result.line, 'test.nip#1');
  });

  it('checkItem returns 0 for non-matching item', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'test.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    const factory = eval(js);
    const mod = factory({
      checkQuantityOwned: () => 0,
      me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
      getBaseStat: () => 0,
    });

    const mockItem = {
      classid: 520, // amulet, not ring
      quality: 7,
      itemType: 12,
      getFlag: () => 0x10,
      getStatEx: () => 0,
    };

    const result = mod.checkItem(mockItem);
    assert.strictEqual(result.result, 0);
  });

  it('checkItem returns -1 for unidentified item that matches property but fails stat', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'test.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    const factory = eval(js);
    const mod = factory({
      checkQuantityOwned: () => 0,
      me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
      getBaseStat: () => 0,
    });

    const mockItem = {
      classid: 85,
      quality: 7,
      itemType: 10,
      getFlag: () => 0, // not identified
      getStatEx: () => 0, // stat doesn't match
    };

    const result = mod.checkItem(mockItem);
    assert.strictEqual(result.result, -1);
  });

  it('getTier returns highest matching tier', () => {
    const input = [
      '[name] == ring && [quality] == unique # # [tier] == 5',
      '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 # [tier] == 99',
    ].join('\n');
    const file = parser.parseFile(input, 'tier.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    const factory = eval(js);
    const mod = factory({
      checkQuantityOwned: () => 0,
      me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
      getBaseStat: () => 0,
    });

    const mockItem = {
      classid: 85, quality: 7, itemType: 10,
      getFlag: () => 0x10,
      getStatEx: (id: number) => id === 9 ? 25 : 0,
    };

    const tier = mod.getTier(mockItem);
    assert.strictEqual(tier, 99);
  });

  it('getTier returns 5 when only first tier rule matches', () => {
    const input = [
      '[name] == ring && [quality] == unique # # [tier] == 5',
      '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 # [tier] == 99',
    ].join('\n');
    const file = parser.parseFile(input, 'tier.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    const factory = eval(js);
    const mod = factory({
      checkQuantityOwned: () => 0,
      me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
      getBaseStat: () => 0,
    });

    const mockItem = {
      classid: 85, quality: 7, itemType: 10,
      getFlag: () => 0x10,
      getStatEx: () => 0, // stat doesn't match for tier 99
    };

    const tier = mod.getTier(mockItem);
    assert.strictEqual(tier, 5);
  });

  it('includes source line reference in result', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 // soj', 'kolton.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    const factory = eval(js);
    const mod = factory({
      checkQuantityOwned: () => 0,
      me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
      getBaseStat: () => 0,
    });

    const mockItem = {
      classid: 85, quality: 7, itemType: 10,
      getFlag: () => 0x10,
      getStatEx: (id: number) => id === 9 ? 25 : 0,
    };

    const result = mod.checkItem(mockItem);
    assert.strictEqual(result.line, 'kolton.nip#1');
  });

  it('handles type dispatch rules', () => {
    const file = parser.parseFile('[type] == armor && [quality] == rare # [enhanceddefense] >= 150', 'test.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    assert.ok(js.includes('item.itemType'));
    const factory = eval(js);
    const mod = factory({
      checkQuantityOwned: () => 0,
      me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
      getBaseStat: () => 0,
    });

    const mockItem = {
      classid: 415, quality: 6, itemType: 3,
      getFlag: () => 0x10,
      getStatEx: (id: number) => id === 31 ? 200 : 0,
    };

    const result = mod.checkItem(mockItem);
    assert.strictEqual(result.result, 1);
  });

  it('handles catch-all rules (flag-only)', () => {
    const file = parser.parseFile('[flag] == runeword # [sockets] == 4', 'test.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    const factory = eval(js);
    const mod = factory({
      checkQuantityOwned: () => 0,
      me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
      getBaseStat: () => 0,
    });

    const mockItem = {
      classid: 100, quality: 7, itemType: 3,
      getFlag: (f: number) => f === 0x4000000 ? 0x4000000 : (f === 0x10 ? 0x10 : 0),
      getStatEx: (id: number) => id === 194 ? 4 : 0,
    };

    const result = mod.checkItem(mockItem);
    assert.strictEqual(result.result, 1);
  });

  it('emits multiple files into one module', () => {
    const file1 = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'file1.nip');
    const file2 = parser.parseFile('[name] == amulet && [quality] == unique # [strength] >= 5', 'file2.nip');
    binder.bindFile(file1);
    binder.bindFile(file2);
    const js = emitter.emit([file1, file2]);
    assert.ok(js.includes('case 85'));
    assert.ok(js.includes('case 520'));
  });
});
