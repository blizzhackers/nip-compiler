import { Diagnostic, DiagnosticSeverity, ExprNode, NodeKind } from '../types.js';
import { AnalyzedLine, DispatchPlan, GroupedRule } from './types.js';

export class DiagnosticAnalyzer {
  analyze(plan: DispatchPlan, lines: AnalyzedLine[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    this.detectDeadCode(plan, diagnostics);
    this.detectDuplicateDispatch(plan, lines, diagnostics);
    return diagnostics;
  }

  private detectDeadCode(plan: DispatchPlan, diagnostics: Diagnostic[]): void {
    const checkGroup = (qualityMap: Map<number | null, GroupedRule[]>) => {
      for (const [, rules] of qualityMap) {
        let foundUnconditional = false;
        for (const rule of rules) {
          if (foundUnconditional) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              message: `Unreachable rule — previous rule in this group matches unconditionally`,
              loc: rule.line.loc ?? { pos: 0, line: rule.line.lineNumber, col: 1 },
              file: rule.source.split('#')[0],
              line: rule.line.lineNumber,
              tag: 'unreachable',
            });
          }
          if (!rule.residualProperty && !rule.statExpr) {
            foundUnconditional = true;
          }
        }
      }
    };

    for (const [, qualityMap] of plan.classidGroups) checkGroup(qualityMap);
    for (const [, qualityMap] of plan.typeGroups) checkGroup(qualityMap);

    // Catch-all dead code
    let foundUnconditional = false;
    for (const rule of plan.catchAll) {
      if (foundUnconditional) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          message: `Unreachable catch-all rule — previous rule matches unconditionally`,
          loc: rule.line.loc ?? { pos: 0, line: rule.line.lineNumber, col: 1 },
          file: rule.source.split('#')[0],
          line: rule.line.lineNumber,
          tag: 'unreachable',
        });
      }
      if (!rule.residualProperty && !rule.statExpr) {
        foundUnconditional = true;
      }
    }
  }

  private detectDuplicateDispatch(
    plan: DispatchPlan,
    lines: AnalyzedLine[],
    diagnostics: Diagnostic[],
  ): void {
    // Group lines by their dispatch signature to find duplicates
    const seen = new Map<string, AnalyzedLine>();

    for (const line of lines) {
      const key = this.lineSignature(line);
      if (!key) continue;

      const existing = seen.get(key);
      if (existing) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          message: `Duplicate rule — same conditions as ${existing.source}`,
          loc: line.line.loc ?? { pos: 0, line: line.line.lineNumber, col: 1 },
          file: line.source.split('#')[0],
          line: line.line.lineNumber,
          tag: 'duplicate',
        });
      } else {
        seen.set(key, line);
      }
    }
  }

  private lineSignature(line: AnalyzedLine): string | null {
    const parts: string[] = [];

    if (line.dispatch) {
      parts.push(`d:${line.dispatch.kind}:${line.dispatch.values.sort().join(',')}`);
      if (line.dispatch.quality !== null) parts.push(`q:${line.dispatch.quality}`);
    }

    if (line.line.property) {
      parts.push(`p:${this.exprSignature(line.line.property.expr)}`);
    }
    if (line.line.stats) {
      parts.push(`s:${this.exprSignature(line.line.stats.expr)}`);
    }

    return parts.length > 0 ? parts.join('|') : null;
  }

  private exprSignature(expr: ExprNode): string {
    switch (expr.kind) {
      case NodeKind.NumberLiteral:
        return `n:${expr.value}`;
      case NodeKind.Identifier:
        return `id:${expr.name}`;
      case NodeKind.KeywordExpr:
        return `kw:${expr.name}`;
      case NodeKind.UnaryExpr:
        return `!${this.exprSignature(expr.operand)}`;
      case NodeKind.BinaryExpr: {
        const left = this.exprSignature(expr.left);
        const right = this.exprSignature(expr.right);
        // Normalize commutative ops so A&&B == B&&A
        if (expr.op === '&&' || expr.op === '||') {
          const sorted = [left, right].sort();
          return `(${sorted[0]}${expr.op}${sorted[1]})`;
        }
        return `(${left}${expr.op}${right})`;
      }
    }
  }
}
