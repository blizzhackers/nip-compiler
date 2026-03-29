import {
  AstNode, Diagnostic, DiagnosticSeverity, DiagnosticTag, ExprNode, KeywordExprNode,
  MetaEntryNode, MetaSectionNode, NipFileNode, NipLineNode, NodeKind,
  SectionNode, IdentifierNode, BinaryExprNode, SourceLocation,
} from './types.js';

const PROPERTY_ALIASES: Record<string, string> = {
  n: 'name',
  id: 'classid',
  t: 'type',
  q: 'quality',
  lvl: 'level',
  ilvl: 'level',
  f: 'flag',
  hc: 'hardcore',
  cl: 'classic',
  clvl: 'charlvl',
};

const PROPERTY_KEYWORDS = new Set([
  'classid', 'name', 'type', 'class', 'quality', 'charlvl', 'level',
  'flag', 'wsm', 'weaponspeed', 'minimumsockets', 'strreq', 'dexreq',
  '2handed', 'color', 'europe', 'uswest', 'useast', 'asia',
  'ladder', 'hardcore', 'classic', 'distance', 'prefix', 'suffix',
]);

const META_KEYWORDS = new Set([
  'maxquantity', 'mq', 'tier', 'merctier',
]);

const META_ALIASES: Record<string, string> = {
  mq: 'maxquantity',
};

export interface BinderResult {
  node: NipFileNode | NipLineNode;
  diagnostics: Diagnostic[];
}

export class Binder {
  private diagnostics: Diagnostic[] = [];
  private knownStats: Set<string> | null = null;
  private knownPropertyValues: Map<string, Set<string>> | null = null;
  // For range resolution: keyword → { byName: name→id, byValue: id→names[] }
  private rangeAliases: Map<string, {
    byName: Record<string, number>;
    byValue: Map<number, string[]>;
  }> | null = null;

  constructor(options?: {
    knownStats?: Set<string>;
    knownPropertyValues?: Map<string, Set<string>>;
    propertyAliases?: Record<string, Record<string, number>>;
    classIdAliases?: Record<string, number>;
  }) {
    if (options?.knownStats) this.knownStats = options.knownStats;
    if (options?.knownPropertyValues) this.knownPropertyValues = options.knownPropertyValues;

    // Build range alias maps — support both legacy classIdAliases and new propertyAliases
    const aliasEntries: [string, Record<string, number>][] = [];
    if (options?.propertyAliases) {
      for (const [kw, map] of Object.entries(options.propertyAliases)) {
        aliasEntries.push([kw, map]);
      }
    }
    if (options?.classIdAliases) {
      aliasEntries.push(['name', options.classIdAliases]);
      aliasEntries.push(['classid', options.classIdAliases]);
    }
    if (aliasEntries.length > 0) {
      this.rangeAliases = new Map();
      for (const [kw, map] of aliasEntries) {
        const byValue = new Map<number, string[]>();
        for (const [name, id] of Object.entries(map)) {
          const list = byValue.get(id);
          if (list) list.push(name);
          else byValue.set(id, [name]);
        }
        this.rangeAliases.set(kw, { byName: map, byValue });
      }
    }
  }

  bindFile(node: NipFileNode): BinderResult {
    const allDiagnostics: Diagnostic[] = [];
    for (const line of node.lines) {
      const { diagnostics } = this.bindLine(line);
      // Offset diagnostic lines to file-level line numbers
      for (const diag of diagnostics) {
        diag.loc = { ...diag.loc, line: line.lineNumber };
      }
      allDiagnostics.push(...diagnostics);
    }
    return { node, diagnostics: allDiagnostics };
  }

  bindLine(node: NipLineNode): BinderResult {
    this.diagnostics = [];

    if (node.property) {
      this.bindPropertySection(node.property);
    }
    if (node.stats) {
      this.bindStatSection(node.stats);
    }
    if (node.meta) {
      this.bindMetaSection(node.meta);
    }

    return { node, diagnostics: [...this.diagnostics] };
  }

  private bindPropertySection(section: SectionNode): void {
    this.bindPropertyExpr(section.expr);
  }

  private bindStatSection(section: SectionNode): void {
    this.bindStatExpr(section.expr);
  }

  private bindMetaSection(section: MetaSectionNode): void {
    const seen = new Set<string>();
    for (const entry of section.entries) {
      const resolved = META_ALIASES[entry.key] ?? entry.key;
      entry.key = resolved;

      if (!META_KEYWORDS.has(entry.key) && !META_ALIASES[entry.key]) {
        this.error(entry, `Unknown meta keyword '${entry.key}'`);
        continue;
      }

      if (seen.has(resolved)) {
        this.warning(entry, `Duplicate meta keyword '${resolved}'`);
      }
      seen.add(resolved);

      this.bindMetaExpr(entry);
    }
  }

