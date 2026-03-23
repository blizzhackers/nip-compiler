import { ExprNode, NipFileNode, NodeKind } from '../types.js';

interface FlagGroup {
  flagCondition: string | null;
  rules: { original: GroupedRule; stripped: GroupedRule }[];
}

interface RuleBlock {
  condition: string | null;
  comment: string | null;
  vars: string[];
  body: string[];
}
import { Analyzer } from './analyzer.js';
import { Grouper } from './grouper.js';
import { CodeGen } from './codegen.js';
import { AliasMapSet, BASE_STATS, DispatchPlan, DispatchStrategy, EmitterConfig, GroupedRule } from './types.js';
import { formatJs } from './formatter.js';
import { SourceMapBuilder } from './sourcemap.js';

export class Emitter {
  private analyzer: Analyzer;
  private grouper: Grouper;
  private codegen: CodeGen;
  private comments: boolean;
  private sourceTable: [number, number][] = [];
  private sourceIdMap = new Map<string, number>();
  private fileTable: string[] = [];
  private fileIdMap = new Map<string, number>();
  private currentTierField: 'tierExpr' | 'mercTierExpr' = 'tierExpr';

  constructor(private config: EmitterConfig) {
    this.analyzer = new Analyzer(config.aliases);
    this.grouper = new Grouper(config.aliases);
    this.codegen = new CodeGen(config.aliases);
    this.comments = config.includeSourceComments ?? true;
  }

  private getFileId(filename: string): number {
    let id = this.fileIdMap.get(filename);
    if (id === undefined) {
      id = this.fileTable.length;
      this.fileTable.push(filename);
      this.fileIdMap.set(filename, id);
    }
    return id;
  }

  private getSourceId(source: string): number {
    let id = this.sourceIdMap.get(source);
    if (id === undefined) {
      id = this.sourceTable.length;
      const [file, lineNum] = source.split('#');
      this.sourceTable.push([this.getFileId(file), parseInt(lineNum)]);
      this.sourceIdMap.set(source, id);
    }
    return id;
  }

  emit(files: NipFileNode[]): string {
    this.sourceTable = [];
    this.sourceIdMap.clear();
    this.fileTable = [];
    this.fileIdMap.clear();

    const allLines = files.flatMap(f =>
      f.lines
        .filter(l => l.property || l.stats)
        .map((l, i) => this.analyzer.analyze(l, i, f.filename))
    );

    const plan = this.grouper.group(allLines);
    const lines: string[] = [];

    lines.push('(function(helpers){');
    lines.push('var checkQuantityOwned=helpers.checkQuantityOwned;');
    lines.push('var me=helpers.me;');
    lines.push('var getBaseStat=helpers.getBaseStat;');
    lines.push('');

    // MaxQuantity helper references
    const mqRules = allLines.filter(a => a.maxQuantity !== null);
    if (mqRules.length > 0) {
      lines.push('var _mq=[');
      for (const mq of mqRules) {
        const propJs = mq.line.property
          ? `function(i){return ${this.codegen.emitStandalonePropertyExpr(mq.line.property.expr)};}`
          : 'null';
        const statJs = mq.line.stats
          ? `function(i){return ${this.codegen.emitStatExpr(mq.line.stats.expr)};}`
          : 'null';
        lines.push(`{prop:${propJs},stat:${statJs},max:${mq.maxQuantity}},`);
      }
      lines.push('];');
      lines.push('');
    }

    lines.push(this.emitCheckItem(plan, mqRules.map(m => m.source)));
    lines.push('');
    lines.push(this.emitTierFunction('getTier', 'tierExpr', plan));
    lines.push('');
    lines.push(this.emitTierFunction('getMercTier', 'mercTierExpr', plan));
    lines.push('');
    // File table + source table — emitted after all rules so all IDs are collected
    // _f=["kolton.nip","gold.nip"]; _s=[[fileIdx,line],...]
    const fileLine = 'var _f=[' + this.fileTable.map(f => `"${f}"`).join(',') + '];';
    const srcLine = 'var _s=[' + this.sourceTable.map(([f, l]) => `[${f},${l}]`).join(',') + '];';
    const insertIdx = lines.indexOf('') + 1;
    lines.splice(insertIdx, 0, fileLine, srcLine);

    lines.push('return{checkItem:checkItem,getTier:getTier,getMercTier:getMercTier};');
    lines.push('})');

    const raw = lines.join('\n');
    return this.config.prettyPrint ? formatJs(raw) : raw;
  }

  emitWithSourceMap(files: NipFileNode[], outputFilename = 'checkItem.js'): { code: string; map: string } {
    const code = this.emit(files);
    const smb = new SourceMapBuilder();

    // Register all source files and their content
    const sourceContents = new Map<string, string>();
    for (const file of files) {
      // Reconstruct content from lines (we don't store raw source, but line numbers are enough)
      sourceContents.set(file.filename, '');
    }

    // Scan emitted code for source comments: // filename#line
    const codeLines = code.split('\n');
    const commentPattern = /\/\/\s*(\S+?)#(\d+)/;
    for (let i = 0; i < codeLines.length; i++) {
      const match = commentPattern.exec(codeLines[i]);
      if (match) {
        const [, sourceFile, sourceLine] = match;
        // Map this generated line (1-based) to the source file and line
        smb.addMapping(i + 1, 0, sourceFile, parseInt(sourceLine) - 1);
      }
    }

    const map = smb.toString(outputFilename);
    const codeWithRef = code + `\n//# sourceMappingURL=${outputFilename}.map\n`;

    return { code: codeWithRef, map };
  }

