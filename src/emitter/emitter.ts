import { ExprNode, NipFileNode, NodeKind } from '../types.js';

interface FlagGroup {
  flagCondition: string | null;
  rules: { original: GroupedRule; stripped: GroupedRule }[];
}
import { Analyzer } from './analyzer.js';
import { Grouper } from './grouper.js';
import { CodeGen } from './codegen.js';
import { AliasMapSet, DispatchPlan, EmitterConfig, GroupedRule } from './types.js';

export class Emitter {
  private analyzer: Analyzer;
  private grouper: Grouper;
  private codegen: CodeGen;
  private comments: boolean;
  private sourceTable: string[] = [];
  private sourceIdMap = new Map<string, number>();

  constructor(private config: EmitterConfig) {
    this.analyzer = new Analyzer(config.aliases);
    this.grouper = new Grouper(config.aliases);
    this.codegen = new CodeGen(config.aliases);
    this.comments = config.includeSourceComments ?? true;
  }

  private getSourceId(source: string): number {
    let id = this.sourceIdMap.get(source);
    if (id === undefined) {
      id = this.sourceTable.length;
      const [file, lineNum] = source.split('#');
      this.sourceTable.push(`"${file}",${lineNum}`);
      this.sourceIdMap.set(source, id);
    }
    return id;
  }

