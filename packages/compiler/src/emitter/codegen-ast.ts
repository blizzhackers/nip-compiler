/**
 * CodeGen that produces ESTree AST nodes instead of strings.
 * Mirrors codegen.ts but returns ESTree.Expression for each NIP expression.
 */
import type * as ESTree from 'estree';
import { ExprNode, NodeKind, BinaryExprNode, KeywordExprNode } from '../types.js';
import { AliasMapSet, getAliasMap } from './types.js';
import {
  ident, literal, bin, logical, unary, call, member,
  type NipLoc,
} from './js-ast.js';

// Property keyword → ESTree expression (using hoisted dispatch vars)
function propertyExpr(name: string, standalone: boolean): ESTree.Expression {
  if (name === '') return literal(0);
  switch (name) {
    case 'classid': case 'name': return standalone ? member(ident('i'), 'classid') : ident('_c');
    case 'type': return standalone ? member(ident('i'), 'itemType') : ident('_t');
    case 'quality': return standalone ? member(ident('i'), 'quality') : ident('_q');
    case 'class': return member(ident('i'), 'itemclass');
    case 'level': return member(ident('i'), 'ilvl');
    case 'charlvl': return member(member(ident('me'), 'charlvl'), ''); // me.charlvl — handled below
    case 'strreq': return member(ident('i'), 'strreq');
    case 'dexreq': return member(ident('i'), 'dexreq');
    case 'color': return call(member(ident('i'), 'getColor'), []);
    case 'ladder': return member(ident('me'), 'ladder');
    case 'distance': return logical('||',
      logical('&&', member(ident('i'), 'onGroundOrDropping'), member(ident('i'), 'distance')),
      ident('Infinity'));
  }
  // Special cases that produce function calls
  if (name === 'wsm' || name === 'weaponspeed') {
    const classRef = standalone ? member(ident('i'), 'classid') : ident('_c');
    return call(ident('getBaseStat'), [literal('items'), classRef, literal('speed')]);
  }
  if (name === 'minimumsockets') {
    const classRef = standalone ? member(ident('i'), 'classid') : ident('_c');
    return call(ident('getBaseStat'), [literal('items'), classRef, literal('gemsockets')]);
  }
  if (name === '2handed') {
    const classRef = standalone ? member(ident('i'), 'classid') : ident('_c');
    return call(ident('getBaseStat'), [literal('items'), classRef, literal('2handed')]);
  }
  if (name === 'hardcore') return unary('!', unary('!', member(ident('me'), 'playertype')));
  if (name === 'classic') return unary('!', member(ident('me'), 'gametype'));
  if (name === 'charlvl') return member(ident('me'), 'charlvl');
  // Realm checks
  for (const realm of ['europe', 'uswest', 'useast', 'asia']) {
    if (name === realm) {
      return bin('===',
        call(member(member(ident('me'), 'realm'), 'toLowerCase'), []),
        literal(realm));
    }
  }
  throw new Error(`Unknown property keyword: ${name}`);
}

const CALLABLE_KEYWORDS = new Set(['flag', 'prefix', 'suffix']);
const CALLABLE_FN: Record<string, string> = {
  flag: 'getFlag', prefix: 'getPrefix', suffix: 'getSuffix',
};

export class CodeGenAST {
  constructor(private aliases: AliasMapSet) {}

  emitPropertyExpr(expr: ExprNode): ESTree.Expression {
    return this.emitExpr(expr, 'property', null);
  }

  emitStandalonePropertyExpr(expr: ExprNode): ESTree.Expression {
    return this.emitExpr(expr, 'standalone', null);
  }

  emitStatExpr(expr: ExprNode): ESTree.Expression {
    return this.emitExpr(expr, 'stat', null);
  }

  emitStatExprWithHoisted(expr: ExprNode, hoisted: Map<number | string, string>): ESTree.Expression {
    return this.emitExpr(expr, 'stat', hoisted);
  }

  collectStatIds(expr: ExprNode): Map<string, number | [number, number]> {
    const stats = new Map<string, number | [number, number]>();
    this.walkStats(expr, stats);
    return stats;
  }

  private emitExpr(
    expr: ExprNode,
    section: 'property' | 'stat' | 'standalone',
    hoisted: Map<number | string, string> | null,
    comparisonKeyword?: string,
  ): ESTree.Expression {
    const nipLoc: NipLoc = { source: undefined, line: expr.loc.line, col: expr.loc.col };

    switch (expr.kind) {
      case NodeKind.NumberLiteral:
        return literal(expr.value);

      case NodeKind.Identifier:
        if (comparisonKeyword) {
          const resolved = this.resolveIdentifier(expr.name, comparisonKeyword);
          if (resolved !== null) return literal(resolved);
        }
        return literal(expr.name as any); // string literal for unresolved identifiers

      case NodeKind.KeywordExpr:
        if (section === 'property') return propertyExpr(expr.name, false);
        if (section === 'standalone') return propertyExpr(expr.name, true);
        return this.statExpr(expr.name, hoisted, nipLoc);

      case NodeKind.UnaryExpr:
        return unary('!', this.emitExpr(expr.operand, section, hoisted));

      case NodeKind.BinaryExpr:
        return this.emitBinary(expr, section, hoisted, nipLoc);
    }
  }