  private get useObjectLookup(): boolean {
    return this.config.dispatchStrategy === DispatchStrategy.ObjectLookup;
  }

  private emitCheckItem(plan: DispatchPlan, mqSources: string[]): string {
    const lines: string[] = [];

    if (this.useObjectLookup) {
      // Emit handler functions and lookup tables before checkItem
      this.emitLookupTables(lines, plan, mqSources);
    }

    // Inner function: returns positive sourceId+1 for match, negative -(sourceId+1) for maybe, 0 for no match
    lines.push('function _ci(i,_id){');
    lines.push('var _r=0,_c=i.classid|0,_q=i.quality|0,_t=i.itemType|0;');

    if (this.useObjectLookup) {
      this.emitLookupDispatch(lines, plan);
    } else {
      this.emitSwitchDispatch(lines, plan, mqSources);
    }

    if (plan.catchAll.length > 0) {
      for (const rule of plan.catchAll) {
        this.emitCheckRule(lines, rule, mqSources, false);
      }
    }

    lines.push('return _r;');
    lines.push('}');

    // Public wrapper: maps raw IDs to 0/1/-1 API, handles verbose
    lines.push('function checkItem(i,verbose){');
    lines.push('var r=_ci(i,i.getFlag(16));');
    lines.push('if(!verbose)return r>0?1:r<0?-1:0;');
    lines.push('var id=(r>0?r:-r)-1;var e=id>=0?_s[id]:null;');
    lines.push('return{result:r>0?1:r<0?-1:0,file:e?_f[e[0]]:null,line:e?e[1]:0};');
    lines.push('}');
    return lines.join('\n');
  }

  private emitSwitchDispatch(lines: string[], plan: DispatchPlan, mqSources: string[]): void {
    this.emitMergedSwitch(lines, plan.classidGroups, '_c', mqSources);
    this.emitMergedSwitch(lines, plan.typeGroups, '_t', mqSources);
  }

  private emitMergedSwitch(
    lines: string[],
    groups: Map<number, Map<number | null, GroupedRule[]>>,
    switchExpr: string,
    mqSources: string[],
  ): void {
    if (groups.size === 0) return;

    // Emit each case body into a temp buffer, group cases with identical bodies
    const caseEntries: { key: number; body: string[] }[] = [];
    for (const [key, qualityMap] of groups) {
      const body: string[] = [];
      this.emitQualityDispatch(body, qualityMap, mqSources, false);
      caseEntries.push({ key, body });
    }

    // Group by body content (ignoring source IDs for dedup)
    const bodyGroups: { keys: number[]; body: string[] }[] = [];
    const bodyMap = new Map<string, number>();
    for (const entry of caseEntries) {
      const normalized = entry.body.join('\n').replace(/return \d+/g, 'return 0').replace(/_r=-\d+/g, '_r=0');
      const existing = bodyMap.get(normalized);
      if (existing !== undefined) {
        bodyGroups[existing].keys.push(entry.key);
      } else {
        bodyMap.set(normalized, bodyGroups.length);
        bodyGroups.push({ keys: [entry.key], body: entry.body });
      }
    }

    lines.push(`switch(${switchExpr}){`);
    for (const group of bodyGroups) {
      for (let i = 0; i < group.keys.length - 1; i++) {
        lines.push(`case ${group.keys[i]}:`);
      }
      lines.push(`case ${group.keys[group.keys.length - 1]}:{`);
      lines.push(...group.body);
      this.emitCaseEnd(lines);
    }
    lines.push('}');
  }

  private emitLookupTables(lines: string[], plan: DispatchPlan, mqSources: string[]): void {
    let fnIdx = 0;
    // Handlers return positive sourceId+1 for match, negative for maybe
    const emitTable = (groups: Map<number, Map<number | null, GroupedRule[]>>, tableName: string): void => {
      if (groups.size === 0) return;
      lines.push(`var ${tableName}={};`);
      for (const [key, qualityMap] of groups) {
        const fnName = `_f${fnIdx++}`;
        lines.push(`function ${fnName}(i,_id){`);
        lines.push('var _r=0,_q=i.quality|0;');
        this.emitQualityDispatch(lines, qualityMap, mqSources, false);
        lines.push('return _r;');
        lines.push('}');
        lines.push(`${tableName}[${key}]=${fnName};`);
      }
    };

    emitTable(plan.classidGroups, '_cc');
    emitTable(plan.typeGroups, '_tt');
  }

  private emitLookupDispatch(lines: string[], plan: DispatchPlan): void {
    const emitLookup = (tableName: string, keyExpr: string): void => {
      lines.push(`var _fn=${tableName}[${keyExpr}];`);
      lines.push('if(_fn){');
      lines.push('var _hr=_fn(i,_id);');
      lines.push('if(_hr>0)return _hr;');
      lines.push('if(_hr<0)_r=_hr;');
      lines.push('}');
    };

    if (plan.classidGroups.size > 0) emitLookup('_cc', 'i.classid');
    if (plan.typeGroups.size > 0) emitLookup('_tt', 'i.itemType');
  }

