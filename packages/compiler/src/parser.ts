import { Lexer, LexerError } from './lexer.js';
import { formatError } from './errors.js';
import {
  Token, TokenType, NodeKind,
  NipLineNode, SectionNode, MetaSectionNode, MetaEntryNode,
  ExprNode, BinaryOp, BinaryExprNode, KeywordExprNode,
  NumberLiteralNode, UnaryExprNode, SourceLocation, NipFileNode,
} from './types.js';

export class Parser {
  private tokens: Token[] = [];
  private current = 0;
  /** Tokens from the most recent parseLine call */
  lastTokens: Token[] = [];

  parseLine(input: string, lineNumber = 1): NipLineNode {
    const preprocessed = Parser.preprocess(input);
    const lexer = new Lexer(preprocessed);
    this.tokens = lexer.tokenize();
    this.lastTokens = this.tokens;
    this.current = 0;

    return this.parseNipLine(lineNumber);
  }

  static preprocess(input: string): string {
    // Convert item.getStatEx(N) → [N] and item.getStatEx(N,M) → [N,M]
    return input.replace(/item\.getStatEx\((\d+)(?:,\s*(\d+))?\)/g, (_match, id, param) => {
      return param ? `[${id},${param}]` : `[${id}]`;
    });
  }

  parseFile(input: string, filename = 'unknown.nip'): NipFileNode {
    const rawLines = input.split('\n');
    const lines: NipLineNode[] = [];

    // Join continuation lines using the lexer to detect incomplete expressions.
    // A line continues when:
    // - Previous line's last token is an operator (expression incomplete)
    // - Next line's first token is an operator (can't start a new rule)
    // Newlines become trivia — the parser sees one continuous token stream.
    const joined: { text: string; lineNumber: number }[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      const trimmed = raw.trim();
      if (trimmed.length === 0 || trimmed.startsWith('//')) continue;
      if (joined.length > 0 && isLineContinuation(joined[joined.length - 1].text, trimmed)) {
        joined[joined.length - 1].text += ' ' + trimmed;
      } else {
        joined.push({ text: raw, lineNumber: i + 1 });
      }
    }

    for (const { text, lineNumber } of joined) {
      try {
        const node = this.parseLine(text, lineNumber);
        lines.push(node);
      } catch (e) {
        if (e instanceof ParseError || e instanceof LexerError) {
          const formatted = formatError(text, 1, e.col, e.message, `${filename}:${lineNumber}`);
          throw new ParseError(formatted, lineNumber, e.col, e.pos);
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
    const lineTokens: Token[] = [];
    let comment: string | null = null;

    // Check for comment-only line
    if (this.check(TokenType.Comment)) {
      const ct = this.advance();
      lineTokens.push(ct);
      comment = ct.value.trim();
      return {
        kind: NodeKind.NipLine,
        property: null,
        stats: null,
        meta: null,
        comment,
        lineNumber,
        loc: startLoc,
        tokens: lineTokens,
      };
    }

    // Parse property section (before first #)
    let property: SectionNode | null = null;
    if (!this.check(TokenType.Hash) && !this.check(TokenType.EOF) && !this.check(TokenType.Comment)) {
      property = this.parseSection(NodeKind.PropertySection);
    }

    // Parse stat section (after first #)
    let stats: SectionNode | null = null;
    if (this.check(TokenType.Hash)) {
      lineTokens.push(this.advance()); // #
      if (!this.check(TokenType.Hash) && !this.check(TokenType.EOF) && !this.check(TokenType.Comment)) {
        stats = this.parseSection(NodeKind.StatSection);
      }
    }

    // Parse meta section (after second #)
    let meta: MetaSectionNode | null = null;
    if (this.check(TokenType.Hash)) {
      lineTokens.push(this.advance()); // #
      meta = this.parseMetaSection();
    }

    // Trailing comment
    if (this.check(TokenType.Comment)) {
      const ct = this.advance();
      lineTokens.push(ct);
      comment = ct.value.trim();
    }

    return {
      kind: NodeKind.NipLine,
      property,
      stats,
      meta,
      comment,
      lineNumber,
      loc: startLoc,
      tokens: lineTokens,
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
      const startIdx = this.current;
      const op = this.advance();
      const operand = this.parseUnary();
      return {
        kind: NodeKind.UnaryExpr,
        op: '!',
        operand,
        loc: { pos: op.pos, line: op.line, col: op.col },
        tokens: [op],
        tokenRange: [startIdx, operand.tokenRange?.[1] ?? this.current],
      } satisfies UnaryExprNode;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    // Parenthesized expression
    if (this.check(TokenType.LeftParen)) {
      const startIdx = this.current;
      this.advance(); // (
      const expr = this.parseExpr();
      this.expect(TokenType.RightParen);
      // Widen the token range to include parens
      expr.tokenRange = [startIdx, this.current];
      return expr;
    }

    // Keyword: [identifier] — may be followed by in() or notin()
    if (this.check(TokenType.LeftBracket)) {
      const keyword = this.parseKeyword();
      // [keyword]in(val1,val2,...) → ([keyword]==val1||[keyword]==val2||...)
      // [keyword]notin(val1,val2,...) → ([keyword]!=val1&&[keyword]!=val2&&...)
      if (this.check(TokenType.Identifier) && (this.peek().value === 'in' || this.peek().value === 'notin')) {
        const isNotIn = this.peek().value === 'notin';
        this.advance(); // consume in/notin
        return this.parseInList(keyword, isNotIn);
      }
      return keyword;
    }

    // Number literal
    if (this.check(TokenType.Number)) {
      const startIdx = this.current;
      const tok = this.advance();
      return {
        kind: NodeKind.NumberLiteral,
        value: Number(tok.value),
        loc: { pos: tok.pos, line: tok.line, col: tok.col },
        tokens: [tok],
        tokenRange: [startIdx, this.current],
      } satisfies NumberLiteralNode;
    }

    // Bare identifier (e.g., named values like "unique", "ring")
    if (this.check(TokenType.Identifier)) {
      const startIdx = this.current;
      const tok = this.advance();
      return {
        kind: NodeKind.Identifier,
        name: tok.value.toLowerCase(),
        loc: { pos: tok.pos, line: tok.line, col: tok.col },
        tokens: [tok],
        tokenRange: [startIdx, this.current],
      };
    }

    const tok = this.peek();
    throw new ParseError(
      `Unexpected token '${tok.value || tok.type}'`,
      tok.line, tok.col, tok.pos,
    );
  }

  private parseInList(keyword: KeywordExprNode, isNotIn: boolean): ExprNode {
    this.expect(TokenType.LeftParen);
    const values: ExprNode[] = [];

    while (!this.check(TokenType.RightParen) && !this.check(TokenType.EOF)) {
      if (values.length > 0) {
        this.expect(TokenType.Comma);
      }
      if (this.check(TokenType.Number)) {
        values.push({
          kind: NodeKind.NumberLiteral,
          value: Number(this.advance().value),
          loc: this.loc(),
        });
      } else if (this.check(TokenType.Identifier)) {
        values.push({
          kind: NodeKind.Identifier,
          name: this.advance().value.toLowerCase(),
          loc: this.loc(),
        });
      } else {
        break;
      }
    }

    this.expect(TokenType.RightParen);

    if (values.length === 0) {
      throw new ParseError('Empty in() list', keyword.loc.line, keyword.loc.col, keyword.loc.pos);
    }

    const op: BinaryOp = isNotIn ? '!=' : '==';
    const joinOp: BinaryOp = isNotIn ? '&&' : '||';

    const comparisons = values.map(v => ({
      kind: NodeKind.BinaryExpr as const,
      op,
      left: keyword as ExprNode,
      right: v,
      loc: keyword.loc,
    }));

    let result: ExprNode = comparisons[0];
    for (let i = 1; i < comparisons.length; i++) {
      result = {
        kind: NodeKind.BinaryExpr as const,
        op: joinOp,
        left: result,
        right: comparisons[i],
        loc: keyword.loc,
      };
    }
    return result;
  }

  private parseKeyword(): KeywordExprNode {
    const startIdx = this.current;
    const open = this.expect(TokenType.LeftBracket);
    const nodeTokens = [open];
    let name: string;
    if (this.check(TokenType.RightBracket)) {
      const close = this.advance();
      nodeTokens.push(close);
      return { kind: NodeKind.KeywordExpr, name: '', loc: { pos: open.pos, line: open.line, col: open.col }, tokens: nodeTokens, tokenRange: [startIdx, this.current] };
    } else if (this.check(TokenType.Identifier)) {
      const id = this.advance();
      nodeTokens.push(id);
      name = id.value.toLowerCase();
    } else if (this.check(TokenType.Number)) {
      const num = this.advance();
      nodeTokens.push(num);
      name = num.value;
      if (this.check(TokenType.Comma)) {
        const comma = this.advance();
        nodeTokens.push(comma);
        const param = this.expect(TokenType.Number);
        nodeTokens.push(param);
        name = `${name},${param.value}`;
      }
    } else {
      const tok = this.peek();
      throw new ParseError(`Expected keyword or stat ID but got '${tok.value || tok.type}'`, tok.line, tok.col, tok.pos);
    }
    const close = this.expect(TokenType.RightBracket);
    nodeTokens.push(close);
    return {
      kind: NodeKind.KeywordExpr,
      name,
      loc: { pos: open.pos, line: open.line, col: open.col },
      tokens: nodeTokens,
      tokenRange: [startIdx, this.current],
    };
  }

  private binaryNode(left: ExprNode, op: BinaryOp, right: ExprNode, opToken: Token): BinaryExprNode {
    return {
      kind: NodeKind.BinaryExpr,
      op,
      left,
      right,
      loc: { pos: left.loc.pos, line: left.loc.line, col: left.loc.col },
      tokens: [opToken],
      tokenRange: [left.tokenRange?.[0] ?? 0, right.tokenRange?.[1] ?? this.current],
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

const OPERATOR_TOKENS = new Set<TokenType>([
  TokenType.And, TokenType.Or,
  TokenType.Equal, TokenType.NotEqual,
  TokenType.GreaterThan, TokenType.GreaterThanOrEqual,
  TokenType.LessThan, TokenType.LessThanOrEqual,
  TokenType.Plus, TokenType.Minus, TokenType.Multiply, TokenType.Divide,
  TokenType.Not,
]);

const INCOMPLETE_END_TOKENS = new Set<TokenType>([
  ...OPERATOR_TOKENS,
  TokenType.LeftBracket, TokenType.LeftParen, TokenType.Comma,
]);

function lastSignificantToken(text: string): TokenType | null {
  const tokens = new Lexer(text).tokenize();
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].type !== TokenType.EOF && tokens[i].type !== TokenType.Comment) {
      return tokens[i].type;
    }
  }
  return null;
}

function firstSignificantToken(text: string): TokenType | null {
  const tokens = new Lexer(text).tokenize();
  for (const t of tokens) {
    if (t.type !== TokenType.EOF && t.type !== TokenType.Comment) return t.type;
  }
  return null;
}

function isLineContinuation(prevText: string, nextTrimmed: string): boolean {
  const first = firstSignificantToken(nextTrimmed);
  if (first !== null && OPERATOR_TOKENS.has(first)) return true;
  const last = lastSignificantToken(prevText);
  if (last !== null && INCOMPLETE_END_TOKENS.has(last)) return true;
  return false;
}
