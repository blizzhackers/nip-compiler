import {
  ExprNode, NodeKind, NipLineNode, Token,
} from './types.js';

/**
 * Reconstruct the original text of an expression from its token range.
 * Requires the full token array from the lexer.
 */
export function printExprFromTokens(node: ExprNode, allTokens: Token[]): string {
  if (node.tokenRange) {
    const [start, end] = node.tokenRange;
    return printTokenSlice(allTokens, start, end);
  }
  // Fallback: canonical output
  return printExprCanonical(node);
}

/**
 * Reconstruct a full NIP line from its AST + tokens.
 * Requires the full token array from the lexer.
 */
export function printLineFromTokens(node: NipLineNode, allTokens: Token[]): string {
  // Just emit all tokens in order — the trivia handles spacing
  return printTokenSlice(allTokens, 0, allTokens.length);
}

/**
 * Print an expression in canonical form (no trivia preservation).
 */
export function printExpr(node: ExprNode): string {
  return printExprCanonical(node);
}

/**
 * Print a NIP line in canonical form.
 */
export function printLine(node: NipLineNode): string {
  const parts: string[] = [];
  if (node.property) parts.push(printExprCanonical(node.property.expr));
  if (node.stats) {
    parts.push(' # ');
    parts.push(printExprCanonical(node.stats.expr));
  }
  if (node.meta) {
    parts.push(' # ');
    for (const entry of node.meta.entries) {
      parts.push(`[${entry.key}] == `);
      parts.push(printExprCanonical(entry.expr));
    }
  }
  if (node.comment !== null) {
    parts.push(` // ${node.comment}`);
  }
  return parts.join('');
}

function printExprCanonical(node: ExprNode): string {
  switch (node.kind) {
    case NodeKind.KeywordExpr:
      return `[${node.name}]`;
    case NodeKind.NumberLiteral:
      return String(node.value);
    case NodeKind.Identifier:
      return node.name;
    case NodeKind.UnaryExpr:
      return `!${printExprCanonical(node.operand)}`;
    case NodeKind.BinaryExpr:
      return `${printExprCanonical(node.left)} ${node.op} ${printExprCanonical(node.right)}`;
  }
}

function printTokenSlice(tokens: Token[], start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) {
    const t = tokens[i];
    if (t.leadingTrivia) out += t.leadingTrivia;
    if (t.type === 'Comment') {
      out += `//${t.value}`;
    } else if (t.type !== 'EOF') {
      out += t.value;
    }
  }
  return out;
}
