import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import {
  ExprNode, NodeKind, Token, NipLineNode,
} from './types.js';
import { AliasMapSet, getAliasMap } from './emitter/types.js';

const PROPERTY_ALIASES: Record<string, string> = {
  n: 'name', id: 'classid', q: 'quality', t: 'type',
  lvl: 'level', ilvl: 'level', f: 'flag', hc: 'hardcore',
  cl: 'classic', clvl: 'charlvl', mq: 'maxquantity',
};

const PROPERTY_ALIASES_REVERSE: Record<string, string> = {};
for (const [alias, full] of Object.entries(PROPERTY_ALIASES)) {
  // Only keep shortest alias per keyword
  if (!PROPERTY_ALIASES_REVERSE[full] || alias.length < PROPERTY_ALIASES_REVERSE[full].length) {
    PROPERTY_ALIASES_REVERSE[full] = alias;
  }
}

export interface Rewrite {
  kind: string;
  description: string;
  /** Apply the rewrite to the original line text, returns new line text */
  apply(): string;
}

/**
 * Get available rewrites for a cursor position within a NIP line.
 * @param lineText - The original line text
 * @param col - 1-based column position of cursor
 * @param aliases - D2 alias maps for resolving names/IDs
 */
export function getAvailableRewrites(
  lineText: string,
  col: number,
  aliases: AliasMapSet,
): Rewrite[] {
  const parser = new Parser();
  let node: NipLineNode;
  try {
    node = parser.parseLine(lineText);
  } catch {
    return [];
  }
  const tokens = parser.lastTokens;

  // Find the token at the cursor position
  const tokenIdx = findTokenAt(tokens, col);
  if (tokenIdx < 0) return [];
  const token = tokens[tokenIdx];

  // Find which AST node contains this token
  const exprNode = findNodeContaining(node, tokenIdx);
  if (!exprNode) return [];

  const rewrites: Rewrite[] = [];

  // Context: is this inside brackets?
  const inBracket = isInsideBracket(tokens, tokenIdx);

  if (inBracket && exprNode.kind === NodeKind.KeywordExpr) {
    // Keyword alias rewrites: [q] → [quality], [quality] → [q]
    const name = exprNode.name;
    if (name in PROPERTY_ALIASES) {
      const full = PROPERTY_ALIASES[name];
      rewrites.push(makeTokenRewrite(
        'alias-expand',
        `Expand [${name}] → [${full}]`,
        tokens, lineText, exprNode, { keywordName: full },
      ));
    }
    if (name in PROPERTY_ALIASES_REVERSE) {
      const alias = PROPERTY_ALIASES_REVERSE[name];
      rewrites.push(makeTokenRewrite(
        'alias-collapse',
        `Collapse [${name}] → [${alias}]`,
        tokens, lineText, exprNode, { keywordName: alias },
      ));
    }

    // Stat name ↔ ID
    if (name in aliases.stat) {
      const stat = aliases.stat[name];
      if (!Array.isArray(stat)) {
        rewrites.push(makeTokenRewrite(
          'stat-to-id',
          `Replace [${name}] with [${stat}]`,
          tokens, lineText, exprNode, { keywordName: String(stat) },
        ));
      }
    }
    const num = Number(name);
    if (!isNaN(num)) {
      for (const [sname, sid] of Object.entries(aliases.stat)) {
        if (sid === num) {
          rewrites.push(makeTokenRewrite(
            'id-to-stat',
            `Replace [${num}] with [${sname}]`,
            tokens, lineText, exprNode, { keywordName: sname },
          ));
          break;
        }
      }
    }
  }

  if (!inBracket && exprNode.kind === NodeKind.Identifier) {
    // Value rewrites: name ↔ code ↔ number
    const keyword = findComparisonKeyword(node, tokenIdx);
    if (keyword) {
      const map = getAliasMap(aliases, keyword);
      if (map) {
        const value = exprNode.name;

        // Name → number
        if (value in map) {
          const id = map[value];
          rewrites.push(makeTokenRewrite(
            'name-to-id',
            `Replace '${value}' with ${id}`,
            tokens, lineText, exprNode, { identValue: String(id) },
          ));

          // Name → alternative name (short code ↔ full name)
          const reverseMap = buildReverseMap(map);
          const alternatives = reverseMap.get(id)?.filter(n => n !== value) ?? [];
          for (const alt of alternatives) {
            rewrites.push(makeTokenRewrite(
              'name-swap',
              `Replace '${value}' with '${alt}'`,
              tokens, lineText, exprNode, { identValue: alt },
            ));
          }
        }
      }
    }
  }

  if (!inBracket && exprNode.kind === NodeKind.NumberLiteral) {
    // Number → name
    const keyword = findComparisonKeyword(node, tokenIdx);
    if (keyword) {
      const map = getAliasMap(aliases, keyword);
      if (map) {
        const reverseMap = buildReverseMap(map);
        const names = reverseMap.get(exprNode.value);
        if (names) {
          for (const name of names) {
            rewrites.push(makeTokenRewrite(
              'id-to-name',
              `Replace ${exprNode.value} with '${name}'`,
              tokens, lineText, exprNode, { identValue: name },
            ));
          }
        }
      }
    }
  }

  return rewrites;
}

