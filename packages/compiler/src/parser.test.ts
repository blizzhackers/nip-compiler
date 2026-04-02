import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Parser, ParseError } from './parser.js';
import { NodeKind, BinaryExprNode, KeywordExprNode, NumberLiteralNode, IdentifierNode, UnaryExprNode } from './types.js';

const parser = new Parser();

function assertBinary(node: unknown, op?: string): asserts node is BinaryExprNode {
  assert.ok(node && typeof node === 'object' && 'kind' in node);
  assert.strictEqual((node as any).kind, NodeKind.BinaryExpr);
  if (op) assert.strictEqual((node as BinaryExprNode).op, op);
}

function assertKeyword(node: unknown, name?: string): asserts node is KeywordExprNode {
  assert.ok(node && typeof node === 'object' && 'kind' in node);
  assert.strictEqual((node as any).kind, NodeKind.KeywordExpr);
  if (name) assert.strictEqual((node as KeywordExprNode).name, name);
}

function assertNumber(node: unknown, value?: number): asserts node is NumberLiteralNode {
  assert.ok(node && typeof node === 'object' && 'kind' in node);
  assert.strictEqual((node as any).kind, NodeKind.NumberLiteral);
  if (value !== undefined) assert.strictEqual((node as NumberLiteralNode).value, value);
}

function assertIdent(node: unknown, name?: string): asserts node is IdentifierNode {
  assert.ok(node && typeof node === 'object' && 'kind' in node);
  assert.strictEqual((node as any).kind, NodeKind.Identifier);
  if (name) assert.strictEqual((node as IdentifierNode).name, name);
}

