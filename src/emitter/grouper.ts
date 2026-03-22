import { ExprNode, NodeKind, BinaryExprNode } from '../types.js';
import { AliasMapSet, AnalyzedLine, DispatchKind, DispatchPlan, GroupedRule } from './types.js';

export class Grouper {
  constructor(private aliases: AliasMapSet) {}
  group(lines: AnalyzedLine[]): DispatchPlan {
    const classidGroups = new Map<number, Map<number | null, GroupedRule[]>>();
    const typeGroups = new Map<number, Map<number | null, GroupedRule[]>>();
    const catchAll: GroupedRule[] = [];

    for (const analyzed of lines) {
      const rule = this.toGroupedRule(analyzed);

      if (!analyzed.dispatch) {
        catchAll.push(rule);
        continue;
      }

      const target = analyzed.dispatch.kind === DispatchKind.Classid ? classidGroups : typeGroups;
      const quality = analyzed.dispatch.quality;

      for (const value of analyzed.dispatch.values) {
        if (!target.has(value)) {
          target.set(value, new Map());
        }
        const qualityMap = target.get(value)!;
        if (!qualityMap.has(quality)) {
          qualityMap.set(quality, []);
        }
        qualityMap.get(quality)!.push(rule);
      }
    }

    return { classidGroups, typeGroups, catchAll };
  }

  private toGroupedRule(analyzed: AnalyzedLine): GroupedRule {
    const residualProperty = analyzed.dispatch && analyzed.line.property
      ? this.stripDispatch(analyzed.line.property.expr, analyzed.dispatch.kind, analyzed.dispatch.values, analyzed.dispatch.quality)
      : (analyzed.line.property?.expr ?? null);

    const statExpr = analyzed.line.stats?.expr ?? null;

    return {
      line: analyzed.line,
      lineIndex: analyzed.lineIndex,
      source: analyzed.source,
      residualProperty,
      statExpr,
      tierExpr: analyzed.tierExpr,
      mercTierExpr: analyzed.mercTierExpr,
      maxQuantity: analyzed.maxQuantity,
    };
  }

  private stripDispatch(
    expr: ExprNode,
    kind: DispatchKind,
    values: number[],
    quality: number | null,
  ): ExprNode | null {
    if (expr.kind === NodeKind.BinaryExpr && expr.op === '&&') {
      const left = this.stripDispatch(expr.left, kind, values, quality);
      const right = this.stripDispatch(expr.right, kind, values, quality);
      if (left === null && right === null) return null;
      if (left === null) return right;
      if (right === null) return left;
      return { ...expr, left, right };
    }

    if (expr.kind === NodeKind.BinaryExpr && expr.op === '==') {
      if (this.isDispatchComparison(expr, kind, values)) return null;
      if (quality !== null && this.isQualityComparison(expr, quality)) return null;
    }

    if (expr.kind === NodeKind.BinaryExpr && expr.op === '||') {
      if (this.isDispatchDisjunction(expr, kind, values)) return null;
    }

    return expr;
  }

  private isDispatchComparison(expr: BinaryExprNode, kind: DispatchKind, values: number[]): boolean {
    if (expr.left.kind !== NodeKind.KeywordExpr) return false;
    const kw = expr.left.name;
    if (kind === DispatchKind.Classid && (kw === 'name' || kw === 'classid')) {
      return this.exprMatchesValues(expr.right, values, kw);
    }
    if (kind === DispatchKind.Type && kw === 'type') {
      return this.exprMatchesValues(expr.right, values, kw);
    }
    return false;
  }

  private isQualityComparison(expr: BinaryExprNode, quality: number): boolean {
    if (expr.left.kind !== NodeKind.KeywordExpr || expr.left.name !== 'quality') return false;
    if (expr.right.kind === NodeKind.NumberLiteral) return expr.right.value === quality;
    if (expr.right.kind === NodeKind.Identifier) {
      const map = this.getAliasMap('quality');
      if (map && expr.right.name in map) return map[expr.right.name] === quality;
    }
    return false;
  }

  private isDispatchDisjunction(expr: BinaryExprNode, kind: DispatchKind, values: number[]): boolean {
    const branches = this.flattenOr(expr);
    return branches.every(b =>
      b.kind === NodeKind.BinaryExpr && b.op === '==' && this.isDispatchComparison(b, kind, values)
    );
  }

  private exprMatchesValues(expr: ExprNode, values: number[], keyword: string): boolean {
    if (expr.kind === NodeKind.NumberLiteral) return values.includes(expr.value);
    if (expr.kind === NodeKind.Identifier) {
      const map = this.getAliasMap(keyword);
      if (map && expr.name in map) return values.includes(map[expr.name]);
    }
    return false;
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

  private flattenOr(expr: ExprNode): ExprNode[] {
    if (expr.kind === NodeKind.BinaryExpr && expr.op === '||') {
      return [...this.flattenOr(expr.left), ...this.flattenOr(expr.right)];
    }
    return [expr];
  }
}
