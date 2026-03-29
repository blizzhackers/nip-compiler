import {
  AstNode, Diagnostic, DiagnosticSeverity, DiagnosticTag, ExprNode, KeywordExprNode,
  MetaEntryNode, MetaSectionNode, NipFileNode, NipLineNode, NodeKind,
  SectionNode, IdentifierNode, BinaryExprNode,
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
  private classIdByValue: Map<number, string[]> | null = null;
  private classIdByName: Record<string, number> | null = null;

  constructor(options?: {
    knownStats?: Set<string>;
    knownPropertyValues?: Map<string, Set<string>>;
    classIdAliases?: Record<string, number>;
  }) {
    if (options?.knownStats) this.knownStats = options.knownStats;
    if (options?.knownPropertyValues) this.knownPropertyValues = options.knownPropertyValues;
    if (options?.classIdAliases) {
      this.classIdByName = options.classIdAliases;
      this.classIdByValue = new Map();
      for (const [name, id] of Object.entries(options.classIdAliases)) {
        const list = this.classIdByValue.get(id);
        if (list) list.push(name);
        else this.classIdByValue.set(id, [name]);
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

  private bindPropertyExpr(expr: ExprNode): void {
    switch (expr.kind) {
      case NodeKind.KeywordExpr:
        this.resolvePropertyKeyword(expr);
        break;
      case NodeKind.BinaryExpr:
        if (isComparison(expr.op)) {
          this.bindPropertyComparison(expr);
        } else if (expr.op === '&&') {
          this.bindPropertyExpr(expr.left);
          this.bindPropertyExpr(expr.right);
          this.detectRange(expr);
        } else {
          this.bindPropertyExpr(expr.left);
          this.bindPropertyExpr(expr.right);
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

  private bindPropertyComparison(expr: BinaryExprNode): void {
    this.bindPropertyExpr(expr.left);
    // Only validate values for == (exact match). >= / <= use aliases as numeric bounds
    if (expr.op === '==' && expr.left.kind === NodeKind.KeywordExpr && expr.right.kind === NodeKind.Identifier) {
      this.validatePropertyValue(expr.left, expr.right);
    } else {
      this.bindPropertyExpr(expr.right);
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
    if (!this.classIdByName || !this.classIdByValue) return;
    if (expr.op !== '&&') return;

    // Look for [name/classid] >= X && [name/classid] <= Y (or reversed)
    const extractBound = (e: ExprNode): { keyword: string; op: string; value: number } | null => {
      if (e.kind !== NodeKind.BinaryExpr) return null;
      if (e.op !== '>=' && e.op !== '<=' && e.op !== '>' && e.op !== '<') return null;
      if (e.left.kind !== NodeKind.KeywordExpr) return null;
      const kw = e.left.name;
      if (kw !== 'name' && kw !== 'classid') return null;
      if (e.right.kind === NodeKind.NumberLiteral) return { keyword: kw, op: e.op, value: e.right.value };
      if (e.right.kind === NodeKind.Identifier && e.right.name in this.classIdByName!) {
        return { keyword: kw, op: e.op, value: this.classIdByName![e.right.name] };
      }
      return null;
    };

    const left = extractBound(expr.left);
    const right = extractBound(expr.right);
    if (!left || !right) return;
    if (left.keyword !== right.keyword) return;

    // Determine range [low, high]
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

    // Collect matching item names
    const matches: string[] = [];
    for (let id = low; id <= high; id++) {
      const names = this.classIdByValue!.get(id);
      if (names) {
        // Prefer the longest name (human-readable)
        const best = names.reduce((a, b) => a.length >= b.length ? a : b);
        matches.push(best);
      }
    }

    if (matches.length > 0) {
      const list = matches.length <= 15
        ? matches.join(', ')
        : matches.slice(0, 12).join(', ') + `, ... (${matches.length} total)`;
      this.info(expr, `Matches ${matches.length} items: ${list}`, 'range');
    }
  }
}

function isComparison(op: string): boolean {
  return op === '==' || op === '!=' || op === '>' || op === '>=' || op === '<' || op === '<=';
}
