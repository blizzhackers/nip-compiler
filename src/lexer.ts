import { Token, TokenType } from './types.js';

export class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;
  private tokens: Token[] = [];

  constructor(private readonly input: string) {}

  tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;
    this.line = 1;
    this.col = 1;

    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      const ch = this.input[this.pos];

      if (ch === '/' && this.peek(1) === '/') {
        this.readLineComment();
        continue;
      }

      if (ch === '/' && this.peek(1) === '*') {
        this.skipBlockComment();
        continue;
      }

      if (ch === '[') { this.addToken(TokenType.LeftBracket, '['); continue; }
      if (ch === ']') { this.addToken(TokenType.RightBracket, ']'); continue; }
      if (ch === '(') { this.addToken(TokenType.LeftParen, '('); continue; }
      if (ch === ')') { this.addToken(TokenType.RightParen, ')'); continue; }
      if (ch === '#') { this.addToken(TokenType.Hash, '#'); continue; }
      if (ch === '+') { this.addToken(TokenType.Plus, '+'); continue; }
      if (ch === '-') {
        if (this.isDigit(this.peek(1)) && this.canBeUnaryMinus()) {
          this.readNumber();
          continue;
        }
        this.addToken(TokenType.Minus, '-');
        continue;
      }
      if (ch === '*') { this.addToken(TokenType.Multiply, '*'); continue; }
      if (ch === '/') { this.addToken(TokenType.Divide, '/'); continue; }

      if (ch === '&' && this.peek(1) === '&') {
        this.addToken(TokenType.And, '&&', 2);
        continue;
      }
      if (ch === '|' && this.peek(1) === '|') {
        this.addToken(TokenType.Or, '||', 2);
        continue;
      }

      if (ch === '=' && this.peek(1) === '=') {
        this.addToken(TokenType.Equal, '==', 2);
        continue;
      }
      if (ch === '!' && this.peek(1) === '=') {
        this.addToken(TokenType.NotEqual, '!=', 2);
        continue;
      }
      if (ch === '!') {
        this.addToken(TokenType.Not, '!');
        continue;
      }
      if (ch === '>' && this.peek(1) === '=') {
        this.addToken(TokenType.GreaterThanOrEqual, '>=', 2);
        continue;
      }
      if (ch === '>') {
        this.addToken(TokenType.GreaterThan, '>');
        continue;
      }
      if (ch === '<' && this.peek(1) === '=') {
        this.addToken(TokenType.LessThanOrEqual, '<=', 2);
        continue;
      }
      if (ch === '<') {
        this.addToken(TokenType.LessThan, '<');
        continue;
      }

      if (this.isDigit(ch)) {
        this.readNumber();
        continue;
      }

      if (this.isIdentStart(ch)) {
        this.readIdentifier();
        continue;
      }

      throw new LexerError(
        `Unexpected character '${ch}'`,
        this.line, this.col, this.pos
      );
    }

    this.tokens.push({
      type: TokenType.EOF,
      value: '',
      pos: this.pos,
      line: this.line,
      col: this.col,
    });

    return this.tokens;
  }

  private canBeUnaryMinus(): boolean {
    if (this.tokens.length === 0) return true;
    const last = this.tokens[this.tokens.length - 1];
    return last.type !== TokenType.Number
      && last.type !== TokenType.RightBracket
      && last.type !== TokenType.RightParen
      && last.type !== TokenType.Identifier;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
      } else {
        break;
      }
    }
  }

  private peek(offset: number): string | undefined {
    return this.input[this.pos + offset];
  }

  private advance(): void {
    this.pos++;
    this.col++;
  }

  private addToken(type: TokenType, value: string, len = 1): void {
    this.tokens.push({
      type,
      value,
      pos: this.pos,
      line: this.line,
      col: this.col,
    });
    for (let i = 0; i < len; i++) this.advance();
  }

  private readNumber(): void {
    const start = this.pos;
    const startCol = this.col;
    if (this.input[this.pos] === '-') this.advance();
    while (this.pos < this.input.length && this.isDigit(this.input[this.pos])) {
      this.advance();
    }
    this.tokens.push({
      type: TokenType.Number,
      value: this.input.slice(start, this.pos),
      pos: start,
      line: this.line,
      col: startCol,
    });
  }

  private readIdentifier(): void {
    const start = this.pos;
    const startCol = this.col;
    while (this.pos < this.input.length && this.isIdentPart(this.input[this.pos])) {
      this.advance();
    }
    this.tokens.push({
      type: TokenType.Identifier,
      value: this.input.slice(start, this.pos),
      pos: start,
      line: this.line,
      col: startCol,
    });
  }

  private skipBlockComment(): void {
    this.advance(); // skip /
    this.advance(); // skip *
    while (this.pos < this.input.length) {
      if (this.input[this.pos] === '\n') {
        this.pos++;
        this.line++;
        this.col = 1;
      } else if (this.input[this.pos] === '*' && this.peek(1) === '/') {
        this.advance(); // skip *
        this.advance(); // skip /
        return;
      } else {
        this.advance();
      }
    }
    throw new LexerError('Unterminated block comment', this.line, this.col, this.pos);
  }

  private readLineComment(): void {
    const start = this.pos;
    const startCol = this.col;
    this.advance(); // skip first /
    this.advance(); // skip second /
    const contentStart = this.pos;
    while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
      this.advance();
    }
    this.tokens.push({
      type: TokenType.Comment,
      value: this.input.slice(contentStart, this.pos).trim(),
      pos: start,
      line: this.line,
      col: startCol,
    });
  }

  private isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z')
      || (ch >= 'A' && ch <= 'Z')
      || ch === '_';
  }

  private isIdentPart(ch: string): boolean {
    // apostrophe needed for D2 item names like diablo'shorn, baal'seye
    return this.isIdentStart(ch) || this.isDigit(ch) || ch === '\'';
  }
}

export class LexerError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
    public readonly pos: number,
  ) {
    super(`${message} at line ${line}, col ${col}`);
    this.name = 'LexerError';
  }
}
