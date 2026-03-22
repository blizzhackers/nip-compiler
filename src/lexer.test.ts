import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Lexer, LexerError } from './lexer.js';
import { TokenType } from './types.js';

function tokenTypes(input: string): TokenType[] {
  return new Lexer(input).tokenize().map(t => t.type);
}

function tokenValues(input: string): string[] {
  return new Lexer(input).tokenize().map(t => t.value);
}

describe('Lexer', () => {
  describe('basic tokens', () => {
    it('tokenizes a simple property expression', () => {
      const tokens = new Lexer('[name] == ring').tokenize();
      assert.deepStrictEqual(
        tokens.map(t => [t.type, t.value]),
        [
          [TokenType.LeftBracket, '['],
          [TokenType.Identifier, 'name'],
          [TokenType.RightBracket, ']'],
          [TokenType.Equal, '=='],
          [TokenType.Identifier, 'ring'],
          [TokenType.EOF, ''],
        ]
      );
    });

    it('tokenizes brackets and parens', () => {
      const types = tokenTypes('([name])');
      assert.deepStrictEqual(types, [
        TokenType.LeftParen, TokenType.LeftBracket,
        TokenType.Identifier, TokenType.RightBracket,
        TokenType.RightParen, TokenType.EOF,
      ]);
    });

    it('tokenizes hash', () => {
      const types = tokenTypes('#');
      assert.deepStrictEqual(types, [TokenType.Hash, TokenType.EOF]);
    });

    it('tokenizes multiple hashes', () => {
      const types = tokenTypes('# #');
      assert.deepStrictEqual(types, [TokenType.Hash, TokenType.Hash, TokenType.EOF]);
    });
  });

  describe('operators', () => {
    it('tokenizes all comparison operators', () => {
      const types = tokenTypes('== != > >= < <=');
      assert.deepStrictEqual(types, [
        TokenType.Equal, TokenType.NotEqual,
        TokenType.GreaterThan, TokenType.GreaterThanOrEqual,
        TokenType.LessThan, TokenType.LessThanOrEqual,
        TokenType.EOF,
      ]);
    });

    it('tokenizes logical operators', () => {
      const types = tokenTypes('&& ||');
      assert.deepStrictEqual(types, [TokenType.And, TokenType.Or, TokenType.EOF]);
    });

    it('tokenizes arithmetic operators', () => {
      const types = tokenTypes('+ - * /');
      assert.deepStrictEqual(types, [
        TokenType.Plus, TokenType.Minus, TokenType.Multiply, TokenType.Divide,
        TokenType.EOF,
      ]);
    });

    it('tokenizes not operator standalone', () => {
      const types = tokenTypes('!');
      assert.deepStrictEqual(types, [TokenType.Not, TokenType.EOF]);
    });

    it('tokenizes != vs ! followed by =', () => {
      const types = tokenTypes('!=');
      assert.deepStrictEqual(types, [TokenType.NotEqual, TokenType.EOF]);
    });

    it('tokenizes >= and > correctly when adjacent', () => {
      const types = tokenTypes('>= >');
      assert.deepStrictEqual(types, [
        TokenType.GreaterThanOrEqual, TokenType.GreaterThan, TokenType.EOF,
      ]);
    });
  });

  describe('numbers', () => {
    it('tokenizes simple numbers', () => {
      const values = tokenValues('42 0 999');
      assert.deepStrictEqual(values, ['42', '0', '999', '']);
    });

    it('tokenizes large numbers', () => {
      const tokens = new Lexer('99999').tokenize();
      assert.strictEqual(tokens[0].value, '99999');
    });

    it('tokenizes negative numbers in unary position after ==', () => {
      const tokens = new Lexer('== -5').tokenize();
      assert.deepStrictEqual(
        tokens.map(t => [t.type, t.value]),
        [
          [TokenType.Equal, '=='],
          [TokenType.Number, '-5'],
          [TokenType.EOF, ''],
        ]
      );
    });

    it('tokenizes negative numbers after >=', () => {
      const tokens = new Lexer('>= -1').tokenize();
      assert.strictEqual(tokens[1].type, TokenType.Number);
      assert.strictEqual(tokens[1].value, '-1');
    });

    it('tokenizes negative numbers at start of input', () => {
      const tokens = new Lexer('-42').tokenize();
      assert.strictEqual(tokens[0].type, TokenType.Number);
      assert.strictEqual(tokens[0].value, '-42');
    });

    it('tokenizes minus as operator after number', () => {
      const tokens = new Lexer('5 - 3').tokenize();
      assert.deepStrictEqual(
        tokens.map(t => t.type),
        [TokenType.Number, TokenType.Minus, TokenType.Number, TokenType.EOF]
      );
    });

    it('tokenizes minus as operator after ]', () => {
      const tokens = new Lexer('[x] - 3').tokenize();
      const minus = tokens.find(t => t.type === TokenType.Minus);
      assert.ok(minus);
    });

    it('tokenizes minus as operator after )', () => {
      const tokens = new Lexer('(5) - 3').tokenize();
      const minus = tokens.find(t => t.type === TokenType.Minus);
      assert.ok(minus);
    });

    it('tokenizes negative number after (', () => {
      const tokens = new Lexer('(-5)').tokenize();
      assert.strictEqual(tokens[1].type, TokenType.Number);
      assert.strictEqual(tokens[1].value, '-5');
    });
  });

  describe('identifiers', () => {
    it('tokenizes simple identifiers', () => {
      const tokens = new Lexer('ring').tokenize();
      assert.strictEqual(tokens[0].type, TokenType.Identifier);
      assert.strictEqual(tokens[0].value, 'ring');
    });

    it('handles identifiers with numbers', () => {
      const tokens = new Lexer('item2handed').tokenize();
      assert.strictEqual(tokens[0].type, TokenType.Identifier);
      assert.strictEqual(tokens[0].value, 'item2handed');
    });

    it('handles identifiers with underscores', () => {
      const tokens = new Lexer('some_stat').tokenize();
      assert.strictEqual(tokens[0].type, TokenType.Identifier);
      assert.strictEqual(tokens[0].value, 'some_stat');
    });

    it('handles identifiers starting with underscore', () => {
      const tokens = new Lexer('_private').tokenize();
      assert.strictEqual(tokens[0].type, TokenType.Identifier);
      assert.strictEqual(tokens[0].value, '_private');
    });

    it('handles apostrophes in D2 item names', () => {
      const tokens = new Lexer("diablo'shorn").tokenize();
      assert.strictEqual(tokens[0].type, TokenType.Identifier);
      assert.strictEqual(tokens[0].value, "diablo'shorn");
    });

    it('handles multiple apostrophe names', () => {
      const names = ["baal'seye", "mephisto'sbrain", "hunter'sguise"];
      for (const name of names) {
        const tokens = new Lexer(name).tokenize();
        assert.strictEqual(tokens[0].value, name, `Failed for ${name}`);
      }
    });

    it('preserves case in identifier values', () => {
      const tokens = new Lexer('MyName').tokenize();
      assert.strictEqual(tokens[0].value, 'MyName');
    });
  });

  describe('comments', () => {
    it('tokenizes line comments', () => {
      const tokens = new Lexer('[name] == ring // Perfect Raven').tokenize();
      const comment = tokens.find(t => t.type === TokenType.Comment);
      assert.ok(comment);
      assert.strictEqual(comment.value, 'Perfect Raven');
    });

    it('tokenizes comment with empty content', () => {
      const tokens = new Lexer('[name] == ring //').tokenize();
      const comment = tokens.find(t => t.type === TokenType.Comment);
      assert.ok(comment);
      assert.strictEqual(comment.value, '');
    });

    it('tokenizes comment-only input', () => {
      const tokens = new Lexer('// just a comment').tokenize();
      assert.strictEqual(tokens[0].type, TokenType.Comment);
      assert.strictEqual(tokens[0].value, 'just a comment');
      assert.strictEqual(tokens[1].type, TokenType.EOF);
    });

    it('preserves apostrophes in comments', () => {
      const tokens = new Lexer("// gladiator's bane").tokenize();
      assert.strictEqual(tokens[0].value, "gladiator's bane");
    });

    it('skips block comments as trivia', () => {
      const tokens = new Lexer('[name] /* ias */ == ring').tokenize();
      const types = tokens.map(t => t.type);
      assert.deepStrictEqual(types, [
        TokenType.LeftBracket, TokenType.Identifier, TokenType.RightBracket,
        TokenType.Equal, TokenType.Identifier, TokenType.EOF,
      ]);
    });

    it('skips block comment at start', () => {
      const tokens = new Lexer('/* skip me */ [name]').tokenize();
      assert.strictEqual(tokens[0].type, TokenType.LeftBracket);
    });

    it('skips block comment at end', () => {
      const tokens = new Lexer('[name] /* end */').tokenize();
      const types = tokens.map(t => t.type);
      assert.deepStrictEqual(types, [
        TokenType.LeftBracket, TokenType.Identifier, TokenType.RightBracket,
        TokenType.EOF,
      ]);
    });

    it('skips empty block comment', () => {
      const tokens = new Lexer('/**/ [name]').tokenize();
      assert.strictEqual(tokens[0].type, TokenType.LeftBracket);
    });

    it('handles multiline block comments', () => {
      const tokens = new Lexer('/* line1\nline2 */ [name]').tokenize();
      assert.strictEqual(tokens[0].type, TokenType.LeftBracket);
    });

    it('updates line count after multiline block comment', () => {
      const tokens = new Lexer('/* a\nb\nc */ [name]').tokenize();
      assert.strictEqual(tokens[0].line, 3);
    });

    it('throws on unterminated block comment', () => {
      assert.throws(() => new Lexer('/* oops').tokenize(), LexerError);
    });

    it('throws on unterminated block comment with stars', () => {
      assert.throws(() => new Lexer('/*** still not closed').tokenize(), LexerError);
    });
  });

  describe('whitespace handling', () => {
    it('skips spaces', () => {
      const types = tokenTypes('  [name]  ==  ring  ');
      assert.deepStrictEqual(types, [
        TokenType.LeftBracket, TokenType.Identifier, TokenType.RightBracket,
        TokenType.Equal, TokenType.Identifier, TokenType.EOF,
      ]);
    });

    it('skips tabs', () => {
      const types = tokenTypes('\t[name]\t==\tring');
      assert.deepStrictEqual(types, [
        TokenType.LeftBracket, TokenType.Identifier, TokenType.RightBracket,
        TokenType.Equal, TokenType.Identifier, TokenType.EOF,
      ]);
    });

    it('handles no whitespace between tokens', () => {
      const types = tokenTypes('[name]==ring');
      assert.deepStrictEqual(types, [
        TokenType.LeftBracket, TokenType.Identifier, TokenType.RightBracket,
        TokenType.Equal, TokenType.Identifier, TokenType.EOF,
      ]);
    });

    it('handles empty input', () => {
      const types = tokenTypes('');
      assert.deepStrictEqual(types, [TokenType.EOF]);
    });

    it('handles whitespace-only input', () => {
      const types = tokenTypes('   \t  ');
      assert.deepStrictEqual(types, [TokenType.EOF]);
    });
  });

  describe('position tracking', () => {
    it('tracks line and column positions', () => {
      const tokens = new Lexer('[name] == 42').tokenize();
      const bracket = tokens[0];
      assert.strictEqual(bracket.line, 1);
      assert.strictEqual(bracket.col, 1);
      const num = tokens.find(t => t.type === TokenType.Number)!;
      assert.strictEqual(num.col, 11);
    });

    it('tracks position of each token', () => {
      const tokens = new Lexer('[x] == 1').tokenize();
      assert.strictEqual(tokens[0].pos, 0);  // [
      assert.strictEqual(tokens[1].pos, 1);  // x
      assert.strictEqual(tokens[2].pos, 2);  // ]
      assert.strictEqual(tokens[3].pos, 4);  // ==
      assert.strictEqual(tokens[4].pos, 7);  // 1
    });

    it('EOF position is at end of input', () => {
      const tokens = new Lexer('abc').tokenize();
      const eof = tokens[tokens.length - 1];
      assert.strictEqual(eof.pos, 3);
    });
  });

  describe('error handling', () => {
    it('throws on unexpected characters', () => {
      assert.throws(() => new Lexer('[name] @ ring').tokenize(), LexerError);
    });

    it('throws with line and column info', () => {
      try {
        new Lexer('[name] @ ring').tokenize();
        assert.fail('should have thrown');
      } catch (e) {
        assert.ok(e instanceof LexerError);
        assert.strictEqual(e.col, 8);
        assert.strictEqual(e.line, 1);
      }
    });

    it('throws on stray &', () => {
      assert.throws(() => new Lexer('[name] & ring').tokenize(), LexerError);
    });

    it('throws on stray |', () => {
      assert.throws(() => new Lexer('[name] | ring').tokenize(), LexerError);
    });

    it('throws on ^', () => {
      assert.throws(() => new Lexer('^').tokenize(), LexerError);
    });

    it('throws on ~', () => {
      assert.throws(() => new Lexer('~').tokenize(), LexerError);
    });
  });

  describe('full nip lines', () => {
    it('tokenizes a complete line with all sections', () => {
      const input = '[name] == ring && [quality] == unique # [dexterity] == 20 && [tohit] == 250 // Perfect Raven Frost';
      const tokens = new Lexer(input).tokenize();
      assert.ok(tokens.length > 10);
      assert.strictEqual(tokens[tokens.length - 1].type, TokenType.EOF);
      assert.strictEqual(tokens[tokens.length - 2].type, TokenType.Comment);
    });

    it('tokenizes line with parens and mixed operators', () => {
      const input = '([name] == ring || [name] == amulet) && [quality] >= 4';
      const tokens = new Lexer(input).tokenize();
      assert.strictEqual(tokens[0].type, TokenType.LeftParen);
      assert.ok(tokens.some(t => t.type === TokenType.Or));
      assert.ok(tokens.some(t => t.type === TokenType.And));
      assert.ok(tokens.some(t => t.type === TokenType.GreaterThanOrEqual));
    });

    it('tokenizes line with stat addition', () => {
      const input = '[name] == ring # [strength] + [dexterity] >= 30';
      const tokens = new Lexer(input).tokenize();
      assert.ok(tokens.some(t => t.type === TokenType.Plus));
      assert.ok(tokens.some(t => t.type === TokenType.Hash));
    });

    it('tokenizes tier line with empty stat section', () => {
      const input = '[name] == foo # # [tier] == 5';
      const tokens = new Lexer(input).tokenize();
      const hashes = tokens.filter(t => t.type === TokenType.Hash);
      assert.strictEqual(hashes.length, 2);
    });
  });
});
