import {
  ExprNode, NodeKind, BinaryExprNode,
  NipLineNode,
} from '../types.js';
import { AliasMapSet, AnalyzedLine, DispatchKey, DispatchKind, getAliasMap } from './types.js';

function keywordToDispatchKind(kw: string): DispatchKind | null {
  if (kw === 'name' || kw === 'classid') return DispatchKind.Classid;
  if (kw === 'type') return DispatchKind.Type;
  return null;
}

export class Analyzer {
  constructor(private aliases: AliasMapSet) {}

  analyze(line: NipLineNode, lineIndex: number, filename: string): AnalyzedLine {
    const source = `${filename}#${line.lineNumber}`;
    let dispatch: DispatchKey | null = null;

    if (line.property) {
      dispatch = this.extractDispatchKey(line.property.expr);
    }

    let tierExpr: ExprNode | null = null;
    let mercTierExpr: ExprNode | null = null;
    let maxQuantity: number | null = null;

    if (line.meta) {
      for (const entry of line.meta.entries) {
        if (entry.key === 'tier') {
          tierExpr = entry.expr;
        } else if (entry.key === 'merctier') {
          mercTierExpr = entry.expr;
        } else if (entry.key === 'maxquantity' && entry.expr.kind === NodeKind.NumberLiteral) {
          maxQuantity = entry.expr.value;
        }
      }
    }

    return { line, lineIndex, source, dispatch, tierExpr, mercTierExpr, maxQuantity };
  }

  private extractDispatchKey(expr: ExprNode): DispatchKey | null {
    if (expr.kind === NodeKind.BinaryExpr) {
      if (expr.op === '&&') {
        return this.extractFromConjunction(expr);
      }
      if (expr.op === '==') {
        return this.extractFromComparison(expr);
      }
      if (expr.op === '||') {
        return this.extractFromDisjunction(expr);
      }
    }
    return null;
  }

  private extractFromConjunction(expr: BinaryExprNode): DispatchKey | null {
    const conjuncts = this.flattenAnd(expr);
    let classidValues: number[] | null = null;
    let typeValues: number[] | null = null;
    let quality: number | null = null;

    for (const conjunct of conjuncts) {
      if (conjunct.kind === NodeKind.BinaryExpr && conjunct.op === '==') {
        const cmp = this.extractFromComparison(conjunct);
        if (cmp) {
          if (cmp.kind === DispatchKind.Classid) classidValues = cmp.values;
          else if (cmp.kind === DispatchKind.Type) typeValues = cmp.values;
        }
        // Also check for quality
        const q = this.extractQuality(conjunct);
        if (q !== null) quality = q;
      } else if (conjunct.kind === NodeKind.BinaryExpr && conjunct.op === '||') {
        const disj = this.extractFromDisjunction(conjunct);
        if (disj) {
          if (disj.kind === DispatchKind.Classid) classidValues = disj.values;
          else if (disj.kind === DispatchKind.Type) typeValues = disj.values;
        }
      } else if (conjunct.kind === NodeKind.BinaryExpr && conjunct.op === '<=') {
        const q = this.extractQualityComparison(conjunct);
        if (q !== null) quality = q;
      }
    }

    if (classidValues) return { kind: DispatchKind.Classid, values: classidValues, quality };
    if (typeValues) return { kind: DispatchKind.Type, values: typeValues, quality };
    return null;
  }

  private extractFromComparison(expr: BinaryExprNode): DispatchKey | null {
    if (expr.op !== '==') return null;
    if (expr.left.kind !== NodeKind.KeywordExpr) return null;
    const kw = expr.left.name;
    const value = this.resolveValue(expr.right, kw);
    if (value === null) return null;

    const dispatchKind = keywordToDispatchKind(kw);
    if (dispatchKind) return { kind: dispatchKind, values: [value], quality: null };
    return null;
  }

  private extractFromDisjunction(expr: BinaryExprNode): DispatchKey | null {
    if (expr.op !== '||') return null;
    const branches = this.flattenOr(expr);
    const values: number[] = [];
    let kind: DispatchKind | null = null;

    for (const branch of branches) {
      if (branch.kind !== NodeKind.BinaryExpr || branch.op !== '==') return null;
      if (branch.left.kind !== NodeKind.KeywordExpr) return null;
      const branchKind = keywordToDispatchKind(branch.left.name);
      if (!branchKind) return null;
      if (kind && kind !== branchKind) return null;
      kind = branchKind;
      const kw = branch.left.name;
      const value = this.resolveValue(branch.right, kw);
      if (value === null) return null;
      values.push(value);
    }

    if (kind && values.length > 0) {
      return { kind, values, quality: null };
    }
    return null;
  }

  private extractQuality(expr: BinaryExprNode): number | null {
    if (expr.op !== '==') return null;
    if (expr.left.kind !== NodeKind.KeywordExpr || expr.left.name !== 'quality') return null;
    return this.resolveValue(expr.right, 'quality');
  }

  private extractQualityComparison(expr: BinaryExprNode): number | null {
    // [quality] <= X — not a fixed dispatch, return null
    // We only dispatch on exact quality match
    return null;
  }

  private resolveValue(expr: ExprNode, keyword: string): number | null {
    if (expr.kind === NodeKind.NumberLiteral) return expr.value;
    if (expr.kind === NodeKind.Identifier) {
      const map = getAliasMap(this.aliases, keyword);
      if (map && expr.name in map) return map[expr.name];
    }
    return null;
  }

  private flattenAnd(expr: ExprNode, out: ExprNode[] = []): ExprNode[] {
    if (expr.kind === NodeKind.BinaryExpr && expr.op === '&&') {
      this.flattenAnd(expr.left, out);
      this.flattenAnd(expr.right, out);
    } else {
      out.push(expr);
    }
    return out;
  }

  private flattenOr(expr: ExprNode, out: ExprNode[] = []): ExprNode[] {
    if (expr.kind === NodeKind.BinaryExpr && expr.op === '||') {
      this.flattenOr(expr.left, out);
      this.flattenOr(expr.right, out);
    } else {
      out.push(expr);
    }
    return out;
  }
}