  private emitQualityDispatch(
    lines: string[],
    qualityMap: Map<number | null, GroupedRule[]>,
    mqSources: string[],
    isTier: boolean,
  ): void {
    const fixedQualities = [...qualityMap.entries()].filter(([q]) => q !== null);
    const anyQuality = qualityMap.get(null);

    if (fixedQualities.length > 0) {
      lines.push('switch(_q){');
      for (const [quality, rules] of fixedQualities) {
        lines.push(`case ${quality}:{`);
        this.emitHoistedGroup(lines, rules, mqSources, isTier);
        this.emitCaseEnd(lines);
      }
      lines.push('}');
    }

    if (anyQuality && anyQuality.length > 0) {
      this.emitHoistedGroup(lines, anyQuality, mqSources, isTier);
    }
  }

  private emitHoistedGroup(
    lines: string[],
    rules: GroupedRule[],
    mqSources: string[],
    isTier: boolean,
  ): void {
    // Collect stat frequencies for hoisting
    const statFreq = new Map<string, number>();
    for (const rule of rules) {
      if (rule.statExpr) {
        const stats = this.codegen.collectStatIds(rule.statExpr);
        for (const [name] of stats) {
          statFreq.set(name, (statFreq.get(name) ?? 0) + 1);
        }
      }
    }

    // Build hoisted var map (declarations emitted later, after unid bail)
    const hoisted = new Map<number | string, string>();
    const hoistedDecls: string[] = [];
    let varIdx = 0;
    for (const [name, count] of statFreq) {
      if (count >= 2) {
        const stat = this.config.aliases.stat[name];
        if (stat === undefined) continue;
        const key = Array.isArray(stat) ? `${stat[0]}_${stat[1]}` : stat;
        if (hoisted.has(key)) continue;
        const varName = `_h${varIdx++}`;
        hoisted.set(key, varName);
        hoistedDecls.push(Array.isArray(stat)
          ? `var ${varName}=i.getStatEx(${stat[0]},${stat[1]})|0;`
          : `var ${varName}=i.getStatEx(${stat})|0;`);
      }
    }

    // Sort: property-only first, then group by flag condition for better dedup
    const sorted = [...rules].sort((a, b) => {
      const aHasStats = a.statExpr !== null ? 1 : 0;
      const bHasStats = b.statExpr !== null ? 1 : 0;
      if (aHasStats !== bHasStats) return aHasStats - bHasStats;
      // Secondary: group by flag condition so consecutive rules share the same flag check
      const aFlag = this.getFlagKey(a.residualProperty);
      const bFlag = this.getFlagKey(b.residualProperty);
      if (aFlag < bFlag) return -1;
      if (aFlag > bFlag) return 1;
      return 0;
    });

    // Dead code elimination: if a rule has no residual property AND no stats,
    // it's an unconditional match — everything after it is unreachable
    const alive: GroupedRule[] = [];
    for (const rule of sorted) {
      alive.push(rule);
      if (!rule.residualProperty && !rule.statExpr && !isTier) break;
    }

    // Group consecutive rules by shared flag residual to avoid repeated getFlag calls
    const groups = this.groupBySharedCondition(alive);

    if (isTier) {
      // Tier functions: no unid optimization, emit hoisted vars + all rules
      for (const decl of hoistedDecls) lines.push(decl);
      let pendingTierBlocks: RuleBlock[] = [];
      for (const group of groups) {
        const blocks: RuleBlock[] = [];
        for (const rule of group.rules) {
          const effective = group.flagCondition ? rule.stripped : rule.original;
          const block = this.emitTierRuleBlock(effective, this.currentTierField, hoisted);
          if (block) blocks.push(block);
        }
        if (group.flagCondition) {
          lines.push(...this.chainBlocks(pendingTierBlocks));
          pendingTierBlocks = [];
          lines.push(`if(${group.flagCondition}){`);
          lines.push(...this.chainBlocks(blocks));
          lines.push('}');
        } else {
          pendingTierBlocks.push(...blocks);
        }
      }
      lines.push(...this.chainBlocks(pendingTierBlocks));
      return;
    }

    // Split all rules across all groups into base-stat vs magical-only
    const baseGroups: FlagGroup[] = [];
    const magicalGroups: FlagGroup[] = [];
    let firstMagicalSource: string | null = null;

    for (const group of groups) {
      const baseRules: typeof group.rules = [];
      const magicalRules: typeof group.rules = [];

      for (const rule of group.rules) {
        const effective = group.flagCondition ? rule.stripped : rule.original;
        if (effective.statExpr && this.usesMagicalStatsOnly(effective.statExpr)) {
          magicalRules.push(rule);
          if (!firstMagicalSource) firstMagicalSource = effective.source;
        } else {
          baseRules.push(rule);
        }
      }

      if (baseRules.length > 0) baseGroups.push({ ...group, rules: baseRules });
      if (magicalRules.length > 0) magicalGroups.push({ ...group, rules: magicalRules });
    }

    // Hoisted vars first (shared across base + magical rules)
    for (const decl of hoistedDecls) lines.push(decl);

    // 1. Base-stat rules (always run — defense, damage visible on unid)
    let pendingBaseBlocks: RuleBlock[] = [];
    for (const group of baseGroups) {
      const blocks: RuleBlock[] = [];
      for (const rule of group.rules) {
        const effective = group.flagCondition ? rule.stripped : rule.original;
        blocks.push(this.emitCheckRuleBlock(effective, mqSources, hoisted));
      }
      if (group.flagCondition) {
        lines.push(...this.chainBlocks(pendingBaseBlocks));
        pendingBaseBlocks = [];
        lines.push(`if(${group.flagCondition}){`);
        lines.push(...this.chainBlocks(blocks));
        lines.push('}');
      } else {
        pendingBaseBlocks.push(...blocks);
      }
    }
    lines.push(...this.chainBlocks(pendingBaseBlocks));

    if (magicalGroups.length > 0 && firstMagicalSource) {
      // 2. Unid → return maybe immediately, skip all magical comparisons
      const maybeId = this.getSourceId(firstMagicalSource);
      lines.push(`if(!_id)return ${-(maybeId + 1)};`);

      // 3. Magical rules (only reached when identified — strip redundant _id checks)
      let pendingMagicalBlocks: RuleBlock[] = [];
      for (const group of magicalGroups) {
        const blocks: RuleBlock[] = [];
        for (const rule of group.rules) {
          const effective = group.flagCondition ? rule.stripped : rule.original;
          const stripped = this.stripIdentifiedCheck(effective);
          blocks.push(this.emitCheckRuleBlock(stripped, mqSources, hoisted));
        }
        if (group.flagCondition) {
          lines.push(...this.chainBlocks(pendingMagicalBlocks));
          pendingMagicalBlocks = [];
          lines.push(`if(${group.flagCondition}){`);
          lines.push(...this.chainBlocks(blocks));
          lines.push('}');
        } else {
          pendingMagicalBlocks.push(...blocks);
        }
      }
      lines.push(...this.chainBlocks(pendingMagicalBlocks));
    }
  }

