import {
  AstNode, Diagnostic, DiagnosticSeverity, DiagnosticTag, ExprNode, KeywordExprNode,
  MetaEntryNode, MetaSectionNode, NipFileNode, NipLineNode, NodeKind,
  SectionNode, IdentifierNode, BinaryExprNode, SourceLocation,
} from './types.js';
import {
  resolveUnique, resolveSetItem, resolveSetName,
  isUniqueName, isSetItemName, isSetName,
  getAllUniqueNames, getAllSetItemNames, getAllSetNames,
  type StatCheck,
} from './emitter/d2-discriminator.js';
import {
  setItems, setNameToKey, setNameToKeyLower,
} from './emitter/d2-set-items.js';

export type JipLanguage = 'nip' | 'jip';

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

const JIP_PROPERTY_KEYWORDS = new Set([
  ...PROPERTY_KEYWORDS, 'unique', 'set',
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
  /** For JIP set name expansion: additional lines generated from [set] == SetName */
  expandedLines?: NipLineNode[];
}

export class Binder {
  private diagnostics: Diagnostic[] = [];
  private knownStats: Set<string> | null = null;
  private knownPropertyValues: Map<string, Set<string>> | null = null;
  private language: JipLanguage = 'nip';
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
    language?: JipLanguage;
  }) {
    if (options?.knownStats) this.knownStats = options.knownStats;
    if (options?.knownPropertyValues) this.knownPropertyValues = options.knownPropertyValues;
    if (options?.language) this.language = options.language;

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
    const newLines: NipLineNode[] = [];
    for (const line of node.lines) {
      const { diagnostics, expandedLines } = this.bindLine(line);
      for (const diag of diagnostics) {
        diag.loc = { ...diag.loc, line: line.lineNumber };
      }
      allDiagnostics.push(...diagnostics);
      newLines.push(line);
      if (expandedLines) {
        for (const expanded of expandedLines) {
          newLines.push(expanded);
        }
      }
    }
    node.lines = newLines;
    return { node, diagnostics: allDiagnostics };
  }

  bindLine(node: NipLineNode): BinderResult {
    this.diagnostics = [];
    let expandedLines: NipLineNode[] | undefined;

    if (node.property && this.language === 'jip') {
      expandedLines = this.rewriteJipProperty(node);
    }

    if (node.property) {
      this.bindPropertySection(node.property);
    }
    if (node.stats) {
      this.bindStatSection(node.stats);
    }
    if (node.meta) {
      this.bindMetaSection(node.meta);
    }

    return { node, diagnostics: [...this.diagnostics], expandedLines };
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

    const keywords = this.language === 'jip' ? JIP_PROPERTY_KEYWORDS : PROPERTY_KEYWORDS;
    if (!keywords.has(resolved)) {
      const suggestion = findClosestMatch(expr.name, keywords);
      const hint = suggestion ? `. Did you mean '${suggestion}'?` : '';
      this.error(expr, `Unknown property keyword '${expr.name}'${hint}`);
    }
  }

  private validatePropertyValue(keyword: KeywordExprNode, value: IdentifierNode): void {
    if (!this.knownPropertyValues) return;
    const values = this.knownPropertyValues.get(keyword.name);
    if (values && !values.has(value.name)) {
      const suggestion = findClosestMatch(value.name, values);
      const hint = suggestion ? `. Did you mean '${suggestion}'?` : '';
      this.error(value, `Unknown ${keyword.name} value '${value.name}'${hint}`);
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
      // Skip numeric stat IDs (they're valid even if not in the alias table)
      if (/^\d/.test(expr.name)) return;
      const suggestion = findClosestMatch(expr.name, this.knownStats);
      const hint = suggestion ? `. Did you mean '${suggestion}'?` : '';
      this.error(expr, `Unknown stat '${expr.name}'${hint}`);
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

  /**
   * Detect [unique] == Name or [set] == Name in JIP mode and rewrite the AST.
   * Returns expanded lines for set name expansion, or undefined.
   */
  private rewriteJipProperty(node: NipLineNode): NipLineNode[] | undefined {
    const expr = node.property!.expr;
    const jipExpr = this.findJipKeyword(expr);
    if (!jipExpr) return undefined;

    const { keyword, name: itemName, binExpr } = jipExpr;

    if (keyword === 'unique') {
      return this.rewriteUnique(node, binExpr, itemName);
    }
    if (keyword === 'set') {
      return this.rewriteSet(node, binExpr, itemName);
    }
    return undefined;
  }

  private findJipKeyword(expr: ExprNode): { keyword: string; name: string; binExpr: BinaryExprNode } | null {
    if (expr.kind === NodeKind.BinaryExpr) {
      if (expr.op === '==' && expr.left.kind === NodeKind.KeywordExpr
        && (expr.left.name === 'unique' || expr.left.name === 'set')
        && expr.right.kind === NodeKind.Identifier) {
        return { keyword: expr.left.name, name: expr.right.name, binExpr: expr };
      }
      // Check inside && chains
      const left = this.findJipKeyword(expr.left);
      if (left) return left;
      return this.findJipKeyword(expr.right);
    }
    return null;
  }

  private rewriteUnique(node: NipLineNode, binExpr: BinaryExprNode, name: string): undefined {
    const result = resolveUnique(name);
    if (!result) {
      const allNames = getAllUniqueNames().map(n => n.name);
      const suggestion = findClosestMatch(name, new Set(allNames));
      const hint = suggestion ? `. Did you mean '${suggestion}'?` : '';
      this.error(binExpr.right, `Unknown unique item '${name}'${hint}`);
      return;
    }

    // Rewrite [unique] == Name → [name] == classIdName && [quality] == unique
    this.rewriteToClassIdAndQuality(binExpr, result.classIdName, 'unique');

    // Inject discriminator stats if needed
    if (result.discriminator.length > 0) {
      this.injectDiscriminator(node, result.discriminator);
    }
  }

  private rewriteSet(node: NipLineNode, binExpr: BinaryExprNode, name: string): NipLineNode[] | undefined {
    // Check if it's a full set name (expands to multiple lines)
    const pieces = resolveSetName(name);
    if (pieces) {
      return this.expandSetName(node, binExpr, name, pieces);
    }

    // Specific set item
    const result = resolveSetItem(name);
    if (!result) {
      const allItemNames = getAllSetItemNames().map(n => n.name);
      const allSetNames = getAllSetNames().map(n => n.name);
      const allNames = [...allItemNames, ...allSetNames];
      const suggestion = findClosestMatch(name, new Set(allNames));
      const hint = suggestion ? `. Did you mean '${suggestion}'?` : '';
      this.error(binExpr.right, `Unknown set item '${name}'${hint}`);
      return;
    }

    this.rewriteToClassIdAndQuality(binExpr, result.classIdName, 'set');

    if (result.discriminator.length > 0) {
      this.injectDiscriminator(node, result.discriminator);
    }
  }

  private expandSetName(
    node: NipLineNode, binExpr: BinaryExprNode,
    setName: string, pieceKeys: string[],
  ): NipLineNode[] {
    // Rewrite the current line to the first piece
    const firstKey = pieceKeys[0];
    const firstItem = setItems[firstKey];
    const firstResult = resolveSetItem(this.setItemToPascal(firstKey));
    if (firstResult) {
      this.rewriteToClassIdAndQuality(binExpr, firstResult.classIdName, 'set');
      if (firstResult.discriminator.length > 0) {
        this.injectDiscriminator(node, firstResult.discriminator);
      }
    }

    // Create additional lines for remaining pieces
    const extraLines: NipLineNode[] = [];
    for (let i = 1; i < pieceKeys.length; i++) {
      const key = pieceKeys[i];
      const item = setItems[key];
      const pascal = this.setItemToPascal(key);
      const result = resolveSetItem(pascal);
      if (!result) continue;

      const newLine = this.createSetPieceLine(node, result, item);
      extraLines.push(newLine);
    }

    this.info(binExpr, `Expanded set '${setName}' to ${pieceKeys.length} pieces`, 'range');
    return extraLines;
  }

  private setItemToPascal(key: string): string {
    const item = setItems[key];
    if (!item) return key;
    return item.name.replace(/'/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim()
      .split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  }

  private createSetPieceLine(
    template: NipLineNode,
    result: { classIdName: string; classId: number; onlySetForClassId: boolean; discriminator: StatCheck[] },
    item: { name: string; classIdName: string },
  ): NipLineNode {
    const loc = template.property!.loc;

    // Build property: [name] == classIdName && [quality] == set
    const nameExpr: BinaryExprNode = {
      kind: NodeKind.BinaryExpr, op: '==',
      left: { kind: NodeKind.KeywordExpr, name: 'name', loc },
      right: { kind: NodeKind.Identifier, name: result.classIdName, loc },
      loc,
    };
    const qualityExpr: BinaryExprNode = {
      kind: NodeKind.BinaryExpr, op: '==',
      left: { kind: NodeKind.KeywordExpr, name: 'quality', loc },
      right: { kind: NodeKind.Identifier, name: 'set', loc },
      loc,
    };
    const propertyExpr: BinaryExprNode = {
      kind: NodeKind.BinaryExpr, op: '&&',
      left: nameExpr, right: qualityExpr, loc,
    };

    // Build stat section with discriminator
    let statExpr: ExprNode | null = null;
    if (result.discriminator.length > 0) {
      statExpr = this.buildDiscriminatorExpr(result.discriminator, loc);
    }

    // Merge with template's stat section (if any)
    if (template.stats && statExpr) {
      statExpr = { kind: NodeKind.BinaryExpr, op: '&&', left: statExpr, right: template.stats.expr, loc };
    } else if (template.stats) {
      statExpr = template.stats.expr;
    }

    const newLine: NipLineNode = {
      kind: NodeKind.NipLine, loc,
      property: { kind: NodeKind.PropertySection, expr: propertyExpr, loc },
      stats: statExpr ? { kind: NodeKind.StatSection, expr: statExpr, loc } : null,
      meta: template.meta ? { ...template.meta } : null,
      comment: `[set] == ${item.name}`,
      lineNumber: template.lineNumber,
    };
    return newLine;
  }

  /**
   * Rewrite a [unique/set] == Name expression in-place to [name] == classIdName && [quality] == quality.
   * Mutates binExpr to become the && expression.
   */
  private rewriteToClassIdAndQuality(binExpr: BinaryExprNode, classIdName: string, quality: 'unique' | 'set'): void {
    const loc = binExpr.loc;

    // Build [name] == classIdName
    const nameExpr: BinaryExprNode = {
      kind: NodeKind.BinaryExpr, op: '==',
      left: { kind: NodeKind.KeywordExpr, name: 'name', loc },
      right: { kind: NodeKind.Identifier, name: classIdName, loc },
      loc,
    };

    // Build [quality] == unique/set
    const qualityExpr: BinaryExprNode = {
      kind: NodeKind.BinaryExpr, op: '==',
      left: { kind: NodeKind.KeywordExpr, name: 'quality', loc },
      right: { kind: NodeKind.Identifier, name: quality, loc },
      loc,
    };

    // Mutate in-place: binExpr becomes nameExpr && qualityExpr
    (binExpr as any).op = '&&';
    (binExpr as any).left = nameExpr;
    (binExpr as any).right = qualityExpr;
  }

  /**
   * Inject discriminator stat checks into a line's stat section.
   * Merges with existing user stats via &&.
   */
  private injectDiscriminator(node: NipLineNode, checks: StatCheck[]): void {
    const loc = node.property!.loc;
    const discExpr = this.buildDiscriminatorExpr(checks, loc);

    if (node.stats) {
      // Merge: discriminator && user stats
      node.stats.expr = {
        kind: NodeKind.BinaryExpr, op: '&&',
        left: discExpr, right: node.stats.expr, loc,
      };
    } else {
      // Create new stat section
      node.stats = {
        kind: NodeKind.StatSection,
        expr: discExpr,
        loc,
      };
    }
  }

  private buildDiscriminatorExpr(checks: StatCheck[], loc: { pos: number; line: number; col: number }): ExprNode {
    let expr: ExprNode = this.buildSingleCheck(checks[0], loc);
    for (let i = 1; i < checks.length; i++) {
      expr = {
        kind: NodeKind.BinaryExpr, op: '&&',
        left: expr, right: this.buildSingleCheck(checks[i], loc), loc,
      };
    }
    return expr;
  }

  private buildSingleCheck(check: StatCheck, loc: { pos: number; line: number; col: number }): ExprNode {
    return {
      kind: NodeKind.BinaryExpr,
      op: check.op as '==' | '>=',
      left: { kind: NodeKind.KeywordExpr, name: check.statName, loc },
      right: { kind: NodeKind.NumberLiteral, value: check.value, loc },
      loc,
    };
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

function findClosestMatch(input: string, candidates: Set<string>): string | null {
  // TypeScript-style threshold: proportional to name length
  const maxDistance = Math.min(2, Math.floor(input.length * 0.34));

  // Prefer prefix match first
  const prefix = [...candidates].filter(c => c.startsWith(input));
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) {
    return prefix.reduce((a, b) => a.length <= b.length ? a : b);
  }

  // Also try substring match (e.g. "ber" → "berrune")
  const substring = [...candidates].filter(c => c.includes(input) && input.length >= 3);
  if (substring.length === 1) return substring[0];

  // Fall back to Levenshtein distance
  let best: string | null = null;
  let bestDist = maxDistance + 1;
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - input.length) > maxDistance) continue;
    const dist = levenshtein(input, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) d[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = d[j];
      d[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, d[j], d[j - 1]);
      prev = temp;
    }
  }
  return d[n];
}
