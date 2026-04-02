import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Parser } from '../parser.js';
import { Binder } from '../binder.js';
import { Analyzer } from './analyzer.js';
import { Grouper } from './grouper.js';
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
    assert.ok(result.tierExpr);
    assert.strictEqual(result.tierExpr!.kind, NodeKind.NumberLiteral);
    if (result.tierExpr!.kind === NodeKind.NumberLiteral) {
      assert.strictEqual(result.tierExpr!.value, 5);
    }
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

describe('Emitter', () => {
  const emitter = new Emitter({ aliases: testAliases, includeSourceComments: true });

  it('emits valid JavaScript from a simple rule', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 // soj', 'test.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    assert.ok(js.includes('function checkItem'));
    assert.ok(js.includes('function getTier'));
    assert.ok(js.includes('function getMercTier'));
    // classid dispatched via Uint16Array _mi[key], dense array _m[key], or switch case
    assert.ok(js.includes('85') || js.includes('_mi[') || js.includes('_mi[') || js.includes('_m['));
  });

  it('emitted code is valid JS (can be eval\'d)', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'test.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    const factory = eval(js);
    assert.strictEqual(typeof factory, 'function');
  });

  it('checkItem returns 1 (no verbose) for matching item', () => {
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
      classid: 85, quality: 7, itemType: 10,
      getFlag: (f: number) => f === 0x10 ? 0x10 : 0,
      getStatEx: (id: number) => id === 9 ? 25 : 0,
    };

    assert.strictEqual(mod.checkItem(mockItem), 1);
  });

  it('checkItem returns {result, file, line} in verbose mode', () => {
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
      classid: 85, quality: 7, itemType: 10,
      getFlag: (f: number) => f === 0x10 ? 0x10 : 0,
      getStatEx: (id: number) => id === 9 ? 25 : 0,
    };

    const result = mod.checkItem(mockItem, true);
    assert.strictEqual(result.result, 1);
    assert.strictEqual(result.file, 'test.nip');
    assert.strictEqual(result.line, 1);
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
      classid: 520, quality: 7, itemType: 12,
      getFlag: () => 0x10, getStatEx: () => 0,
    };

    assert.strictEqual(mod.checkItem(mockItem), 0);
    const verbose = mod.checkItem(mockItem, true);
    assert.strictEqual(verbose.result, 0);
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
      classid: 85, quality: 7, itemType: 10,
      getFlag: () => 0, getStatEx: () => 0,
    };

    assert.strictEqual(mod.checkItem(mockItem), -1);
    const verbose = mod.checkItem(mockItem, true);
    assert.strictEqual(verbose.result, -1);
    assert.strictEqual(verbose.file, 'test.nip');
    assert.strictEqual(verbose.line, 1);
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

    const result = mod.checkItem(mockItem, true);
    assert.strictEqual(result.file, 'kolton.nip');
    assert.strictEqual(result.line, 1);
  });

  it('handles type dispatch rules', () => {
    const file = parser.parseFile('[type] == armor && [quality] == rare # [enhanceddefense] >= 150', 'test.nip');
    binder.bindFile(file);
    const js = emitter.emit([file]);
    assert.ok(js.includes('i.itemType'));
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

    assert.strictEqual(mod.checkItem(mockItem), 1);
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

    assert.strictEqual(mod.checkItem(mockItem), 1);
  });

  it('emits multiple files into one module', () => {
    const file1 = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'file1.nip');
    const file2 = parser.parseFile('[name] == amulet && [quality] == unique # [strength] >= 5', 'file2.nip');
    binder.bindFile(file1);
    binder.bindFile(file2);
    const js = emitter.emit([file1, file2]);
    assert.ok(js.includes('85') || js.includes('_mi[') || js.includes('_m['));
    assert.ok(js.includes('520') || js.includes('_mi[') || js.includes('_m['));
  });
});