  private groupBySharedCondition(rules: GroupedRule[]): FlagGroup[] {
    const groups: FlagGroup[] = [];
    let current: FlagGroup | null = null;

    for (const rule of rules) {
      const extracted = this.extractGroupableCondition(rule.residualProperty);

      if (extracted) {
        const condJs = this.codegen.emitPropertyExpr(extracted.condition);
        if (current && current.flagCondition === condJs) {
          current.rules.push({ original: rule, stripped: { ...rule, residualProperty: extracted.rest } });
        } else {
          current = { flagCondition: condJs, rules: [{ original: rule, stripped: { ...rule, residualProperty: extracted.rest } }] };
          groups.push(current);
        }
      } else {
        current = null;
        groups.push({ flagCondition: null, rules: [{ original: rule, stripped: rule }] });
      }
    }

    // Only wrap in if-block when 2+ rules share the same condition
    return groups.map(g => {
      if (g.flagCondition && g.rules.length < 2) {
        return { flagCondition: null, rules: [{ original: g.rules[0].original, stripped: g.rules[0].original }] };
      }
      return g;
    });
  }

  private extractGroupableCondition(expr: ExprNode | null): { condition: ExprNode; rest: ExprNode | null } | null {
    if (!expr) return null;

    // Standalone property condition (e.g., _q<=3 as the entire residual)
    if (this.isPropertyOnlyExpr(expr)) {
      return { condition: expr, rest: null };
    }

    if (expr.kind !== NodeKind.BinaryExpr || expr.op !== '&&') return null;

    const leftProp = this.isPropertyOnlyExpr(expr.left);
    const rightProp = this.isPropertyOnlyExpr(expr.right);

    if (leftProp && rightProp) {
      // Both sides are property-only — prefer non-callable (quality, level)
      // over callable (flag, prefix, suffix) for better grouping
      const leftCallable = this.isCallablePropertyExpr(expr.left);
      const rightCallable = this.isCallablePropertyExpr(expr.right);
      if (!leftCallable && rightCallable) return { condition: expr.left, rest: expr.right };
      if (leftCallable && !rightCallable) return { condition: expr.right, rest: expr.left };
    }

    if (leftProp) return { condition: expr.left, rest: expr.right };
    if (rightProp) return { condition: expr.right, rest: expr.left };
    return null;
  }

  private isCallablePropertyExpr(expr: ExprNode): boolean {
    if (expr.kind === NodeKind.KeywordExpr)
      return expr.name === 'flag' || expr.name === 'prefix' || expr.name === 'suffix';
    if (expr.kind === NodeKind.BinaryExpr)
      return this.isCallablePropertyExpr(expr.left);
    if (expr.kind === NodeKind.UnaryExpr)
      return this.isCallablePropertyExpr(expr.operand);
    return false;
  }

