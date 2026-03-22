import { ExprNode, NodeKind, BinaryExprNode, KeywordExprNode } from '../types.js';
import { AliasMapSet } from './types.js';

const PROPERTY_MAP: Record<string, string> = {
  classid: 'item.classid',
  name: 'item.classid',
  type: 'item.itemType',
  quality: 'item.quality',
  class: 'item.itemclass',
  level: 'item.ilvl',
  charlvl: 'me.charlvl',
  wsm: 'getBaseStat("items",item.classid,"speed")',
  weaponspeed: 'getBaseStat("items",item.classid,"speed")',
  minimumsockets: 'getBaseStat("items",item.classid,"gemsockets")',
  strreq: 'item.strreq',
  dexreq: 'item.dexreq',
  '2handed': 'getBaseStat("items",item.classid,"2handed")',
  color: 'item.getColor()',
  ladder: 'me.ladder',
  hardcore: '(!!me.playertype)',
  classic: '(!me.gametype)',
  distance: '(item.onGroundOrDropping&&item.distance||Infinity)',
  europe: '(me.realm.toLowerCase()==="europe")',
  uswest: '(me.realm.toLowerCase()==="uswest")',
  useast: '(me.realm.toLowerCase()==="useast")',
  asia: '(me.realm.toLowerCase()==="asia")',
};

const CALLABLE_KEYWORDS = new Set(['flag', 'prefix', 'suffix']);
const CALLABLE_FN: Record<string, string> = {
  flag: 'item.getFlag',
  prefix: 'item.getPrefix',
  suffix: 'item.getSuffix',
};

export class CodeGen {
  constructor(private aliases: AliasMapSet) {}

  emitPropertyExpr(expr: ExprNode): string {
    return this.emitExpr(expr, 'property', null);
  }

  emitStatExpr(expr: ExprNode): string {
    return this.emitExpr(expr, 'stat', null);
  }

  collectStatIds(expr: ExprNode): Map<string, number | [number, number]> {
    const stats = new Map<string, number | [number, number]>();
    this.walkStats(expr, stats);
    return stats;
  }

  emitStatExprWithHoisted(expr: ExprNode, hoisted: Map<number | string, string>): string {
    return this.emitExpr(expr, 'stat', hoisted);
  }

  private emitExpr(
    expr: ExprNode,
    section: 'property' | 'stat',
    hoisted: Map<number | string, string> | null,
    comparisonKeyword?: string,
  ): string {
    switch (expr.kind) {
      case NodeKind.NumberLiteral:
        return String(expr.value);

      case NodeKind.Identifier:
        if (comparisonKeyword) {
          const resolved = this.resolveIdentifier(expr.name, comparisonKeyword);
          if (resolved !== null) return String(resolved);
        }
        return String(expr.name);

      case NodeKind.KeywordExpr:
        if (section === 'property') {
          return this.emitPropertyKeyword(expr.name);
        }
        return this.emitStatKeyword(expr.name, hoisted);

      case NodeKind.UnaryExpr:
        return `(!${this.emitExpr(expr.operand, section, hoisted)})`;

      case NodeKind.BinaryExpr:
        return this.emitBinary(expr, section, hoisted);
    }
  }

  private emitBinary(
    expr: BinaryExprNode,
    section: 'property' | 'stat',
    hoisted: Map<number | string, string> | null,
  ): string {
    // Special: [flag/prefix/suffix] == value → item.getFlag(value) / !item.getFlag(value)
    if (section === 'property' && expr.left.kind === NodeKind.KeywordExpr
      && CALLABLE_KEYWORDS.has(expr.left.name)
      && (expr.op === '==' || expr.op === '!=')) {
      const fn = CALLABLE_FN[expr.left.name];
      const value = this.emitExpr(expr.right, section, hoisted, expr.left.name);
      // Reuse the hoisted `identified` var for [flag] == identified (0x10 = 16)
      if (expr.left.name === 'flag' && value === '16') {
        return expr.op === '!=' ? '(!identified)' : 'identified';
      }
      const call = `${fn}(${value})`;
      return expr.op === '!=' ? `(!${call})` : call;
    }

    // Resolve RHS identifiers when LHS is a property keyword comparison
    if (section === 'property' && expr.left.kind === NodeKind.KeywordExpr
      && isComparison(expr.op)) {
      const left = this.emitExpr(expr.left, section, hoisted);
      const right = this.emitExpr(expr.right, section, hoisted, expr.left.name);
      return `(${left}${strictOp(expr.op)}${right})`;
    }

    const left = this.emitExpr(expr.left, section, hoisted);
    const right = this.emitExpr(expr.right, section, hoisted);
    const op = isComparison(expr.op) ? strictOp(expr.op) : expr.op;
    return `(${left}${op}${right})`;
  }

  private emitPropertyKeyword(name: string): string {
    const mapped = PROPERTY_MAP[name];
    if (!mapped) throw new Error(`Unknown property keyword: ${name}`);
    return mapped;
  }

  private emitStatKeyword(name: string, hoisted: Map<number | string, string> | null): string {
    const stat = this.aliases.stat[name];

    // Numeric stat ID: [218] → getStatEx(218), [83,1] → getStatEx(83,1)
    if (stat === undefined) {
      if (name.includes(',')) {
        const [id, param] = name.split(',');
        return `(item.getStatEx(${id},${param})|0)`;
      }
      const num = Number(name);
      if (!isNaN(num)) return `(item.getStatEx(${num})|0)`;
      throw new Error(`Unknown stat: ${name}`);
    }

    const key = Array.isArray(stat) ? `${stat[0]}_${stat[1]}` : stat;
    if (hoisted?.has(key)) return hoisted.get(key)!;

    // |0 hints SpiderMonkey that getStatEx returns int32
    if (Array.isArray(stat)) {
      return `(item.getStatEx(${stat[0]},${stat[1]})|0)`;
    }
    return `(item.getStatEx(${stat})|0)`;
  }

  private resolveIdentifier(name: string, keyword: string): number | null {
    const map = this.getAliasMap(keyword);
    if (map && name in map) return map[name];
    return null;
  }

  private getAliasMap(keyword: string): Record<string, number> | null {
    switch (keyword) {
      case 'name': case 'classid': return this.aliases.classId;
      case 'type': return this.aliases.type;
      case 'quality': return this.aliases.quality;
      case 'flag': return this.aliases.flag;
      case 'color': return this.aliases.color;
      case 'class': return this.aliases.class;
      default: return null;
    }
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

function strictOp(op: string): string {
  if (op === '==') return '===';
  if (op === '!=') return '!==';
  return op;
}