  private bindPropertyExpr(expr: ExprNode, insideAnd = false): void {
    switch (expr.kind) {
      case NodeKind.KeywordExpr:
        this.resolvePropertyKeyword(expr);
        break;
      case NodeKind.BinaryExpr:
        if (isComparison(expr.op)) {
          this.bindPropertyComparison(expr, insideAnd);
        } else if (expr.op === '&&') {
          this.bindPropertyExpr(expr.left, true);
          this.bindPropertyExpr(expr.right, true);
          this.detectRange(expr);
        } else {
          this.bindPropertyExpr(expr.left, insideAnd);
          this.bindPropertyExpr(expr.right, insideAnd);
        }
        break;
      case NodeKind.UnaryExpr:
        this.bindPropertyExpr(expr.operand);
        break;
      case NodeKind.NumberLiteral:
      case NodeKind.Identifier:
        break;
    }
  }

  private bindPropertyComparison(expr: BinaryExprNode, insideAnd = false): void {
    this.bindPropertyExpr(expr.left);
    if (expr.op === '==' && expr.left.kind === NodeKind.KeywordExpr && expr.right.kind === NodeKind.Identifier) {
      this.validatePropertyValue(expr.left, expr.right);
    } else {
      this.bindPropertyExpr(expr.right);
      if (!insideAnd) this.detectSingleBoundRange(expr);
    }
  }

  private detectSingleBoundRange(expr: BinaryExprNode): void {
    if (!this.rangeAliases) return;
    if (expr.op !== '<=' && expr.op !== '<' && expr.op !== '>=' && expr.op !== '>') return;
    if (expr.left.kind !== NodeKind.KeywordExpr) return;
    const kw = expr.left.name;
    const aliases = this.rangeAliases.get(kw);
    if (!aliases) return;

    let boundValue: number | null = null;
    if (expr.right.kind === NodeKind.NumberLiteral) boundValue = expr.right.value;
    else if (expr.right.kind === NodeKind.Identifier && expr.right.name in aliases.byName) {
      boundValue = aliases.byName[expr.right.name];
    }
    if (boundValue === null) return;

    // Only show for <= and < (upper bound from 0) and >= and > (lower bound to max)
    // Find the actual range of known values
    const allIds = [...aliases.byValue.keys()].sort((a, b) => a - b);
    if (allIds.length === 0) return;
    const minId = allIds[0];
    const maxId = allIds[allIds.length - 1];

    let low: number, high: number;
    if (expr.op === '<=' || expr.op === '<') {
      low = minId;
      high = expr.op === '<' ? boundValue - 1 : boundValue;
    } else {
      low = expr.op === '>' ? boundValue + 1 : boundValue;
      high = maxId;
    }

    // Don't show for trivial ranges (everything or just one item)
    const matches: string[] = [];
    for (let id = low; id <= high; id++) {
      const names = aliases.byValue.get(id);
      if (names) {
        const best = names.reduce((a, b) => a.length >= b.length ? a : b);
        matches.push(best);
      }
    }

    if (matches.length > 1 && matches.length < aliases.byValue.size) {
      const label = kw === 'quality' ? 'qualities' : 'items';
      const list = matches.length <= 15
        ? matches.join(', ')
        : matches.slice(0, 12).join(', ') + `, ... (${matches.length} total)`;
      this.info({ loc: this.exprSpan(expr) }, `Matches ${matches.length} ${label}: ${list}`, 'range');
    }
  }

  private resolvePropertyKeyword(expr: KeywordExprNode): void {
    const resolved = PROPERTY_ALIASES[expr.name] ?? expr.name;
    expr.name = resolved;

    if (!PROPERTY_KEYWORDS.has(resolved)) {
      this.error(expr, `Unknown property keyword '${expr.name}'`);
    }
  }

  private validatePropertyValue(keyword: KeywordExprNode, value: IdentifierNode): void {
    if (!this.knownPropertyValues) return;
    const values = this.knownPropertyValues.get(keyword.name);
    if (values && !values.has(value.name)) {
      this.error(value, `Unknown ${keyword.name} value '${value.name}'`);
    }
  }

  private bindStatExpr(expr: ExprNode): void {
    switch (expr.kind) {
      case NodeKind.KeywordExpr:
        this.resolveStatKeyword(expr);
        break;
      case NodeKind.BinaryExpr:
        this.bindStatExpr(expr.left);
        this.bindStatExpr(expr.right);
        break;
      case NodeKind.UnaryExpr:
        this.bindStatExpr(expr.operand);
        break;
      case NodeKind.NumberLiteral:
      case NodeKind.Identifier:
        break;
    }
  }