  private isPropertyOnlyExpr(expr: ExprNode): boolean {
    switch (expr.kind) {
      case NodeKind.KeywordExpr:
        return expr.name in { flag: 1, quality: 1, class: 1, level: 1, classid: 1, name: 1, type: 1, color: 1 };
      case NodeKind.BinaryExpr:
        if (expr.op === '==' || expr.op === '!=' || expr.op === '<=' || expr.op === '>=' || expr.op === '<' || expr.op === '>') {
          return this.isPropertyOnlyExpr(expr.left) || expr.right.kind === NodeKind.NumberLiteral || expr.right.kind === NodeKind.Identifier;
        }
        return false;
      case NodeKind.UnaryExpr:
        return this.isPropertyOnlyExpr(expr.operand);
      default:
        return false;
    }
  }

  private reorderBySelectivity(expr: ExprNode): ExprNode {
    if (expr.kind !== NodeKind.BinaryExpr) return expr;

    // Recurse into sub-expressions first
    if (expr.op === '&&' || expr.op === '||') {
      const reorderedLeft = this.reorderBySelectivity(expr.left);
      const reorderedRight = this.reorderBySelectivity(expr.right);
      expr = { ...expr, left: reorderedLeft, right: reorderedRight };
    }

    if (expr.op === '&&') {
      // AND: put most selective (likely to fail) first
      const conjuncts = this.flattenAnd(expr);
      const reordered = conjuncts.sort((a, b) => this.selectivityScore(a) - this.selectivityScore(b));
      return this.rebuildChain(reordered, '&&');
    }

    if (expr.op === '||') {
      // OR: put cheapest (fewest nodes) first — short-circuits faster
      const disjuncts = this.flattenOr(expr);
      const reordered = disjuncts.sort((a, b) => this.exprCost(a) - this.exprCost(b));
      return this.rebuildChain(reordered, '||');
    }

    return expr;
  }

  private rebuildChain(exprs: ExprNode[], op: '&&' | '||'): ExprNode {
    let result = exprs[0];
    for (let i = 1; i < exprs.length; i++) {
      result = { kind: NodeKind.BinaryExpr as const, op, left: result, right: exprs[i], loc: result.loc };
    }
    return result;
  }

  private selectivityScore(expr: ExprNode): number {
    if (expr.kind === NodeKind.BinaryExpr) {
      if (expr.op === '==') return 0;
      if (expr.op === '!=') return 1;
      if (expr.op === '>=' || expr.op === '<=') return 2;
      if (expr.op === '>' || expr.op === '<') return 2;
      if (expr.op === '&&') return Math.min(this.selectivityScore(expr.left), this.selectivityScore(expr.right));
      if (expr.op === '||') return 3;
    }
    return 4;
  }