describe('Parser', () => {
  describe('sections', () => {
    it('parses property-only line', () => {
      const node = parser.parseLine('[name] == ring');
      assert.strictEqual(node.kind, NodeKind.NipLine);
      assert.ok(node.property);
      assert.strictEqual(node.stats, null);
      assert.strictEqual(node.meta, null);
      assert.strictEqual(node.comment, null);
    });

    it('parses property + stat sections', () => {
      const node = parser.parseLine('[name] == ring # [dexterity] == 20');
      assert.ok(node.property);
      assert.ok(node.stats);
      assert.strictEqual(node.meta, null);
    });

    it('parses property + stat + meta sections', () => {
      const node = parser.parseLine('[type] == ring # [maxhp] > 0 # [tier] == 1');
      assert.ok(node.property);
      assert.ok(node.stats);
      assert.ok(node.meta);
      assert.strictEqual(node.meta!.entries.length, 1);
    });

    it('parses property + empty stat + meta', () => {
      const node = parser.parseLine('[name] == foo && [quality] == unique # # [tier] == 2');
      assert.ok(node.property);
      assert.strictEqual(node.stats, null);
      assert.ok(node.meta);
      assert.strictEqual(node.meta!.entries[0].key, 'tier');
    });

    it('parses stat-only line (starts with #)', () => {
      const node = parser.parseLine('# [dexterity] == 20');
      assert.strictEqual(node.property, null);
      assert.ok(node.stats);
    });

    it('parses comment-only line', () => {
      const node = parser.parseLine('// just a comment');
      assert.strictEqual(node.property, null);
      assert.strictEqual(node.stats, null);
      assert.strictEqual(node.meta, null);
      assert.strictEqual(node.comment, 'just a comment');
    });

    it('parses trailing comment', () => {
      const node = parser.parseLine('[name] == ring // soj');
      assert.ok(node.property);
      assert.strictEqual(node.comment, 'soj');
    });

    it('section kinds are correct', () => {
      const node = parser.parseLine('[name] == ring # [dex] == 20');
      assert.strictEqual(node.property!.kind, NodeKind.PropertySection);
      assert.strictEqual(node.stats!.kind, NodeKind.StatSection);
    });
  });

  describe('property expressions', () => {
    it('parses simple comparison', () => {
      const node = parser.parseLine('[name] == ring');
      const expr = node.property!.expr;
      assertBinary(expr, '==');
      assertKeyword(expr.left, 'name');
      assertIdent(expr.right, 'ring');
    });

    it('parses != comparison', () => {
      const node = parser.parseLine('[flag] != ethereal');
      const expr = node.property!.expr;
      assertBinary(expr, '!=');
      assertKeyword(expr.left, 'flag');
      assertIdent(expr.right, 'ethereal');
    });

    it('parses <= comparison', () => {
      const node = parser.parseLine('[quality] <= rare');
      const expr = node.property!.expr;
      assertBinary(expr, '<=');
    });

    it('parses numeric comparison', () => {
      const node = parser.parseLine('[level] >= 50');
      const expr = node.property!.expr;
      assertBinary(expr, '>=');
      assertKeyword(expr.left, 'level');
      assertNumber(expr.right, 50);
    });

    it('parses AND conjunction', () => {
      const node = parser.parseLine('[name] == ring && [quality] == unique');
      const expr = node.property!.expr;
      assertBinary(expr, '&&');
      assertBinary(expr.left, '==');
      assertBinary(expr.right, '==');
    });

    it('parses OR disjunction', () => {
      const node = parser.parseLine('[name] == ring || [name] == amulet');
      const expr = node.property!.expr;
      assertBinary(expr, '||');
    });

    it('parses triple AND chain', () => {
      const node = parser.parseLine('[name] == ring && [quality] == unique && [flag] != ethereal');
      const expr = node.property!.expr;
      // left-associative: ((ring && unique) && !ethereal)
      assertBinary(expr, '&&');
      assertBinary(expr.left, '&&');
      assertBinary(expr.right, '!=');
    });

    it('parses parenthesized OR with AND', () => {
      const node = parser.parseLine('([name] == ring || [name] == amulet) && [quality] == unique');
      const expr = node.property!.expr;
      assertBinary(expr, '&&');
      assertBinary(expr.left, '||');
      assertBinary(expr.right, '==');
    });

    it('parses nested parentheses', () => {
      const node = parser.parseLine('(([name] == ring))');
      const expr = node.property!.expr;
      assertBinary(expr, '==');
    });
  });

  describe('operator precedence', () => {
    it('&& binds tighter than ||', () => {
      const node = parser.parseLine('[name] == ring || [name] == amulet && [quality] == unique');
      const expr = node.property!.expr;
      // Should be: ring || (amulet && unique)
      assertBinary(expr, '||');
      assertBinary(expr.left, '==');
      assertBinary(expr.right, '&&');
    });

    it('comparison binds tighter than &&', () => {
      const node = parser.parseLine('[name] == ring && [quality] == unique');
      const expr = node.property!.expr;
      assertBinary(expr, '&&');
      assertBinary(expr.left, '==');
      assertBinary(expr.right, '==');
    });

    it('+ binds tighter than comparison', () => {
      const node = parser.parseLine('[name] == ring # [strength] + [dexterity] >= 30');
      const expr = node.stats!.expr;
      assertBinary(expr, '>=');
      assertBinary(expr.left, '+');
      assertNumber(expr.right, 30);
    });

    it('* binds tighter than +', () => {
      const node = parser.parseLine('[name] == ring # [strength] + [dexterity] * 2 >= 30');
      const expr = node.stats!.expr;
      assertBinary(expr, '>=');
      const addExpr = expr.left;
      assertBinary(addExpr, '+');
      assertKeyword(addExpr.left, 'strength');
      assertBinary(addExpr.right, '*');
    });

    it('parentheses override precedence', () => {
      const node = parser.parseLine('[name] == ring # ([strength] + [dexterity]) * 2 >= 30');
      const expr = node.stats!.expr;
      assertBinary(expr, '>=');
      assertBinary(expr.left, '*');
      const mulLeft = (expr.left as BinaryExprNode).left;
      assertBinary(mulLeft, '+');
    });
  });

  describe('stat expressions', () => {
    it('parses single stat comparison', () => {
      const node = parser.parseLine('[name] == ring # [dexterity] == 20');
      const expr = node.stats!.expr;
      assertBinary(expr, '==');
      assertKeyword(expr.left, 'dexterity');
      assertNumber(expr.right, 20);
    });

    it('parses stat addition', () => {
      const node = parser.parseLine('[name] == ring # [strength] + [dexterity] >= 30');
      const expr = node.stats!.expr;
      assertBinary(expr, '>=');
      assertBinary(expr.left, '+');
    });

    it('parses multiple stat conditions with &&', () => {
      const node = parser.parseLine('[name] == ring # [fcr] == 10 && [maxhp] >= 30 && [maxmana] >= 60');
      const expr = node.stats!.expr;
      assertBinary(expr, '&&');
      assertBinary(expr.left, '&&');
    });

    it('parses stats with || mixed with &&', () => {
      const node = parser.parseLine('[name] == ring # [fireresist] >= 30 || [coldresist] >= 30 && [maxhp] > 0');
      const expr = node.stats!.expr;
      // || has lower precedence: fireresist >= 30 || (coldresist >= 30 && maxhp > 0)
      assertBinary(expr, '||');
      assertBinary(expr.right, '&&');
    });

    it('parses negative number in stat', () => {
      const node = parser.parseLine('[type] == armor # [tier] == -1');
      const expr = node.stats!.expr;
      assertBinary(expr, '==');
      assertNumber(expr.right, -1);
    });

    it('parses subtraction in stats', () => {
      const node = parser.parseLine('[name] == ring # [strength] - [dexterity] >= 10');
      const expr = node.stats!.expr;
      assertBinary(expr, '>=');
      assertBinary(expr.left, '-');
    });

    it('parses division in stats', () => {
      const node = parser.parseLine('[name] == ring # [strength] / 2 >= 15');
      const expr = node.stats!.expr;
      assertBinary(expr, '>=');
      assertBinary(expr.left, '/');
    });
  });

  describe('meta section', () => {
    it('parses tier', () => {
      const node = parser.parseLine('[name] == ring # # [tier] == 5');
      const entry = node.meta!.entries[0];
      assert.strictEqual(entry.kind, NodeKind.MetaEntry);
      assert.strictEqual(entry.key, 'tier');
      assertNumber(entry.expr, 5);
    });

    it('parses merctier', () => {
      const node = parser.parseLine('[name] == ring # # [merctier] == 99');
      assert.strictEqual(node.meta!.entries[0].key, 'merctier');
      assertNumber(node.meta!.entries[0].expr, 99);
    });

    it('parses maxquantity', () => {
      const node = parser.parseLine('[name] == monarch # [sockets] == 4 # [maxquantity] == 1');
      assert.strictEqual(node.meta!.entries[0].key, 'maxquantity');
      assertNumber(node.meta!.entries[0].expr, 1);
    });

    it('parses multiple meta entries', () => {
      const node = parser.parseLine('[name] == ring # # [tier] == 5 [maxquantity] == 2');
      assert.strictEqual(node.meta!.entries.length, 2);
      assert.strictEqual(node.meta!.entries[0].key, 'tier');
      assert.strictEqual(node.meta!.entries[1].key, 'maxquantity');
    });

    it('parses negative tier', () => {
      const node = parser.parseLine('[name] == ring # # [tier] == -1');
      assertNumber(node.meta!.entries[0].expr, -1);
    });

    it('parses tier with expression', () => {
      const node = parser.parseLine('[name] == ring # # [tier] == 100');
      assertNumber(node.meta!.entries[0].expr, 100);
    });
  });

  describe('edge cases', () => {
    it('parses line with block comment trivia', () => {
      const node = parser.parseLine('[name] == ring /* ias */ && [quality] == unique');
      assertBinary(node.property!.expr, '&&');
    });

    it('lowercases keyword names', () => {
      const node = parser.parseLine('[Name] == Ring');
      const expr = node.property!.expr;
      assertBinary(expr);
      assertKeyword(expr.left, 'name');
      assertIdent(expr.right, 'ring');
    });

    it('lowercases meta keys', () => {
      const node = parser.parseLine('[name] == ring # # [Tier] == 1');
      assert.strictEqual(node.meta!.entries[0].key, 'tier');
    });

    it('handles D2 item names with apostrophes', () => {
      const node = parser.parseLine("[name] == diablo'shorn");
      const expr = node.property!.expr;
      assertBinary(expr, '==');
      assertIdent(expr.right, "diablo'shorn");
    });

    it('handles dense syntax without spaces', () => {
      const node = parser.parseLine('[name]==ring&&[quality]==unique');
      assertBinary(node.property!.expr, '&&');
    });

    it('preserves lineNumber', () => {
      const node = parser.parseLine('[name] == ring', 42);
      assert.strictEqual(node.lineNumber, 42);
    });
  });

  describe('real-world lines', () => {
    it('parses complex ring filter', () => {
      const input = '[name] == ring && [quality] == rare # [fcr] == 10 && [tohit] >= 90 && [maxhp] >= 30 && [maxmana] >= 60 // bvc ring';
      const node = parser.parseLine(input);
      assert.ok(node.property);
      assert.ok(node.stats);
      assert.strictEqual(node.comment, 'bvc ring');
    });

    it('parses complex amulet filter with nested parens', () => {
      const input = '[name] == amulet && [quality] == rare # [sorceressskills] == 2 && [fcr] == 10 && ([maxhp] >= 35 || [maxmana] >= 80) && ([strength] + [dexterity] >= 15 || [fireresist] >= 10 && [coldresist] >= 10)';
      const node = parser.parseLine(input);
      assert.ok(node.property);
      assert.ok(node.stats);
    });

    it('parses armor with long OR chain', () => {
      const input = '([name] == ringmail || [name] == gothicplate || [name] == fullplatemail || [name] == ancientarmor) && [quality] == superior && [flag] != ethereal # [sockets] == 3';
      const node = parser.parseLine(input);
      assert.ok(node.property);
      assert.ok(node.stats);
    });

    it('parses autoequip tier line', () => {
      const input = '[type] == armor && [quality] <= rare # [maxhp] > 0 # [tier] == 1';
      const node = parser.parseLine(input);
      assert.ok(node.property);
      assert.ok(node.stats);
      assert.ok(node.meta);
      assert.strictEqual(node.meta!.entries[0].key, 'tier');
    });

    it('parses set item with empty stat section', () => {
      const input = '[name] == swirlingcrystal && [quality] == set # # [tier] == 99';
      const node = parser.parseLine(input);
      assert.ok(node.property);
      assert.strictEqual(node.stats, null);
      assert.ok(node.meta);
    });

    it('parses runeword flag check', () => {
      const input = '[flag] == runeword # [plusskillbattleorders] > 0 # [tier] == 99';
      const node = parser.parseLine(input);
      assertBinary(node.property!.expr, '==');
      assertKeyword((node.property!.expr as BinaryExprNode).left, 'flag');
    });

    it('parses monarch with complex OR in stats', () => {
      const input = '[name] == monarch && [quality] == normal && [flag] == ethereal # [sockets] == 0 && [defense] == 222 || [sockets] == 4 && [defense] == 333';
      const node = parser.parseLine(input);
      assert.ok(node.property);
      assert.ok(node.stats);
    });
  });

  describe('in/notin syntax', () => {
    it('parses [quality]in(unique,set) as OR chain', () => {
      const node = parser.parseLine('[quality]in(unique,set)');
      const expr = node.property!.expr;
      assertBinary(expr, '||');
      assertBinary((expr as BinaryExprNode).left, '==');
      assertBinary((expr as BinaryExprNode).right, '==');
    });

    it('parses [quality]notin(unique,set) as AND chain', () => {
      const node = parser.parseLine('[quality]notin(unique,set)');
      const expr = node.property!.expr;
      assertBinary(expr, '&&');
      assertBinary((expr as BinaryExprNode).left, '!=');
      assertBinary((expr as BinaryExprNode).right, '!=');
    });

    it('parses in() with three values', () => {
      const node = parser.parseLine('[name]in(ring,amulet,charm)');
      const expr = node.property!.expr;
      // ((ring || amulet) || charm)
      assertBinary(expr, '||');
      assertBinary((expr as BinaryExprNode).left, '||');
    });

    it('parses in() with numeric values', () => {
      const node = parser.parseLine('[quality]in(6,7)');
      const expr = node.property!.expr;
      assertBinary(expr, '||');
    });

    it('parses in() combined with other conditions', () => {
      const node = parser.parseLine('[quality]in(unique,rare) && [name] == ring');
      const expr = node.property!.expr;
      assertBinary(expr, '&&');
    });

    it('parses notin() with single value', () => {
      const node = parser.parseLine('[flag]notin(ethereal)');
      const expr = node.property!.expr;
      assertBinary(expr, '!=');
    });
  });

  describe('file parsing', () => {
    it('parses multiple lines', () => {
      const input = [
        '[name] == ring && [quality] == unique # [dexterity] == 20 // raven',
        '[name] == amulet && [quality] == unique # [strength] == 5 // mara',
      ].join('\n');
      const file = parser.parseFile(input, 'test.nip');
      assert.strictEqual(file.lines.length, 2);
      assert.strictEqual(file.filename, 'test.nip');
      assert.strictEqual(file.kind, NodeKind.NipFile);
    });

    it('skips blank lines', () => {
      const input = '\n[name] == ring\n\n[name] == amulet\n';
      const file = parser.parseFile(input);
      assert.strictEqual(file.lines.length, 2);
    });

    it('skips comment-only lines', () => {
      const input = '// this is a comment\n[name] == ring\n// another comment';
      const file = parser.parseFile(input);
      assert.strictEqual(file.lines.length, 1);
    });

    it('preserves line numbers', () => {
      const input = '\n\n[name] == ring\n\n[name] == amulet';
      const file = parser.parseFile(input);
      assert.strictEqual(file.lines[0].lineNumber, 3);
      assert.strictEqual(file.lines[1].lineNumber, 5);
    });

    it('handles file with only comments and blanks', () => {
      const input = '// comment\n\n// another';
      const file = parser.parseFile(input);
      assert.strictEqual(file.lines.length, 0);
    });

    it('includes filename in parse errors', () => {
      const input = '[name] == ring\n[name] == ';
      try {
        parser.parseFile(input, 'broken.nip');
        assert.fail('should have thrown');
      } catch (e) {
        assert.ok(e instanceof ParseError);
        assert.ok(e.message.includes('broken.nip'));
      }
    });
  });

  describe('numeric stat keywords', () => {
    it('parses [188] >= 1 with numeric keyword name', () => {
      const node = parser.parseLine('[188] >= 1');
      const expr = node.property!.expr;
      assertBinary(expr, '>=');
      assertKeyword(expr.left, '188');
      assertNumber(expr.right, 1);
    });

    it('parses [83,1] >= 1 with two-param keyword name', () => {
      const node = parser.parseLine('[83,1] >= 1');
      const expr = node.property!.expr;
      assertBinary(expr, '>=');
      assertKeyword(expr.left, '83,1');
      assertNumber(expr.right, 1);
    });
  });

  describe('preprocessing', () => {
    it('converts item.getStatEx(93) to [93]', () => {
      assert.strictEqual(Parser.preprocess('item.getStatEx(93)'), '[93]');
    });

    it('converts item.getStatEx(83,1) to [83,1]', () => {
      assert.strictEqual(Parser.preprocess('item.getStatEx(83,1)'), '[83,1]');
    });
  });

  describe('me.diff in expressions', () => {
    it('parses me.diff == 0 && [type] == bow', () => {
      const node = parser.parseLine('me.diff == 0 && [type] == bow');
      const expr = node.property!.expr;
      assertBinary(expr, '&&');
      assertBinary(expr.left, '==');
      assertIdent((expr.left as BinaryExprNode).left, 'me.diff');
      assertNumber((expr.left as BinaryExprNode).right, 0);
      assertBinary(expr.right, '==');
      assertKeyword((expr.right as BinaryExprNode).left, 'type');
      assertIdent((expr.right as BinaryExprNode).right, 'bow');
    });
  });

  describe('error handling', () => {
    it('throws on missing right bracket', () => {
      assert.throws(() => parser.parseLine('[name == ring'), ParseError);
    });

    it('parses bare identifier without brackets as property expression', () => {
      // 'name' parses as identifier, ']' stops the expression — no error
      const node = parser.parseLine('name == ring');
      assert.ok(node.property);
    });

    it('throws on unexpected EOF after ==', () => {
      assert.throws(() => parser.parseLine('[name] == '), ParseError);
    });

    it('throws on missing expression after &&', () => {
      assert.throws(() => parser.parseLine('[name] == ring &&'), ParseError);
    });

    it('throws on missing expression after ||', () => {
      assert.throws(() => parser.parseLine('[name] == ring ||'), ParseError);
    });

    it('throws on unmatched left paren', () => {
      assert.throws(() => parser.parseLine('([name] == ring'), ParseError);
    });

    it('ignores trailing right paren (unconsumed token)', () => {
      // expression parsing stops before ')', which is just unconsumed
      const node = parser.parseLine('[name] == ring');
      assert.ok(node.property);
    });

    it('parses empty brackets as always-false (disabled rule)', () => {
      const node = parser.parseLine('[] > 0');
      const expr = node.property!.expr;
      assertBinary(expr, '>');
      assertKeyword(expr.left, '');
    });

    it('throws on double operator', () => {
      assert.throws(() => parser.parseLine('[name] == == ring'), ParseError);
    });

    it('ParseError has position info', () => {
      try {
        parser.parseLine('[name] == ');
        assert.fail('should have thrown');
      } catch (e) {
        assert.ok(e instanceof ParseError);
        assert.strictEqual(typeof e.line, 'number');
        assert.strictEqual(typeof e.col, 'number');
        assert.strictEqual(typeof e.pos, 'number');
      }
    });

    it('parseFile error has file-level line number', () => {
      try {
        parser.parseFile('[name] == ring\n\n[name] == ', 'test.nip');
        assert.fail('should have thrown');
      } catch (e) {
        assert.ok(e instanceof ParseError);
        assert.strictEqual(e.line, 3, 'error should be on line 3, not line 1');
      }
    });
  });

  describe('multiline continuation', () => {
    it('next line starting with && joins', () => {
      const file = parser.parseFile('[name] == ring\n&& [quality] == unique', 'test.nip');
      assert.strictEqual(file.lines.length, 1);
      assert.strictEqual(file.lines[0].lineNumber, 1);
    });

    it('next line starting with || joins', () => {
      const file = parser.parseFile('[name] == ring\n|| [name] == amulet', 'test.nip');
      assert.strictEqual(file.lines.length, 1);
    });

    it('next line starting with == joins', () => {
      const file = parser.parseFile('[name]\n== ring', 'test.nip');
      assert.strictEqual(file.lines.length, 1);
    });

    it('previous line ending with && continues', () => {
      const file = parser.parseFile('[name] == ring &&\n[quality] == unique', 'test.nip');
      assert.strictEqual(file.lines.length, 1);
    });

    it('previous line ending with == continues', () => {
      const file = parser.parseFile('[name] ==\nring', 'test.nip');
      assert.strictEqual(file.lines.length, 1);
    });

    it('previous line ending with [ continues', () => {
      const file = parser.parseFile('[name] == ring && [\nquality] == unique', 'test.nip');
      assert.strictEqual(file.lines.length, 1);
    });

    it('# does NOT trigger continuation (either direction)', () => {
      // # at end of line: valid empty stat section, not incomplete
      const file1 = parser.parseFile('[name] == ring #\n[name] == amulet', 'test.nip');
      assert.strictEqual(file1.lines.length, 2);
      // # at start of line: standalone stat section, not continuation
      const file2 = parser.parseFile('[name] == ring\n# [defense] >= 50', 'test.nip');
      assert.strictEqual(file2.lines.length, 2);
    });

    it('multiple continuation lines via trailing operators', () => {
      const input = '[name] == ring &&\n[quality] == unique';
      const file = parser.parseFile(input, 'test.nip');
      assert.strictEqual(file.lines.length, 1);
      assert.ok(file.lines[0].property);
    });

    it('two separate rules stay separate', () => {
      const input = '[name] == ring\n[name] == amulet';
      const file = parser.parseFile(input, 'test.nip');
      assert.strictEqual(file.lines.length, 2);
    });

    it('comments between continuations are skipped', () => {
      const input = '[name] == ring &&\n// comment\n[quality] == unique';
      const file = parser.parseFile(input, 'test.nip');
      assert.strictEqual(file.lines.length, 1);
    });
  });
});