  private emitBinary(
    expr: BinaryExprNode,
    section: 'property' | 'stat' | 'standalone',
    hoisted: Map<number | string, string> | null,
    nipLoc: NipLoc,
  ): ESTree.Expression {
    // [flag/prefix/suffix] == value → i.getFlag(value)
    if ((section === 'property' || section === 'standalone')
      && expr.left.kind === NodeKind.KeywordExpr
      && CALLABLE_KEYWORDS.has(expr.left.name)
      && (expr.op === '==' || expr.op === '!=')) {
      const fn = CALLABLE_FN[expr.left.name];
      const value = this.emitExpr(expr.right, section, hoisted, expr.left.name);
      // Reuse _id for [flag] == identified (0x10 = 16)
      if (expr.left.name === 'flag' && expr.right.kind === NodeKind.Identifier) {
        const resolved = this.resolveIdentifier(expr.right.name, 'flag');
        if (resolved === 16) {
          return expr.op === '!=' ? unary('!', ident('_id')) : ident('_id');
        }
      }
      const callNode = call(member(ident('i'), fn), [value], nipLoc);
      return expr.op === '!=' ? unary('!', callNode) : callNode;
    }

    // Property comparison: resolve RHS identifiers
    if ((section === 'property' || section === 'standalone')
      && expr.left.kind === NodeKind.KeywordExpr
      && isComparison(expr.op)) {
      const left = this.emitExpr(expr.left, section, hoisted);
      const right = this.emitExpr(expr.right, section, hoisted, expr.left.name);
      return bin(strictOp(expr.op), left, right, nipLoc);
    }

    const left = this.emitExpr(expr.left, section, hoisted);
    const right = this.emitExpr(expr.right, section, hoisted);
    const op = expr.op;

    if (op === '&&' || op === '||') {
      return logical(op, left, right, nipLoc);
    }
    return bin(isComparison(op) ? strictOp(op) : op, left, right, nipLoc);
  }

  private statExpr(name: string, hoisted: Map<number | string, string> | null, nipLoc: NipLoc): ESTree.Expression {
    if (name === '') return literal(0);

    const stat = this.aliases.stat[name];

    // Numeric stat ID
    if (stat === undefined) {
      if (name.includes(',')) {
        const [id, param] = name.split(',').map(Number);
        return bin('|', call(member(ident('i'), 'getStatEx'), [literal(id), literal(param)], nipLoc), literal(0));
      }
      const num = Number(name);
      if (!isNaN(num)) return bin('|', call(member(ident('i'), 'getStatEx'), [literal(num)], nipLoc), literal(0));
      throw new Error(`Unknown stat: ${name}`);
    }

    const key = Array.isArray(stat) ? `${stat[0]}_${stat[1]}` : stat;
    if (hoisted?.has(key)) return ident(hoisted.get(key)!);

    if (Array.isArray(stat)) {
      return bin('|', call(member(ident('i'), 'getStatEx'), [literal(stat[0]), literal(stat[1])], nipLoc), literal(0));
    }
    return bin('|', call(member(ident('i'), 'getStatEx'), [literal(stat)], nipLoc), literal(0));
  }

  private resolveIdentifier(name: string, keyword: string): number | null {
    const map = getAliasMap(this.aliases, keyword);
    if (map && name in map) return map[name];
    return null;
  }

  private walkStats(expr: ExprNode, stats: Map<string, number | [number, number]>): void {
    switch (expr.kind) {
      case NodeKind.KeywordExpr: {
        const stat = this.aliases.stat[expr.name];
        if (stat !== undefined) stats.set(expr.name, stat);
        break;
      }
      case NodeKind.BinaryExpr:
        this.walkStats(expr.left, stats);
        this.walkStats(expr.right, stats);
        break;
      case NodeKind.UnaryExpr:
        this.walkStats(expr.operand, stats);
        break;
    }
  }
}

function isComparison(op: string): boolean {
  return op === '==' || op === '!=' || op === '>' || op === '>=' || op === '<' || op === '<=';
}

function strictOp(op: string): ESTree.BinaryExpression['operator'] {
  if (op === '==') return '===';
  if (op === '!=') return '!==';
  return op as ESTree.BinaryExpression['operator'];
}
