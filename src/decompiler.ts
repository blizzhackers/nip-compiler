import {
  ExprNode, NipFileNode, NipLineNode, NodeKind,
  SectionNode, MetaSectionNode,
} from './types.js';

export function decompileLine(line: NipLineNode): string {
  const parts: string[] = [];

  if (line.property) {
    parts.push(decompileExpr(line.property.expr));
  }

  if (line.stats || line.meta) {
    parts.push('#');
    if (line.stats) {
      parts.push(decompileExpr(line.stats.expr));
    }
  }

  if (line.meta) {
    parts.push('#');
    parts.push(decompileMeta(line.meta));
  }

  if (line.comment) {
    parts.push(`// ${line.comment}`);
  }

  return parts.join(' ');
}

export function decompileFile(file: NipFileNode): string {
  return file.lines.map(decompileLine).join('\n');
}

function decompileExpr(expr: ExprNode): string {
  switch (expr.kind) {
    case NodeKind.NumberLiteral:
      return String(expr.value);
    case NodeKind.Identifier:
      return expr.name;
    case NodeKind.KeywordExpr:
      return `[${expr.name}]`;
    case NodeKind.UnaryExpr:
      return `!${decompileExpr(expr.operand)}`;
    case NodeKind.BinaryExpr: {
      const left = decompileExpr(expr.left);
      const right = decompileExpr(expr.right);
      const needsParens = expr.op === '||' &&
        expr.left.kind === NodeKind.BinaryExpr && expr.left.op === '&&';
      if (expr.op === '&&' || expr.op === '||') {
        return needsParens
          ? `(${left}) ${expr.op} ${right}`
          : `${left} ${expr.op} ${right}`;
      }
      return `${left} ${expr.op} ${right}`;
    }
  }
}

function decompileMeta(meta: MetaSectionNode): string {
  return meta.entries.map(e => `[${e.key}] == ${decompileExpr(e.expr)}`).join(' ');
}