describe('Emitter ESTree path', () => {
  const helpers = {
    checkQuantityOwned: () => 0,
    me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
    getBaseStat: () => 0,
  };

  it('emitAST + generate produces valid JS', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'test.nip');
    binder.bindFile(file);
    const em = new Emitter({ aliases: testAliases, includeSourceComments: true });
    const ast = em.emitAST([file]);
    const { code } = em.generate(ast);
    assert.ok(code.includes('function checkItem'));
    assert.ok(code.includes('function getTier'));
    const factory = eval(code);
    assert.strictEqual(typeof factory, 'function');
  });

  it('ESTree checkItem returns correct results', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'test.nip');
    binder.bindFile(file);
    const em = new Emitter({ aliases: testAliases, includeSourceComments: true });
    const ast = em.emitAST([file]);
    const { code } = em.generate(ast);
    const factory = eval(code);
    const mod = factory(helpers);

    const matchItem = {
      classid: 85, quality: 7, itemType: 10,
      getFlag: (f: number) => f === 0x10 ? 0x10 : 0,
      getStatEx: (id: number) => id === 9 ? 25 : 0,
    };
    assert.strictEqual(mod.checkItem(matchItem), 1);

    const noMatch = {
      classid: 520, quality: 7, itemType: 12,
      getFlag: () => 0x10, getStatEx: () => 0,
    };
    assert.strictEqual(mod.checkItem(noMatch), 0);
  });

  it('ESTree verbose returns file and line', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'test.nip');
    binder.bindFile(file);
    const em = new Emitter({ aliases: testAliases, includeSourceComments: true });
    const ast = em.emitAST([file]);
    const { code } = em.generate(ast);
    const factory = eval(code);
    const mod = factory(helpers);

    const item = {
      classid: 85, quality: 7, itemType: 10,
      getFlag: (f: number) => f === 0x10 ? 0x10 : 0,
      getStatEx: (id: number) => id === 9 ? 25 : 0,
    };
    const result = mod.checkItem(item, true);
    assert.strictEqual(result.result, 1);
    assert.strictEqual(result.file, 'test.nip');
    assert.strictEqual(result.line, 1);
  });

  it('ESTree getTier works', () => {
    const input = [
      '[name] == ring && [quality] == unique # # [tier] == 5',
      '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 # [tier] == 99',
    ].join('\n');
    const file = parser.parseFile(input, 'tier.nip');
    binder.bindFile(file);
    const em = new Emitter({ aliases: testAliases, includeSourceComments: true });
    const ast = em.emitAST([file]);
    const { code } = em.generate(ast);
    const factory = eval(code);
    const mod = factory(helpers);

    const item = {
      classid: 85, quality: 7, itemType: 10,
      getFlag: () => 0x10,
      getStatEx: (id: number) => id === 9 ? 25 : 0,
    };
    assert.strictEqual(mod.getTier(item), 99);
  });

  it('ESTree generate with source map', () => {
    const file = parser.parseFile('[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25', 'test.nip');
    binder.bindFile(file);
    const em = new Emitter({ aliases: testAliases, includeSourceComments: true });
    const ast = em.emitAST([file]);
    const result = em.generate(ast, { sourceMap: true });
    assert.ok(result.code.length > 0);
    assert.ok(result.map);
    const map = JSON.parse(result.map!);
    assert.strictEqual(map.version, 3);
  });

  describe('tier expressions', () => {
    function freshAliases(): AliasMapSet {
      return {
        classId: { ring: 85, amulet: 520, duskshroud: 467, monarch: 443, archonplate: 415 },
        type: { ring: 10, amulet: 12, armor: 3, shield: 2, helm: 37, boots: 15, belt: 19 },
        quality: { lowquality: 1, normal: 2, superior: 3, magic: 4, set: 5, rare: 6, unique: 7, crafted: 8 },
        flag: { identified: 0x10, ethereal: 0x400000, runeword: 0x4000000 },
        stat: { maxmana: 9, itemmaxmanapercent: 77, defense: 31, maxhp: 7, strength: 0 },
        color: {}, class: {},
      };
    }

    function evalTier(input: string, stats: Record<number, number>): number {
      const p = new Parser();
      const b = new Binder();
      const file = p.parseFile(input, 'tier.nip');
      b.bindFile(file);
      const em = new Emitter({ aliases: freshAliases(), includeSourceComments: false });
      const code = em.emit([file]);
      const mod = new Function('return ' + code)()(helpers);
      return mod.getTier({
        classid: 85, quality: 7, itemType: 10,
        getFlag: () => 0x10,
        getStatEx: (id: number, param?: number) => {
          const key = param !== undefined ? id * 1000 + param : id;
          return stats[key] ?? 0;
        },
      });
    }

    it('simple [tier] == constant', () => {
      assert.strictEqual(evalTier(
        '[name] == ring && [quality] == unique # # [tier] == 42',
        {},
      ), 42);
    });

    it('[tier] == stat expression', () => {
      const result = evalTier(
        '[name] == ring && [quality] == unique # # [tier] == [maxmana]',
        { 9: 120 },
      );
      assert.strictEqual(result, 120);
    });

    it('[tier] == arithmetic expression', () => {
      // tier = [maxmana] + [defense] * 2
      assert.strictEqual(evalTier(
        '[name] == ring && [quality] == unique # # [tier] == [maxmana] + [defense] * 2',
        { 9: 100, 31: 50 },
      ), 200); // 100 + 50*2 = 200
    });

    it('[tier] == complex expression with division', () => {
      // tier = ([maxhp] + [maxmana]) / 2
      assert.strictEqual(evalTier(
        '[name] == ring && [quality] == unique # # [tier] == ([maxhp] + [maxmana]) / 2',
        { 7: 80, 9: 120 },
      ), 100); // (80 + 120) / 2 = 100
    });

    it('[tier] == expression with subtraction', () => {
      // tier = [defense] - [strength]
      assert.strictEqual(evalTier(
        '[name] == ring && [quality] == unique # # [tier] == [defense] - [strength]',
        { 31: 150, 0: 30 },
      ), 120); // 150 - 30
    });

    it('highest tier wins across multiple rules', () => {
      const input = [
        '[name] == ring && [quality] == unique # # [tier] == [maxmana]',
        '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 # [tier] == [maxmana] * 2',
      ].join('\n');
      const p = new Parser();
      const b = new Binder();
      const file = p.parseFile(input, 'tier.nip');
      b.bindFile(file);
      const em = new Emitter({ aliases: freshAliases(), includeSourceComments: false });
      const code = em.emit([file]);
      const mod = new Function('return ' + code)()(helpers);
      const item = {
        classid: 85, quality: 7, itemType: 10,
        getFlag: () => 0x10,
        getStatEx: (id: number) => id === 9 ? 50 : id === 77 ? 25 : 0,
      };
      // First rule: tier = 50, second rule (stat matches): tier = 100
      assert.strictEqual(mod.getTier(item), 100);
    });
  });
});