  emit(files: NipFileNode[]): string {
    this.sourceTable = [];
    this.sourceIdMap.clear();

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
          ? `function(item){return ${this.codegen.emitPropertyExpr(mq.line.property.expr)};}`
          : 'null';
        const statJs = mq.line.stats
          ? `function(item){return ${this.codegen.emitStatExpr(mq.line.stats.expr)};}`
          : 'null';
        lines.push(`{prop:${propJs},stat:${statJs},max:${mq.maxQuantity}},`);
      }
      lines.push('];');
      lines.push('');
    }

    lines.push(this.emitCheckItem(plan, mqRules.map(m => m.source)));
    lines.push('');
    lines.push(this.emitTierFunction('getTier', 'tier', plan));
    lines.push('');
    lines.push(this.emitTierFunction('getMercTier', 'mercTier', plan));
    lines.push('');
    // Source table — emitted after all rules so all IDs are collected
    // _s[id] = [file, line]
    const srcLine = 'var _s=[' + this.sourceTable.map(s => `[${s}]`).join(',') + '];';
    // Insert after the helpers, before checkItem
    const insertIdx = lines.indexOf('') + 1;
    lines.splice(insertIdx, 0, srcLine);

    lines.push('return{checkItem:checkItem,getTier:getTier,getMercTier:getMercTier};');
    lines.push('})');

    return lines.join('\n');
  }

  private emitCheckItem(plan: DispatchPlan, mqSources: string[]): string {
    const lines: string[] = [];
    lines.push('function checkItem(item,verbose){');
    lines.push('var identified=item.getFlag(16);');
    lines.push('var result=0,_si=-1;');

    if (plan.classidGroups.size > 0) {
      lines.push('switch(item.classid){');
      for (const [classid, qualityMap] of plan.classidGroups) {
        lines.push(`case ${classid}:{`);
        this.emitQualityDispatch(lines, qualityMap, mqSources, false);
        lines.push('break;}');
      }
      lines.push('}');
    }

    if (plan.typeGroups.size > 0) {
      lines.push('switch(item.itemType){');
      for (const [type, qualityMap] of plan.typeGroups) {
        lines.push(`case ${type}:{`);
        this.emitQualityDispatch(lines, qualityMap, mqSources, false);
        lines.push('break;}');
      }
      lines.push('}');
    }

    if (plan.catchAll.length > 0) {
      for (const rule of plan.catchAll) {
        this.emitCheckRule(lines, rule, mqSources, false);
      }
    }

    lines.push('if(verbose)return{result:result,file:_si>=0?_s[_si][0]:null,line:_si>=0?_s[_si][1]:0};');
    lines.push('return result;');
    lines.push('}');
    return lines.join('\n');
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
      lines.push('switch(item.quality){');
      for (const [quality, rules] of fixedQualities) {
        lines.push(`case ${quality}:{`);
        this.emitHoistedGroup(lines, rules, mqSources, isTier);
        lines.push('break;}');
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

    // Hoist stats that appear 2+ times
    const hoisted = new Map<number | string, string>();
    let varIdx = 0;
    for (const [name, count] of statFreq) {
      if (count >= 2) {
        const stat = this.config.aliases.stat[name];
        if (stat === undefined) continue;
        const key = Array.isArray(stat) ? `${stat[0]}_${stat[1]}` : stat;
        if (hoisted.has(key)) continue;
        const varName = `_h${varIdx++}`;
        hoisted.set(key, varName);
        if (Array.isArray(stat)) {
          lines.push(`var ${varName}=item.getStatEx(${stat[0]},${stat[1]});`);
        } else {
          lines.push(`var ${varName}=item.getStatEx(${stat});`);
        }
      }
    }

    // Sort: property-only rules first (no stat checks = cheaper), then stat rules
    const sorted = [...rules].sort((a, b) => {
      const aHasStats = a.statExpr !== null ? 1 : 0;
      const bHasStats = b.statExpr !== null ? 1 : 0;
      return aHasStats - bHasStats;
    });

    // Dead code elimination: if a rule has no residual property AND no stats,
    // it's an unconditional match — everything after it is unreachable
    const alive: GroupedRule[] = [];
    for (const rule of sorted) {
      alive.push(rule);
      if (!rule.residualProperty && !rule.statExpr && !isTier) break;
    }

    // Group consecutive rules by shared flag residual to avoid repeated getFlag calls
    const groups = this.groupByFlagResidual(alive);

    for (const group of groups) {
      if (group.flagCondition) {
        lines.push(`if(${group.flagCondition}){`);
        for (const rule of group.rules) {
          if (isTier) this.emitTierRule(lines, rule.stripped, hoisted);
          else this.emitCheckRule(lines, rule.stripped, mqSources, false, hoisted);
        }
        lines.push('}');
      } else {
        for (const rule of group.rules) {
          if (isTier) this.emitTierRule(lines, rule.original, hoisted);
          else this.emitCheckRule(lines, rule.original, mqSources, false, hoisted);
        }
      }
    }
  }

  private groupByFlagResidual(rules: GroupedRule[]): FlagGroup[] {
    const groups: FlagGroup[] = [];
    let current: FlagGroup | null = null;

    for (const rule of rules) {
      const flagExpr = this.extractFlagCondition(rule.residualProperty);

      if (flagExpr) {
        const flagJs = this.codegen.emitPropertyExpr(flagExpr.condition);
        if (current && current.flagCondition === flagJs) {
          current.rules.push({ original: rule, stripped: { ...rule, residualProperty: flagExpr.rest } });
        } else {
          current = { flagCondition: flagJs, rules: [{ original: rule, stripped: { ...rule, residualProperty: flagExpr.rest } }] };
          groups.push(current);
        }
      } else {
        current = null;
        groups.push({ flagCondition: null, rules: [{ original: rule, stripped: rule }] });
      }
    }

    // Only wrap in if-block when 2+ rules share the same flag
    return groups.map(g => {
      if (g.flagCondition && g.rules.length < 2) {
        return { flagCondition: null, rules: [{ original: g.rules[0].original, stripped: g.rules[0].original }] };
      }
      return g;
    });
  }

  private extractFlagCondition(expr: ExprNode | null): { condition: ExprNode; rest: ExprNode | null } | null {
    if (!expr) return null;
    if (expr.kind !== NodeKind.BinaryExpr || expr.op !== '&&') return null;

    // Check if left side is a flag check
    if (this.isFlagExpr(expr.left)) {
      return { condition: expr.left, rest: expr.right };
    }
    // Check if right side is a flag check
    if (this.isFlagExpr(expr.right)) {
      return { condition: expr.right, rest: expr.left };
    }
    return null;
  }

  private isFlagExpr(expr: ExprNode): boolean {
    if (expr.kind === NodeKind.BinaryExpr && (expr.op === '==' || expr.op === '!=')) {
      if (expr.left.kind === NodeKind.KeywordExpr && expr.left.name === 'flag') return true;
    }
    if (expr.kind === NodeKind.UnaryExpr) {
      return this.isFlagExpr(expr.operand);
    }
    return false;
  }

  private reorderBySelectivity(expr: ExprNode): ExprNode {
    if (expr.kind !== NodeKind.BinaryExpr || expr.op !== '&&') return expr;

    const conjuncts = this.flattenAnd(expr);
    const reordered = conjuncts.sort((a, b) => this.selectivityScore(a) - this.selectivityScore(b));

    return reordered.reduce((left, right) => ({
      kind: NodeKind.BinaryExpr as const,
      op: '&&' as const,
      left,
      right,
      loc: left.loc,
    }));
  }

  private selectivityScore(expr: ExprNode): number {
    // Lower = more selective = should be checked first
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

  private flattenAnd(expr: ExprNode): ExprNode[] {
    if (expr.kind === NodeKind.BinaryExpr && expr.op === '&&') {
      return [...this.flattenAnd(expr.left), ...this.flattenAnd(expr.right)];
    }
    return [expr];
  }

  private emitMatch(source: string): string {
    const id = this.getSourceId(source);
    return `if(verbose)return{result:1,file:_s[${id}][0],line:_s[${id}][1]};return 1;`;
  }

  private emitMaybe(source: string): string {
    const id = this.getSourceId(source);
    return `result=-1;_si=${id};`;
  }

  private emitCheckRule(
    lines: string[],
    rule: GroupedRule,
    mqSources: string[],
    _isTier: boolean,
    hoisted?: Map<number | string, string>,
  ): void {
    if (this.comments) lines.push(`// ${rule.source}`);

    const conditions: string[] = [];
    if (rule.residualProperty) {
      conditions.push(this.codegen.emitPropertyExpr(rule.residualProperty));
    }

    const hasStats = rule.statExpr !== null;
    const reorderedStat = hasStats ? this.reorderBySelectivity(rule.statExpr!) : null;
    const statJs = reorderedStat
      ? (hoisted
        ? this.codegen.emitStatExprWithHoisted(reorderedStat, hoisted)
        : this.codegen.emitStatExpr(reorderedStat))
      : null;

    const mqIdx = mqSources.indexOf(rule.source);
    const hasMq = mqIdx !== -1;

    const matchJs = this.emitMatch(rule.source);
    const maybeJs = `else if(!identified&&result===0){${this.emitMaybe(rule.source)}}`;

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
    field: 'tier' | 'mercTier',
    plan: DispatchPlan,
  ): string {
    const lines: string[] = [];
    lines.push(`function ${name}(item){`);
    lines.push('var tier=-1,t;');

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

      lines.push(`switch(${switchExpr}){`);
      for (const [key, qualityMap] of filtered) {
        lines.push(`case ${key}:{`);
        this.emitQualityDispatch(lines, qualityMap, [], true);
        lines.push('break;}');
      }
      lines.push('}');
    };

    emitGroup(plan.classidGroups, 'item.classid');
    emitGroup(plan.typeGroups, 'item.itemType');

    const catchAllTier = plan.catchAll.filter(r => r[field] !== null);
    for (const rule of catchAllTier) {
      this.emitTierRule(lines, rule);
    }

    lines.push('return tier;');
    lines.push('}');
    return lines.join('\n');
  }

  private emitTierRule(
    lines: string[],
    rule: GroupedRule,
    hoisted?: Map<number | string, string>,
  ): void {
    if (this.comments) lines.push(`// ${rule.source}`);

    const tierValue = rule.tier ?? rule.mercTier;
    if (tierValue === null) return;

    const conditions: string[] = [];
    if (rule.residualProperty) {
      conditions.push(this.codegen.emitPropertyExpr(rule.residualProperty));
    }
    if (rule.statExpr) {
      const reordered = this.reorderBySelectivity(rule.statExpr);
      conditions.push(
        hoisted
          ? this.codegen.emitStatExprWithHoisted(reordered, hoisted)
          : this.codegen.emitStatExpr(reordered)
      );
    }

    if (conditions.length > 0) {
      lines.push(`if(${conditions.join('&&')}){t=${tierValue};if(t>tier)tier=t;}`);
    } else {
      lines.push(`t=${tierValue};if(t>tier)tier=t;`);
    }
  }
}