function makeTokenRewrite(
  kind: string,
  description: string,
  tokens: Token[],
  originalLine: string,
  node: ExprNode,
  change: { keywordName?: string; identValue?: string },
): Rewrite {
  return {
    kind,
    description,
    apply(): string {
      if (!node.tokenRange) return originalLine;
      const [start, end] = node.tokenRange;
      // Reconstruct line with modified tokens
      let result = '';
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'EOF') break;
        if (t.leadingTrivia) result += t.leadingTrivia;

        if (i >= start && i < end) {
          if (node.kind === NodeKind.KeywordExpr && change.keywordName !== undefined) {
            // Replace the keyword content inside brackets
            if (t.type === 'LeftBracket') result += '[';
            else if (t.type === 'RightBracket') result += ']';
            else if (t.type === 'Identifier' || t.type === 'Number') {
              // First content token gets the new name
              if (i === start + 1) result += change.keywordName;
              else result += t.value;
            } else result += t.value;
          } else if ((node.kind === NodeKind.Identifier || node.kind === NodeKind.NumberLiteral)
            && change.identValue !== undefined) {
            result += change.identValue;
          } else {
            if (t.type === 'Comment') result += `//${t.value}`;
            else result += t.value;
          }
        } else {
          if (t.type === 'Comment') result += `//${t.value}`;
          else result += t.value;
        }
      }
      return result;
    },
  };
}

function findTokenAt(tokens: Token[], col: number): number {
  // col is 1-based
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].col <= col && tokens[i].type !== 'EOF') return i;
  }
  return -1;
}

function findNodeContaining(line: NipLineNode, tokenIdx: number): ExprNode | null {
  const sections = [line.property, line.stats];
  for (const section of sections) {
    if (!section) continue;
    const found = findInExpr(section.expr, tokenIdx);
    if (found) return found;
  }
  return null;
}

function findInExpr(node: ExprNode, tokenIdx: number): ExprNode | null {
  if (!node.tokenRange) return null;
  const [start, end] = node.tokenRange;
  if (tokenIdx < start || tokenIdx >= end) return null;

  // Try children first (most specific)
  switch (node.kind) {
    case NodeKind.BinaryExpr: {
      const left = findInExpr(node.left, tokenIdx);
      if (left) return left;
      const right = findInExpr(node.right, tokenIdx);
      if (right) return right;
      break;
    }
    case NodeKind.UnaryExpr: {
      const inner = findInExpr(node.operand, tokenIdx);
      if (inner) return inner;
      break;
    }
  }

  return node;
}

function isInsideBracket(tokens: Token[], idx: number): boolean {
  let depth = 0;
  for (let i = 0; i <= idx; i++) {
    if (tokens[i].type === 'LeftBracket') depth++;
    if (tokens[i].type === 'RightBracket') depth--;
  }
  return depth > 0;
}

function findComparisonKeyword(line: NipLineNode, tokenIdx: number): string | null {
  const sections = [line.property, line.stats];
  for (const section of sections) {
    if (!section) continue;
    const kw = findKeywordInComparison(section.expr, tokenIdx);
    if (kw) return kw;
  }
  return null;
}

function findKeywordInComparison(expr: ExprNode, tokenIdx: number): string | null {
  if (expr.kind === NodeKind.BinaryExpr) {
    // If right side contains the token and left side is a keyword → that's our keyword
    if (expr.right.tokenRange && tokenIdx >= expr.right.tokenRange[0] && tokenIdx < expr.right.tokenRange[1]) {
      if (expr.left.kind === NodeKind.KeywordExpr) {
        return expr.left.name;
      }
    }
    // Recurse
    const left = findKeywordInComparison(expr.left, tokenIdx);
    if (left) return left;
    return findKeywordInComparison(expr.right, tokenIdx);
  }
  if (expr.kind === NodeKind.UnaryExpr) {
    return findKeywordInComparison(expr.operand, tokenIdx);
  }
  return null;
}

// Cache
const reverseMaps = new WeakMap<Record<string, number>, Map<number, string[]>>();
function buildReverseMap(map: Record<string, number>): Map<number, string[]> {
  let rev = reverseMaps.get(map);
  if (rev) return rev;
  rev = new Map();
  for (const [name, id] of Object.entries(map)) {
    if (!rev.has(id)) rev.set(id, []);
    rev.get(id)!.push(name);
  }
  reverseMaps.set(map, rev);
  return rev;
}
