import { Lexer } from './lexer.js';
import {
  Token, TokenType, NodeKind,
  NipLineNode, SectionNode, MetaSectionNode, MetaEntryNode,
  ExprNode, BinaryOp, BinaryExprNode, KeywordExprNode,
  NumberLiteralNode, UnaryExprNode, SourceLocation, NipFileNode,
} from './types.js';

export class Parser {
  private tokens: Token[] = [];
  private current = 0;

  parseLine(input: string, lineNumber = 1): NipLineNode {
    const lexer = new Lexer(input);
    this.tokens = lexer.tokenize();
    this.current = 0;

    return this.parseNipLine(lineNumber);
  }

  parseFile(input: string, filename = 'unknown.nip'): NipFileNode {
    const rawLines = input.split('\n');
    const lines: NipLineNode[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      const trimmed = rawLines[i].trim();
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith('//')) continue;

      try {
        const node = this.parseLine(rawLines[i], i + 1);
        lines.push(node);
      } catch (e) {
        if (e instanceof ParseError) {
          throw new ParseError(
            `${filename}:${i + 1}: ${e.message}`,
            e.line, e.col, e.pos,
          );
        }
        throw e;
      }
    }

    return {
      kind: NodeKind.NipFile,
      lines,
      filename,
      loc: { pos: 0, line: 1, col: 1 },
    };
  }

  private parseNipLine(lineNumber: number): NipLineNode {
    const startLoc = this.loc();
    let comment: string | null = null;

    // Check for comment-only line
    if (this.check(TokenType.Comment)) {
      comment = this.advance().value;
      return {
        kind: NodeKind.NipLine,
        property: null,
        stats: null,
        meta: null,
        comment,
        lineNumber,
        loc: startLoc,
      };
    }

    // Parse property section (before first #)
    let property: SectionNode | null = null;
    if (!this.check(TokenType.Hash) && !this.check(TokenType.EOF) && !this.check(TokenType.Comment)) {
      property = this.parseSection(NodeKind.PropertySection);
    }

    // Parse stat section (after first #)
    let stats: SectionNode | null = null;
    if (this.match(TokenType.Hash)) {
      if (!this.check(TokenType.Hash) && !this.check(TokenType.EOF) && !this.check(TokenType.Comment)) {
        stats = this.parseSection(NodeKind.StatSection);
      }
    }

    // Parse meta section (after second #)
    let meta: MetaSectionNode | null = null;
    if (this.match(TokenType.Hash)) {
      meta = this.parseMetaSection();
    }

    // Trailing comment
    if (this.check(TokenType.Comment)) {
      comment = this.advance().value;
    }

    return {
      kind: NodeKind.NipLine,
      property,
      stats,
      meta,
      comment,
      lineNumber,
      loc: startLoc,
    };
  }

  private parseSection(kind: NodeKind.PropertySection | NodeKind.StatSection): SectionNode {
    const startLoc = this.loc();
    const expr = this.parseExpr();
    return { kind, expr, loc: startLoc };
  }

  private parseMetaSection(): MetaSectionNode {
    const startLoc = this.loc();
    const entries: MetaEntryNode[] = [];

    while (!this.check(TokenType.EOF) && !this.check(TokenType.Comment)) {
      if (this.check(TokenType.LeftBracket)) {
        entries.push(this.parseMetaEntry());
      } else if (this.check(TokenType.And)) {
        this.advance();
      } else {
        break;
      }
    }

    return { kind: NodeKind.MetaSection, entries, loc: startLoc };
  }

  private parseMetaEntry(): MetaEntryNode {
    const startLoc = this.loc();
    this.expect(TokenType.LeftBracket);
    const keyToken = this.expect(TokenType.Identifier);
    this.expect(TokenType.RightBracket);
    this.expect(TokenType.Equal);
    const expr = this.parseExpr();

    return {
      kind: NodeKind.MetaEntry,
      key: keyToken.value.toLowerCase(),
      expr,
      loc: startLoc,
    };
  }

  // Expression parsing with precedence climbing
  private parseExpr(): ExprNode {
    return this.parseOr();
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.check(TokenType.Or)) {
      const op = this.advance();
      const right = this.parseAnd();
      left = this.binaryNode(left, '||', right, op);
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseComparison();
    while (this.check(TokenType.And)) {
      const op = this.advance();
      const right = this.parseComparison();
      left = this.binaryNode(left, '&&', right, op);
    }
    return left;
  }

  private parseComparison(): ExprNode {
    let left = this.parseAdditive();
    while (
      this.check(TokenType.Equal) || this.check(TokenType.NotEqual) ||
      this.check(TokenType.GreaterThan) || this.check(TokenType.GreaterThanOrEqual) ||
      this.check(TokenType.LessThan) || this.check(TokenType.LessThanOrEqual)
    ) {
      const op = this.advance();
      const right = this.parseAdditive();
      left = this.binaryNode(left, op.value as BinaryOp, right, op);
    }
    return left;
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    while (this.check(TokenType.Plus) || this.check(TokenType.Minus)) {
      const op = this.advance();
      const right = this.parseMultiplicative();
      left = this.binaryNode(left, op.value as BinaryOp, right, op);
    }
    return left;
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    while (this.check(TokenType.Multiply) || this.check(TokenType.Divide)) {
      const op = this.advance();
      const right = this.parseUnary();
      left = this.binaryNode(left, op.value as BinaryOp, right, op);
    }
    return left;
  }

  private parseUnary(): ExprNode {
    if (this.check(TokenType.Not)) {
      const op = this.advance();
      const operand = this.parseUnary();
      return {
        kind: NodeKind.UnaryExpr,
        op: '!',
        operand,
        loc: { pos: op.pos, line: op.line, col: op.col },
      } satisfies UnaryExprNode;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    // Parenthesized expression
    if (this.check(TokenType.LeftParen)) {
      this.advance();
      const expr = this.parseExpr();
      this.expect(TokenType.RightParen);
      return expr;
    }

    // Keyword: [identifier]
    if (this.check(TokenType.LeftBracket)) {
      return this.parseKeyword();
    }

    // Number literal
    if (this.check(TokenType.Number)) {
      const tok = this.advance();
      return {
        kind: NodeKind.NumberLiteral,
        value: Number(tok.value),
        loc: { pos: tok.pos, line: tok.line, col: tok.col },
      } satisfies NumberLiteralNode;
    }

    // Bare identifier (e.g., named values like "unique", "ring")
    if (this.check(TokenType.Identifier)) {
      const tok = this.advance();
      return {
        kind: NodeKind.Identifier,
        name: tok.value.toLowerCase(),
        loc: { pos: tok.pos, line: tok.line, col: tok.col },
      };
    }

    const tok = this.peek();
    throw new ParseError(
      `Unexpected token '${tok.value || tok.type}'`,
      tok.line, tok.col, tok.pos,
    );
  }

  private parseKeyword(): KeywordExprNode {
    const open = this.expect(TokenType.LeftBracket);
    const name = this.expect(TokenType.Identifier);
    this.expect(TokenType.RightBracket);
    return {
      kind: NodeKind.KeywordExpr,
      name: name.value.toLowerCase(),
      loc: { pos: open.pos, line: open.line, col: open.col },
    };
  }

  private binaryNode(left: ExprNode, op: BinaryOp, right: ExprNode, opToken: Token): BinaryExprNode {
    return {
      kind: NodeKind.BinaryExpr,
      op,
      left,
      right,
      loc: { pos: left.loc.pos, line: left.loc.line, col: left.loc.col },
    };
  }

  // Token helpers
  private peek(): Token {
    return this.tokens[this.current];
  }

  private advance(): Token {
    const tok = this.tokens[this.current];
    this.current++;
    return tok;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType): Token {
    if (this.check(type)) return this.advance();
    const tok = this.peek();
    throw new ParseError(
      `Expected ${type} but got '${tok.value || tok.type}'`,
      tok.line, tok.col, tok.pos,
    );
  }

  private loc(): SourceLocation {
    const tok = this.peek();
    return { pos: tok.pos, line: tok.line, col: tok.col };
  }
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
    public readonly pos: number,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}