  private exprCost(expr: ExprNode): number {
    // Count nodes — cheaper expressions have fewer nodes
    if (expr.kind === NodeKind.NumberLiteral || expr.kind === NodeKind.Identifier || expr.kind === NodeKind.KeywordExpr) return 1;
    if (expr.kind === NodeKind.UnaryExpr) return 1 + this.exprCost(expr.operand);
    if (expr.kind === NodeKind.BinaryExpr) return 1 + this.exprCost(expr.left) + this.exprCost(expr.right);
    return 1;
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

  private usesMagicalStatsOnly(expr: ExprNode | null): boolean {
    if (!expr) return false;
    const statIds = new Set<number>();
    this.collectStatNumbers(expr, statIds);
    if (statIds.size === 0) return false;
    for (const id of statIds) {
      if (BASE_STATS.has(id)) return false;
    }
    return true;
  }

  private collectStatNumbers(expr: ExprNode, ids: Set<number>): void {
    if (expr.kind === NodeKind.KeywordExpr) {
      const stat = this.config.aliases.stat[expr.name];
      if (stat !== undefined) {
        ids.add(Array.isArray(stat) ? stat[0] : stat);
      } else {
        const num = Number(expr.name);
        if (!isNaN(num)) ids.add(num);
        else if (expr.name.includes(',')) ids.add(Number(expr.name.split(',')[0]));
      }
    } else if (expr.kind === NodeKind.BinaryExpr) {
      this.collectStatNumbers(expr.left, ids);
      this.collectStatNumbers(expr.right, ids);
    } else if (expr.kind === NodeKind.UnaryExpr) {
      this.collectStatNumbers(expr.operand, ids);
    }
  }

  private countStatFreq(expr: ExprNode, freq: Map<string, number>): void {
    if (expr.kind === NodeKind.KeywordExpr) {
      freq.set(expr.name, (freq.get(expr.name) ?? 0) + 1);
    } else if (expr.kind === NodeKind.BinaryExpr) {
      this.countStatFreq(expr.left, freq);
      this.countStatFreq(expr.right, freq);
    } else if (expr.kind === NodeKind.UnaryExpr) {
      this.countStatFreq(expr.operand, freq);
    }
  }

  private stripIdentifiedCheck(rule: GroupedRule): GroupedRule {
    if (!rule.residualProperty) return rule;
    const stripped = this.removeIdentifiedExpr(rule.residualProperty);
    return { ...rule, residualProperty: stripped };
  }

  private removeIdentifiedExpr(expr: ExprNode): ExprNode | null {
    if (expr.kind === NodeKind.BinaryExpr) {
      if (expr.op === '==' && expr.left.kind === NodeKind.KeywordExpr
        && expr.left.name === 'flag' && expr.right.kind === NodeKind.Identifier
        && expr.right.name === 'identified') return null;
      if (expr.op === '&&') {
        const left = this.removeIdentifiedExpr(expr.left);
        const right = this.removeIdentifiedExpr(expr.right);
        if (left === null && right === null) return null;
        if (left === null) return right;
        if (right === null) return left;
        return { ...expr, left, right };
      }
    }
    return expr;
  }

  private residualRequiresIdentified(expr: ExprNode | null): boolean {
    if (!expr) return false;
    if (expr.kind === NodeKind.BinaryExpr) {
      if (expr.op === '==' && expr.left.kind === NodeKind.KeywordExpr
        && expr.left.name === 'flag' && expr.right.kind === NodeKind.Identifier
        && expr.right.name === 'identified') return true;
      if (expr.op === '&&') {
        return this.residualRequiresIdentified(expr.left) || this.residualRequiresIdentified(expr.right);
      }
    }
    return false;
  }

  private getFlagKey(expr: ExprNode | null): string {
    if (!expr) return '';
    const flag = this.extractGroupableCondition(expr);
    if (!flag) return '';
    return this.codegen.emitPropertyExpr(flag.condition);
  }

  private emitCaseEnd(lines: string[]): void {
    const last = lines[lines.length - 1];
    lines.push(last.includes('return ') ? '}' : 'break;}');
  }

  private emitMatch(source: string): string {
    const id = this.getSourceId(source);
    return `return ${id + 1};`;
  }

  private emitMaybe(source: string): string {
    const id = this.getSourceId(source);
    return `_r=${-(id + 1)};`;
  }

  private emitCheckRule(
    lines: string[],
    rule: GroupedRule,
    mqSources: string[],
    skipMaybe: boolean,
    hoisted?: Map<number | string, string>,
  ): void {
    if (this.comments) lines.push(`// ${rule.source}${rule.line.comment ? ' — ' + rule.line.comment : ''}`);

    const conditions: string[] = [];
    if (rule.residualProperty) {
      conditions.push(this.codegen.emitPropertyExpr(rule.residualProperty));
    }

    const hasStats = rule.statExpr !== null;
    const reorderedStat = hasStats ? this.reorderBySelectivity(rule.statExpr!) : null;

    // Per-expression dedup: hoist stats that appear 2+ times within this expression
    const exprHoisted = new Map<number | string, string>(hoisted ?? []);
    if (reorderedStat) {
      const freq = new Map<string, number>();
      this.countStatFreq(reorderedStat, freq);
      for (const [name, count] of freq) {
        if (count < 2) continue;
        const stat = this.config.aliases.stat[name];
        const numStat = stat === undefined ? (name.includes(',') ? name.split(',').map(Number) as [number, number] : Number(name)) : stat;
        if (typeof numStat === 'number' && isNaN(numStat)) continue;
        const key = Array.isArray(numStat) ? `${numStat[0]}_${numStat[1]}` : typeof numStat === 'number' ? numStat : numStat;
        if (exprHoisted.has(key)) continue;
        const varName = `_l${exprHoisted.size}`;
        exprHoisted.set(key, varName);
        if (Array.isArray(numStat)) {
          lines.push(`var ${varName}=i.getStatEx(${numStat[0]},${numStat[1]})|0;`);
        } else {
          lines.push(`var ${varName}=i.getStatEx(${numStat})|0;`);
        }
      }
    }

    const statJs = reorderedStat
      ? this.codegen.emitStatExprWithHoisted(reorderedStat, exprHoisted)
      : null;

    const mqIdx = mqSources.indexOf(rule.source);
    const hasMq = mqIdx !== -1;

    const matchJs = this.emitMatch(rule.source);
    const maybeJs = skipMaybe ? '' : `else if(!_id)${this.emitMaybe(rule.source)}`;

    if (conditions.length > 0 && hasStats) {
      lines.push(`if(${conditions.join('&&')}){`);
      if (hasMq) {
        lines.push(`if(${statJs}){`);
        lines.push(`if(checkQuantityOwned(_mq[${mqIdx}].prop,_mq[${mqIdx}].stat)<${rule.maxQuantity}){`);
        lines.push(matchJs);
        lines.push('}}');
      } else {
        lines.push(`if(${statJs}){${matchJs}}`);
        lines.push(maybeJs);
      }
      lines.push('}');
    } else if (conditions.length > 0) {
      if (hasMq) {
        lines.push(`if(${conditions.join('&&')}){`);
        lines.push(`if(checkQuantityOwned(_mq[${mqIdx}].prop,null)<${rule.maxQuantity}){`);
        lines.push(matchJs);
        lines.push('}}');
      } else {
        lines.push(`if(${conditions.join('&&')}){${matchJs}}`);
      }
    } else if (hasStats) {
      if (hasMq) {
        lines.push(`if(${statJs}){`);
        lines.push(`if(checkQuantityOwned(null,_mq[${mqIdx}].stat)<${rule.maxQuantity}){`);
        lines.push(matchJs);
        lines.push('}}');
      } else {
        lines.push(`if(${statJs}){${matchJs}}`);
        lines.push(maybeJs);
      }
    } else {
      lines.push(matchJs);
    }
  }

  private emitTierFunction(
    name: string,
    field: 'tierExpr' | 'mercTierExpr',
    plan: DispatchPlan,
  ): string {
    const lines: string[] = [];
    this.currentTierField = field;
    lines.push(`function ${name}(i){`);
    lines.push('var tier=-1,t,_c=i.classid|0,_q=i.quality|0,_t=i.itemType|0;');

    const emitGroup = (groups: Map<number, Map<number | null, GroupedRule[]>>, switchExpr: string): void => {
      const filtered = new Map<number, Map<number | null, GroupedRule[]>>();
      for (const [key, qualityMap] of groups) {
        const filteredQuality = new Map<number | null, GroupedRule[]>();
        for (const [q, rules] of qualityMap) {
          const tierRules = rules.filter(r => r[field] !== null);
          if (tierRules.length > 0) filteredQuality.set(q, tierRules);
        }
        if (filteredQuality.size > 0) filtered.set(key, filteredQuality);
      }

      if (filtered.size === 0) return;

      const caseEntries: { key: number; body: string[] }[] = [];
      for (const [key, qualityMap] of filtered) {
        const body: string[] = [];
        this.emitQualityDispatch(body, qualityMap, [], true);
        caseEntries.push({ key, body });
      }

      const bodyGroups: { keys: number[]; body: string[] }[] = [];
      const bodyMap = new Map<string, number>();
      for (const entry of caseEntries) {
        const normalized = entry.body.join('\n').replace(/t=\d+/g, 't=0');
        const existing = bodyMap.get(normalized);
        if (existing !== undefined) {
          bodyGroups[existing].keys.push(entry.key);
        } else {
          bodyMap.set(normalized, bodyGroups.length);
          bodyGroups.push({ keys: [entry.key], body: entry.body });
        }
      }

      lines.push(`switch(${switchExpr}){`);
      for (const group of bodyGroups) {
        for (let i = 0; i < group.keys.length - 1; i++) {
          lines.push(`case ${group.keys[i]}:`);
        }
        lines.push(`case ${group.keys[group.keys.length - 1]}:{`);
        lines.push(...group.body);
        this.emitCaseEnd(lines);
      }
      lines.push('}');
    };

    emitGroup(plan.classidGroups, 'i.classid');
    emitGroup(plan.typeGroups, 'i.itemType');

    const catchAllTier = plan.catchAll.filter(r => r[field] !== null);
    for (const rule of catchAllTier) {
      this.emitTierRule(lines, rule, field);
    }

    lines.push('return tier;');
    lines.push('}');
    return lines.join('\n');
  }

  private emitTierRule(
    lines: string[],
    rule: GroupedRule,
    field: 'tierExpr' | 'mercTierExpr',
    hoisted?: Map<number | string, string>,
  ): void {
    const block = this.emitTierRuleBlock(rule, field, hoisted);
    if (!block) return;
    lines.push(...this.chainBlocks([block]));
  }

  private emitTierRuleBlock(
    rule: GroupedRule,
    field: 'tierExpr' | 'mercTierExpr',
    hoisted?: Map<number | string, string>,
  ): RuleBlock | null {
    const tierExpr = rule[field];
    if (!tierExpr) return null;

    const comment = this.comments
      ? `// ${rule.source}${rule.line.comment ? ' — ' + rule.line.comment : ''}`
      : null;

    const tierJs = this.codegen.emitStatExpr(tierExpr);
    const vars: string[] = [];
    const conditions: string[] = [];

    if (rule.residualProperty) {
      conditions.push(this.codegen.emitPropertyExpr(rule.residualProperty));
    }
    if (rule.statExpr) {
      const reordered = this.reorderBySelectivity(rule.statExpr);
      const exprHoisted = new Map<number | string, string>(hoisted ?? []);
      const freq = new Map<string, number>();
      this.countStatFreq(reordered, freq);
      for (const [name, count] of freq) {
        if (count < 2) continue;
        const stat = this.config.aliases.stat[name];
        const numStat = stat === undefined ? (name.includes(',') ? name.split(',').map(Number) as [number, number] : Number(name)) : stat;
        if (typeof numStat === 'number' && isNaN(numStat)) continue;
        const key = Array.isArray(numStat) ? `${numStat[0]}_${numStat[1]}` : typeof numStat === 'number' ? numStat : numStat;
        if (exprHoisted.has(key)) continue;
        const varName = `_l${exprHoisted.size}`;
        exprHoisted.set(key, varName);
        vars.push(Array.isArray(numStat)
          ? `var ${varName}=i.getStatEx(${numStat[0]},${numStat[1]})|0;`
          : `var ${varName}=i.getStatEx(${numStat})|0;`);
      }
      conditions.push(this.codegen.emitStatExprWithHoisted(reordered, exprHoisted));
    }

    const body = [`t=${tierJs};if(t>tier)tier=t;`];
    const condition = conditions.length > 0 ? conditions.join('&&') : null;
    return { condition, comment, vars, body };
  }

  private emitCheckRuleBlock(
    rule: GroupedRule,
    mqSources: string[],
    hoisted?: Map<number | string, string>,
  ): RuleBlock {
    const comment = this.comments
      ? `// ${rule.source}${rule.line.comment ? ' — ' + rule.line.comment : ''}`
      : null;

    const conditions: string[] = [];
    if (rule.residualProperty) {
      conditions.push(this.codegen.emitPropertyExpr(rule.residualProperty));
    }

    const hasStats = rule.statExpr !== null;
    const reorderedStat = hasStats ? this.reorderBySelectivity(rule.statExpr!) : null;

    const vars: string[] = [];
    const exprHoisted = new Map<number | string, string>(hoisted ?? []);
    if (reorderedStat) {
      const freq = new Map<string, number>();
      this.countStatFreq(reorderedStat, freq);
      for (const [name, count] of freq) {
        if (count < 2) continue;
        const stat = this.config.aliases.stat[name];
        const numStat = stat === undefined ? (name.includes(',') ? name.split(',').map(Number) as [number, number] : Number(name)) : stat;
        if (typeof numStat === 'number' && isNaN(numStat)) continue;
        const key = Array.isArray(numStat) ? `${numStat[0]}_${numStat[1]}` : typeof numStat === 'number' ? numStat : numStat;
        if (exprHoisted.has(key)) continue;
        const varName = `_l${exprHoisted.size}`;
        exprHoisted.set(key, varName);
        vars.push(Array.isArray(numStat)
          ? `var ${varName}=i.getStatEx(${numStat[0]},${numStat[1]})|0;`
          : `var ${varName}=i.getStatEx(${numStat})|0;`);
      }
    }

    const statJs = reorderedStat
      ? this.codegen.emitStatExprWithHoisted(reorderedStat, exprHoisted)
      : null;

    const mqIdx = mqSources.indexOf(rule.source);
    const hasMq = mqIdx !== -1;
    const matchJs = this.emitMatch(rule.source);

    let condition: string | null = null;
    const body: string[] = [];

    if (conditions.length > 0 && hasStats) {
      condition = conditions.join('&&');
      if (hasMq) {
        body.push(`if(${statJs}){`);
        body.push(`if(checkQuantityOwned(_mq[${mqIdx}].prop,_mq[${mqIdx}].stat)<${rule.maxQuantity}){`);
        body.push(matchJs);
        body.push('}}');
      } else {
        body.push(`if(${statJs}){${matchJs}}`);
      }
    } else if (conditions.length > 0) {
      condition = conditions.join('&&');
      if (hasMq) {
        body.push(`if(checkQuantityOwned(_mq[${mqIdx}].prop,null)<${rule.maxQuantity}){`);
        body.push(matchJs);
        body.push('}');
      } else {
        body.push(matchJs);
      }
    } else if (hasStats) {
      condition = statJs;
      if (hasMq) {
        body.push(`if(checkQuantityOwned(null,_mq[${mqIdx}].stat)<${rule.maxQuantity}){`);
        body.push(matchJs);
        body.push('}');
      } else {
        body.push(matchJs);
      }
    } else {
      body.push(matchJs);
    }

    return { condition, comment, vars, body };
  }

  private chainBlocks(blocks: RuleBlock[]): string[] {
    const lines: string[] = [];
    let i = 0;
    while (i < blocks.length) {
      const block = blocks[i];
      if (!block.condition) {
        if (block.comment) lines.push(block.comment);
        lines.push(...block.vars, ...block.body);
        i++;
        continue;
      }

      const allVars = [...block.vars];
      const entries: { comment: string | null; body: string[]; isElse: boolean }[] = [
        { comment: block.comment, body: block.body, isElse: false },
      ];
      const baseCond = block.condition;
      i++;

      while (i < blocks.length && blocks[i].condition) {
        const next = blocks[i];
        if (next.condition === baseCond) {
          allVars.push(...next.vars);
          entries.push({ comment: next.comment, body: next.body, isElse: false });
          i++;
        } else if (this.isComplement(baseCond, next.condition!)) {
          allVars.push(...next.vars);
          entries.push({ comment: next.comment, body: next.body, isElse: true });
          i++;
          break;
        } else {
          break;
        }
      }

      lines.push(...allVars);
      lines.push(`if(${baseCond}){`);
      for (const entry of entries) {
        if (entry.isElse) lines.push('}else{');
        if (entry.comment) lines.push(entry.comment);
        lines.push(...entry.body);
      }
      lines.push('}');
    }
    return lines;
  }

  private isComplement(a: string, b: string): boolean {
    // (!X) ↔ X
    if (a === `(!${b})`) return true;
    if (b === `(!${a})`) return true;

    // (X op1 Y) ↔ (X op2 Y) where ops are complementary
    const parse = (s: string) => {
      if (!s.startsWith('(') || !s.endsWith(')')) return null;
      const inner = s.slice(1, -1);
      for (const op of ['===', '!==', '>=', '<=', '>', '<']) {
        const idx = inner.indexOf(op);
        if (idx > 0) return { left: inner.slice(0, idx), op, right: inner.slice(idx + op.length) };
      }
      return null;
    };

    const ca = parse(a);
    const cb = parse(b);
    if (!ca || !cb || ca.left !== cb.left || ca.right !== cb.right) return false;

    const comp: Record<string, string> = {
      '<': '>=', '>=': '<', '<=': '>', '>': '<=', '===': '!==', '!==': '===',
    };
    return comp[ca.op] === cb.op;
  }
}