  private resolveStatKeyword(expr: KeywordExprNode): void {
    if (this.knownStats && !this.knownStats.has(expr.name)) {
      this.error(expr, `Unknown stat '${expr.name}'`);
    }
  }

  private bindMetaExpr(entry: MetaEntryNode): void {
    if (entry.key === 'maxquantity') {
      if (entry.expr.kind !== NodeKind.NumberLiteral) {
        this.error(entry.expr, 'maxquantity must be a number');
      } else if (entry.expr.value < 0) {
        this.error(entry.expr, 'maxquantity must be non-negative');
      }
    }
    // tier/merctier can be arbitrary expressions — no validation needed
  }

  private exprSpan(expr: ExprNode): SourceLocation {
    const right = this.rightmostNode(expr);
    const endCol = right.loc.col + this.nodeTextLength(right);
    return { ...expr.loc, end: endCol };
  }

  private rightmostNode(expr: ExprNode): ExprNode {
    if (expr.kind === NodeKind.BinaryExpr) return this.rightmostNode(expr.right);
    if (expr.kind === NodeKind.UnaryExpr) return this.rightmostNode(expr.operand);
    return expr;
  }

  private nodeTextLength(expr: ExprNode): number {
    if (expr.kind === NodeKind.Identifier) return expr.name.length;
    if (expr.kind === NodeKind.NumberLiteral) return String(expr.value).length;
    if (expr.kind === NodeKind.KeywordExpr) return expr.name.length + 2;
    return 1;
  }

  private error(node: { loc: { pos: number; line: number; col: number } }, message: string): void {
    this.diagnostics.push({
      severity: DiagnosticSeverity.Error,
      message,
      loc: node.loc,
    });
  }

  private warning(node: { loc: { pos: number; line: number; col: number } }, message: string): void {
    this.diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      message,
      loc: node.loc,
    });
  }

  private info(node: { loc: { pos: number; line: number; col: number } }, message: string, tag?: DiagnosticTag): void {
    this.diagnostics.push({
      severity: DiagnosticSeverity.Info,
      message,
      loc: node.loc,
      tag,
    });
  }

  private detectRange(expr: BinaryExprNode): void {
    if (!this.rangeAliases) return;
    if (expr.op !== '&&') return;

    const extractBound = (e: ExprNode): { keyword: string; op: string; value: number } | null => {
      if (e.kind !== NodeKind.BinaryExpr) return null;
      if (e.op !== '>=' && e.op !== '<=' && e.op !== '>' && e.op !== '<') return null;
      if (e.left.kind !== NodeKind.KeywordExpr) return null;
      const kw = e.left.name;
      const aliases = this.rangeAliases!.get(kw);
      if (!aliases) return null;
      if (e.right.kind === NodeKind.NumberLiteral) return { keyword: kw, op: e.op, value: e.right.value };
      if (e.right.kind === NodeKind.Identifier && e.right.name in aliases.byName) {
        return { keyword: kw, op: e.op, value: aliases.byName[e.right.name] };
      }
      return null;
    };

    const left = extractBound(expr.left);
    const right = extractBound(expr.right);
    if (!left || !right) return;
    if (left.keyword !== right.keyword) return;

    let low: number, high: number;
    if ((left.op === '>=' || left.op === '>') && (right.op === '<=' || right.op === '<')) {
      low = left.op === '>' ? left.value + 1 : left.value;
      high = right.op === '<' ? right.value - 1 : right.value;
    } else if ((right.op === '>=' || right.op === '>') && (left.op === '<=' || left.op === '<')) {
      low = right.op === '>' ? right.value + 1 : right.value;
      high = left.op === '<' ? left.value - 1 : left.value;
    } else {
      return;
    }

    if (low > high) return;

    const aliases = this.rangeAliases!.get(left.keyword)!;
    const matches: string[] = [];
    for (let id = low; id <= high; id++) {
      const names = aliases.byValue.get(id);
      if (names) {
        const best = names.reduce((a, b) => a.length >= b.length ? a : b);
        matches.push(best);
      }
    }

    if (matches.length > 0) {
      const label = left.keyword === 'quality' ? 'qualities' : 'items';
      const list = matches.length <= 15
        ? matches.join(', ')
        : matches.slice(0, 12).join(', ') + `, ... (${matches.length} total)`;
      this.info({ loc: this.exprSpan(expr) }, `Matches ${matches.length} ${label}: ${list}`, 'range');
    }
  }
}

function isComparison(op: string): boolean {
  return op === '==' || op === '!=' || op === '>' || op === '>=' || op === '<' || op === '<=';
}
