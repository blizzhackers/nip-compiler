import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Parser } from './parser.js';
import { Binder } from './binder.js';
import { DiagnosticSeverity, NodeKind, KeywordExprNode, BinaryExprNode } from './types.js';

const parser = new Parser();

describe('Binder', () => {
  describe('property keyword resolution', () => {
    it('resolves [n] alias to name', () => {
      const node = parser.parseLine('[n] == ring');
      const binder = new Binder();
      binder.bindLine(node);
      const expr = node.property!.expr as BinaryExprNode;
      assert.strictEqual((expr.left as KeywordExprNode).name, 'name');
    });

    it('resolves [q] alias to quality', () => {
      const node = parser.parseLine('[q] == unique');
      const binder = new Binder();
      binder.bindLine(node);
      const expr = node.property!.expr as BinaryExprNode;
      assert.strictEqual((expr.left as KeywordExprNode).name, 'quality');
    });

    it('resolves [id] alias to classid', () => {
      const node = parser.parseLine('[id] == 1');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
      const expr = node.property!.expr as BinaryExprNode;
      assert.strictEqual((expr.left as KeywordExprNode).name, 'classid');
    });

    it('resolves [t] alias to type', () => {
      const node = parser.parseLine('[t] == ring');
      const binder = new Binder();
      binder.bindLine(node);
      const expr = node.property!.expr as BinaryExprNode;
      assert.strictEqual((expr.left as KeywordExprNode).name, 'type');
    });

    it('resolves [lvl] and [ilvl] aliases to level', () => {
      for (const alias of ['lvl', 'ilvl']) {
        const node = parser.parseLine(`[${alias}] == 50`);
        const binder = new Binder();
        binder.bindLine(node);
        const expr = node.property!.expr as BinaryExprNode;
        assert.strictEqual((expr.left as KeywordExprNode).name, 'level', `Failed for alias '${alias}'`);
      }
    });

    it('resolves [f] alias to flag', () => {
      const node = parser.parseLine('[f] == ethereal');
      const binder = new Binder();
      binder.bindLine(node);
      const expr = node.property!.expr as BinaryExprNode;
      assert.strictEqual((expr.left as KeywordExprNode).name, 'flag');
    });

    it('resolves [hc] alias to hardcore', () => {
      const node = parser.parseLine('[hc] == 1');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('resolves [cl] alias to classic', () => {
      const node = parser.parseLine('[cl] == 1');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('resolves [clvl] alias to charlvl', () => {
      const node = parser.parseLine('[clvl] >= 80');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('resolves multiple aliases in one line', () => {
      const node = parser.parseLine('[n] == ring && [q] == unique && [f] != ethereal');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('reports error for unknown property keyword', () => {
      const node = parser.parseLine('[bogus] == 1');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
      assert.ok(diagnostics[0].message.includes('bogus'));
    });

    it('reports error for each unknown keyword', () => {
      const node = parser.parseLine('[foo] == 1 && [bar] == 2');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 2);
    });

    it('accepts all known property keywords without errors', () => {
      const keywords = [
        'name', 'classid', 'type', 'class', 'quality', 'level', 'flag',
        'charlvl', 'wsm', 'weaponspeed', 'minimumsockets', 'strreq', 'dexreq',
        'color', 'ladder', 'hardcore', 'classic', 'distance', 'prefix', 'suffix',
      ];
      const binder = new Binder();
      for (const kw of keywords) {
        const node = parser.parseLine(`[${kw}] == 1`);
        const { diagnostics } = binder.bindLine(node);
        assert.strictEqual(diagnostics.length, 0, `Unexpected error for keyword '${kw}': ${diagnostics.map(d => d.message).join(', ')}`);
      }
    });

    it('binds keywords inside nested expressions', () => {
      const node = parser.parseLine('([n] == ring || [n] == amulet) && [q] == unique');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('reports error for unknown keyword inside parens', () => {
      const node = parser.parseLine('([bogus] == 1)');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 1);
    });
  });

  describe('stat keyword validation', () => {
    it('passes without knownStats (no validation)', () => {
      const node = parser.parseLine('[name] == ring # [anythinggoes] == 20');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('reports error for unknown stat when knownStats provided', () => {
      const node = parser.parseLine('[name] == ring # [fakeStat] == 20');
      const binder = new Binder({ knownStats: new Set(['dexterity', 'tohit']) });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 1);
      assert.ok(diagnostics[0].message.includes('fakestat'));
    });

    it('accepts known stats', () => {
      const node = parser.parseLine('[name] == ring # [dexterity] == 20');
      const binder = new Binder({ knownStats: new Set(['dexterity']) });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('validates multiple stats in one line', () => {
      const stats = new Set(['dexterity', 'tohit']);
      const node = parser.parseLine('[name] == ring # [dexterity] == 20 && [badstat] >= 10');
      const binder = new Binder({ knownStats: stats });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 1);
      assert.ok(diagnostics[0].message.includes('badstat'));
    });

    it('validates stats in addition expressions', () => {
      const stats = new Set(['strength', 'dexterity']);
      const node = parser.parseLine('[name] == ring # [strength] + [badstat] >= 30');
      const binder = new Binder({ knownStats: stats });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 1);
    });

    it('does not validate numbers as stats', () => {
      const node = parser.parseLine('[name] == ring # [dexterity] == 20');
      const binder = new Binder({ knownStats: new Set(['dexterity']) });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });
  });

  describe('meta section validation', () => {
    it('accepts valid meta keywords', () => {
      const node = parser.parseLine('[name] == ring # # [maxquantity] == 1');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('resolves mq alias to maxquantity', () => {
      const node = parser.parseLine('[name] == ring # # [mq] == 2');
      const binder = new Binder();
      binder.bindLine(node);
      assert.strictEqual(node.meta!.entries[0].key, 'maxquantity');
    });

    it('accepts tier', () => {
      const node = parser.parseLine('[name] == ring # # [tier] == 5');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('accepts merctier', () => {
      const node = parser.parseLine('[name] == ring # # [merctier] == 99');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('reports error for unknown meta keyword', () => {
      const node = parser.parseLine('[name] == ring # # [boguskey] == 1');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 1);
      assert.ok(diagnostics[0].message.includes('boguskey'));
    });

    it('warns on duplicate meta entries', () => {
      const node = parser.parseLine('[name] == ring # # [tier] == 1 [tier] == 2');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      const warnings = diagnostics.filter(d => d.severity === DiagnosticSeverity.Warning);
      assert.strictEqual(warnings.length, 1);
      assert.ok(warnings[0].message.includes('Duplicate'));
    });

    it('reports error for non-numeric maxquantity', () => {
      const node = parser.parseLine('[name] == ring # # [maxquantity] == lots');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.ok(diagnostics.some(d => d.message.includes('maxquantity must be a number')));
    });

    it('reports error for negative maxquantity', () => {
      const node = parser.parseLine('[name] == ring # # [maxquantity] == -1');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.ok(diagnostics.some(d => d.message.includes('non-negative')));
    });

    it('accepts tier with negative value', () => {
      const node = parser.parseLine('[name] == ring # # [tier] == -1');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });
  });

  describe('property value validation', () => {
    const knownPropertyValues = new Map([
      ['quality', new Set(['unique', 'rare', 'magic', 'set', 'normal', 'superior', 'craft', 'lowquality'])],
      ['type', new Set(['ring', 'amulet', 'armor', 'helm', 'boots', 'gloves', 'belt'])],
    ]);

    it('reports error for unknown quality value', () => {
      const node = parser.parseLine('[quality] == legendary');
      const binder = new Binder({ knownPropertyValues });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 1);
      assert.ok(diagnostics[0].message.includes('legendary'));
    });

    it('passes for valid quality value', () => {
      const node = parser.parseLine('[quality] == unique');
      const binder = new Binder({ knownPropertyValues });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('reports error for wrong type value', () => {
      const node = parser.parseLine('[type] == banana');
      const binder = new Binder({ knownPropertyValues });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 1);
    });

    it('passes for valid type value', () => {
      const node = parser.parseLine('[type] == ring');
      const binder = new Binder({ knownPropertyValues });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('does not validate numeric values against property enums', () => {
      const node = parser.parseLine('[quality] == 7');
      const binder = new Binder({ knownPropertyValues });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('validates values on both sides of ||', () => {
      const node = parser.parseLine('[quality] == legendary || [quality] == mythic');
      const binder = new Binder({ knownPropertyValues });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 2);
    });

    it('does not validate when knownPropertyValues not provided', () => {
      const node = parser.parseLine('[quality] == legendary');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('validates after alias resolution', () => {
      const node = parser.parseLine('[q] == legendary');
      const binder = new Binder({ knownPropertyValues });
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 1);
      assert.ok(diagnostics[0].message.includes('legendary'));
    });
  });

  describe('diagnostic locations', () => {
    it('error has location info', () => {
      const node = parser.parseLine('[bogus] == 1');
      const binder = new Binder();
      const { diagnostics } = binder.bindLine(node);
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(typeof diagnostics[0].loc.pos, 'number');
      assert.strictEqual(typeof diagnostics[0].loc.line, 'number');
      assert.strictEqual(typeof diagnostics[0].loc.col, 'number');
    });
  });

  describe('file binding', () => {
    it('binds all lines and collects diagnostics', () => {
      const input = [
        '[name] == ring # [dex] == 20',
        '[bogus] == 1',
      ].join('\n');
      const file = parser.parseFile(input);
      const binder = new Binder();
      const { diagnostics } = binder.bindFile(file);
      assert.strictEqual(diagnostics.length, 1);
      assert.ok(diagnostics[0].message.includes('bogus'));
    });

    it('collects diagnostics from multiple lines', () => {
      const input = [
        '[bogus1] == 1',
        '[bogus2] == 2',
        '[name] == ring',
      ].join('\n');
      const file = parser.parseFile(input);
      const binder = new Binder();
      const { diagnostics } = binder.bindFile(file);
      assert.strictEqual(diagnostics.length, 2);
    });

    it('returns empty diagnostics for clean file', () => {
      const input = '[name] == ring && [quality] == unique # [dexterity] == 20';
      const file = parser.parseFile(input);
      const binder = new Binder();
      const { diagnostics } = binder.bindFile(file);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('diagnostics have file-level line numbers', () => {
      const input = [
        '[name] == ring',
        '',
        '[bogus] == 1',
      ].join('\n');
      const file = parser.parseFile(input);
      const binder = new Binder();
      const { diagnostics } = binder.bindFile(file);
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].loc.line, 3, 'diagnostic should be on line 3');
    });

    it('validates property values when knownPropertyValues provided', () => {
      const input = '[name] == ber';
      const file = parser.parseFile(input);
      const binder = new Binder({
        knownPropertyValues: new Map([['name', new Set(['berrune', 'ring'])]]),
      });
      const { diagnostics } = binder.bindFile(file);
      assert.strictEqual(diagnostics.length, 1);
      assert.ok(diagnostics[0].message.includes('ber'));
    });

    it('does not flag >= values against knownPropertyValues', () => {
      const input = '[name] >= istrune && [name] <= zodrune';
      const file = parser.parseFile(input);
      const binder = new Binder({
        knownPropertyValues: new Map([['name', new Set(['istrune', 'zodrune'])]]),
      });
      const { diagnostics } = binder.bindFile(file);
      assert.strictEqual(diagnostics.length, 0);
    });
  });
});
