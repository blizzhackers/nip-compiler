/**
 * ESTree-based emitter. Builds an ESTree Program AST from the DispatchPlan.
 * The AST is then serialized to JS + source map by escodegen.
 */
import type * as ESTree from 'estree';
import { ExprNode, NipFileNode, NodeKind } from '../types.js';
import { Analyzer } from './analyzer.js';
import { Grouper } from './grouper.js';
import { CodeGenAST } from './codegen-ast.js';
import {
  AliasMapSet, BASE_STATS, DispatchPlan, EmitterConfig,
  GroupedRule, OutputFormat,
} from './types.js';
import {
  program, block, fnDecl, fnExpr, varDecl, ifStmt, switchStmt, switchCase,
  returnStmt, exprStmt, breakStmt, withLeadingComment, exportDefault,
  ident, literal, bin, logical, unary, assign, call, member, memberComputed,
  cond, array, object, type NipLoc,
} from './js-ast.js';

export class EmitterAST {
  private analyzer: Analyzer;
  private grouper: Grouper;
  private codegen: CodeGenAST;
  private comments: boolean;
  private sourceTable: [number, number][] = [];
  private sourceIdMap = new Map<string, number>();
  private fileTable: string[] = [];
  private fileIdMap = new Map<string, number>();
  private currentTierField: 'tierExpr' | 'mercTierExpr' = 'tierExpr';

  constructor(private config: EmitterConfig) {
    this.analyzer = new Analyzer(config.aliases);
    this.grouper = new Grouper(config.aliases);
    this.codegen = new CodeGenAST(config.aliases);
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

  emitAST(files: NipFileNode[]): ESTree.Program {
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
    const mqRules = allLines.filter(a => a.maxQuantity !== null);

    const body: ESTree.Statement[] = [];

    // Helper declarations
    if (this.config.kolbotCompat) {
      body.push(varDecl('const', [{ id: 'checkQuantityOwned', init: member(ident('NTIP'), 'CheckQuantityOwned') }]));
    } else {
      body.push(varDecl('const', [
        { id: 'checkQuantityOwned', init: member(ident('helpers'), 'checkQuantityOwned') },
      ]));
      body.push(varDecl('const', [{ id: 'me', init: member(ident('helpers'), 'me') }]));
      body.push(varDecl('const', [{ id: 'getBaseStat', init: member(ident('helpers'), 'getBaseStat') }]));
    }

    // _ci function
    body.push(this.buildCiFunction(plan, mqRules.map(m => m.source)));

    // checkItem wrapper
    body.push(this.buildCheckItemFunction());

    // getTier / getMercTier
    body.push(this.buildTierFunction('getTier', 'tierExpr', plan));
    body.push(this.buildTierFunction('getMercTier', 'mercTierExpr', plan));

    // Data tables at the bottom
    body.push(varDecl('const', [{
      id: '_f',
      init: array(this.fileTable.map(f => literal(f))),
    }]));
    body.push(varDecl('const', [{
      id: '_s',
      init: array(this.sourceTable.map(([f, l]) => array([literal(f), literal(l)]))),
    }]));

    // _mq array
    if (mqRules.length > 0) {
      body.push(varDecl('const', [{
        id: '_mq',
        init: array(mqRules.map(mq => {
          const propExpr = mq.line.property
            ? fnExpr(['i'], [returnStmt(this.codegen.emitStandalonePropertyExpr(mq.line.property.expr))])
            : literal(null);
          const statExpr = mq.line.stats
            ? fnExpr(['i'], [returnStmt(this.codegen.emitStatExpr(mq.line.stats.expr))])
            : literal(null);
          return object([
            { key: 'prop', value: propExpr },
            { key: 'stat', value: statExpr },
            { key: 'max', value: literal(mq.maxQuantity!) },
          ]);
        })),
      }]));
    }

    // Exports
    const exportObj = object([
      { key: 'checkItem', value: ident('checkItem') },
      { key: 'getTier', value: ident('getTier') },
      { key: 'getMercTier', value: ident('getMercTier') },
    ]);

    if (this.config.kolbotCompat) {
      body.push(varDecl('const', [{ id: '_mod', init: exportObj }]));
      body.push(exprStmt(call(member(ident('NTIP'), 'addCompiled'), [ident('_mod')])));
      body.push(exprStmt(assign(member(ident('module'), 'exports'), ident('_mod'))));
    } else {
      body.push(returnStmt(exportObj));
    }

    // Wrap in appropriate format
    return this.wrapProgram(body);
  }

  private wrapProgram(body: ESTree.Statement[]): ESTree.Program {
    const format = this.config.outputFormat ?? OutputFormat.IIFE;

    if (this.config.kolbotCompat) {
      const wrapper = fnExpr(['module', 'NTIP', 'me', 'getBaseStat'], body);
      const iife = call(wrapper, [ident('module'), ident('NTIP'), ident('me'), ident('getBaseStat')]);
      return program([exprStmt(iife)]);
    }

    switch (format) {
      case OutputFormat.CJS: {
        const fn = fnExpr(['helpers'], body);
        return program([exprStmt(assign(member(ident('module'), 'exports'), fn))]);
      }
      case OutputFormat.ESM: {
        const fn = fnDecl('default', ['helpers'], body);
        // @ts-ignore - fnDecl returns FunctionDeclaration, exportDefault expects it
        return program([exportDefault(fn)]);
      }
      default: {
        const fn = fnExpr(['helpers'], body);
        return program([exprStmt(fn)]);
      }
    }
  }

  private buildCiFunction(plan: DispatchPlan, mqSources: string[]): ESTree.FunctionDeclaration {
    const body: ESTree.Statement[] = [];

    body.push(varDecl('let', [{ id: '_r', init: literal(0) }]));
    body.push(varDecl('const', [
      { id: '_c', init: bin('|', member(ident('i'), 'classid'), literal(0)) },
      { id: '_q', init: bin('|', member(ident('i'), 'quality'), literal(0)) },
      { id: '_t', init: bin('|', member(ident('i'), 'itemType'), literal(0)) },
    ]));

    // Switch dispatch
    this.buildSwitchDispatch(body, plan, mqSources);

    // Catch-all rules
    for (const rule of plan.catchAll) {
      body.push(...this.buildCheckRuleStmts(rule, mqSources, false));
    }

    body.push(returnStmt(ident('_r')));
    return fnDecl('_ci', ['i', '_id'], body);
  }

  private buildSwitchDispatch(body: ESTree.Statement[], plan: DispatchPlan, mqSources: string[]): void {
    this.buildMergedSwitch(body, plan.classidGroups, ident('_c'), mqSources);
    this.buildMergedSwitch(body, plan.typeGroups, ident('_t'), mqSources);
  }

  private buildMergedSwitch(
    body: ESTree.Statement[],
    groups: Map<number, Map<number | null, GroupedRule[]>>,
    disc: ESTree.Expression,
    mqSources: string[],
  ): void {
    if (groups.size === 0) return;

    const caseEntries: { key: number; stmts: ESTree.Statement[] }[] = [];
    for (const [key, qualityMap] of groups) {
      const stmts = this.buildQualityDispatch(qualityMap, mqSources, false);
      caseEntries.push({ key, stmts });
    }

    // Group cases with identical bodies (normalized)
    const caseGroups: { keys: number[]; stmts: ESTree.Statement[] }[] = [];
    const bodyMap = new Map<string, number>();
    for (const entry of caseEntries) {
      // Simple normalization: stringify the statements for comparison
      const normalized = JSON.stringify(entry.stmts).replace(/\d+/g, '0');
      const existing = bodyMap.get(normalized);
      if (existing !== undefined) {
        caseGroups[existing].keys.push(entry.key);
      } else {
        bodyMap.set(normalized, caseGroups.length);
        caseGroups.push({ keys: [entry.key], stmts: entry.stmts });
      }
    }

    const cases: ESTree.SwitchCase[] = [];
    for (const group of caseGroups) {
      // Fall-through labels
      for (let i = 0; i < group.keys.length - 1; i++) {
        cases.push(switchCase(literal(group.keys[i]), []));
      }
      cases.push(switchCase(literal(group.keys[group.keys.length - 1]),
        [block([...group.stmts, breakStmt()])]));
    }

    body.push(switchStmt(disc, cases));
  }

  private buildQualityDispatch(
    qualityMap: Map<number | null, GroupedRule[]>,
    mqSources: string[],
    isTier: boolean,
  ): ESTree.Statement[] {
    const stmts: ESTree.Statement[] = [];
    const fixedQualities = [...qualityMap.entries()].filter(([q]) => q !== null);
    const anyQuality = qualityMap.get(null);

    if (fixedQualities.length > 0) {
      const cases: ESTree.SwitchCase[] = [];
      for (const [quality, rules] of fixedQualities) {
        const caseBody = isTier
          ? this.buildTierGroup(rules)
          : this.buildHoistedGroup(rules, mqSources);
        cases.push(switchCase(literal(quality!), [block([...caseBody, breakStmt()])]));
      }
      stmts.push(switchStmt(ident('_q'), cases));
    }

    if (anyQuality && anyQuality.length > 0) {
      const groupStmts = isTier
        ? this.buildTierGroup(anyQuality)
        : this.buildHoistedGroup(anyQuality, mqSources);
      stmts.push(...groupStmts);
    }

    return stmts;
  }

  private buildHoistedGroup(rules: GroupedRule[], mqSources: string[]): ESTree.Statement[] {
    const stmts: ESTree.Statement[] = [];

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

    // Build hoisted var declarations
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
        const getStatArgs = Array.isArray(stat)
          ? [literal(stat[0]), literal(stat[1])]
          : [literal(stat)];
        stmts.push(varDecl('const', [{
          id: varName,
          init: bin('|', call(member(ident('i'), 'getStatEx'), getStatArgs), literal(0)),
        }]));
      }
    }

    // Split into base-stat and magical-stat rules
    const baseRules: GroupedRule[] = [];
    const magicalRules: GroupedRule[] = [];
    let firstMagicalSource: string | null = null;

    for (const rule of rules) {
      if (rule.statExpr && this.usesMagicalStatsOnly(rule.statExpr)) {
        magicalRules.push(rule);
        if (!firstMagicalSource) firstMagicalSource = rule.source;
      } else {
        baseRules.push(rule);
      }
    }

    // Base-stat rules
    for (const rule of baseRules) {
      stmts.push(...this.buildCheckRuleStmts(rule, mqSources, true, hoisted));
    }

    // Unid bail + magical rules
    if (magicalRules.length > 0 && firstMagicalSource) {
      const maybeId = this.getSourceId(firstMagicalSource);
      stmts.push(ifStmt(unary('!', ident('_id')), [returnStmt(literal(-(maybeId + 1)))]));

      for (const rule of magicalRules) {
        stmts.push(...this.buildCheckRuleStmts(rule, mqSources, true, hoisted));
      }
    }

    return stmts;
  }

  private buildCheckRuleStmts(
    rule: GroupedRule,
    mqSources: string[],
    skipMaybe: boolean,
    hoisted?: Map<number | string, string>,
  ): ESTree.Statement[] {
    const stmts: ESTree.Statement[] = [];
    const nipLoc: NipLoc = {
      source: rule.source.split('#')[0],
      line: rule.line.lineNumber,
      col: 1,
    };

    const conditions: ESTree.Expression[] = [];
    if (rule.residualProperty) {
      conditions.push(this.codegen.emitPropertyExpr(rule.residualProperty));
    }

    const hasStats = rule.statExpr !== null;
    let statExpr: ESTree.Expression | null = null;
    if (hasStats) {
      const exprHoisted = new Map<number | string, string>(hoisted ?? []);
      statExpr = this.codegen.emitStatExprWithHoisted(rule.statExpr!, exprHoisted);
    }

    const mqIdx = mqSources.indexOf(rule.source);
    const hasMq = mqIdx !== -1;
    const matchStmt = returnStmt(literal(this.getSourceId(rule.source) + 1));
    const sourceComment = `${rule.source}${rule.line.comment ? ' — ' + rule.line.comment.trim() : ''}`;

    const wrapComment = (s: ESTree.Statement): ESTree.Statement => {
      // Attach NIP source location for source maps
      s.loc = {
        source: nipLoc.source ?? null,
        start: { line: nipLoc.line, column: 0 },
        end: { line: nipLoc.line, column: 0 },
      };
      return this.comments ? withLeadingComment(s, ` ${sourceComment}`) : s;
    };

    if (conditions.length > 0 && hasStats) {
      const propCond = conditions.length === 1 ? conditions[0] : conditions.reduce((a, b) => logical('&&', a, b));
      if (hasMq) {
        const mqEntry = memberComputed(ident('_mq'), literal(mqIdx));
        const mqCheck = bin('<',
          call(ident('checkQuantityOwned'), [
            member(mqEntry, 'prop'),
            member(mqEntry, 'stat'),
          ]),
          literal(rule.maxQuantity!));
        stmts.push(wrapComment(ifStmt(propCond, [ifStmt(statExpr!, [ifStmt(mqCheck, [matchStmt])])])));
      } else {
        stmts.push(wrapComment(ifStmt(propCond, [ifStmt(statExpr!, [matchStmt])])));
      }
    } else if (conditions.length > 0) {
      const propCond = conditions.length === 1 ? conditions[0] : conditions.reduce((a, b) => logical('&&', a, b));
      stmts.push(wrapComment(ifStmt(propCond, [matchStmt])));
    } else if (hasStats) {
      stmts.push(wrapComment(ifStmt(statExpr!, [matchStmt])));
    } else {
      stmts.push(wrapComment(matchStmt));
    }

    return stmts;
  }

  private buildCheckItemFunction(): ESTree.FunctionDeclaration {
    const body: ESTree.Statement[] = [];

    body.push(varDecl('const', [{
      id: 'r',
      init: call(ident('_ci'), [ident('i'), call(member(ident('i'), 'getFlag'), [literal(16)])]),
    }]));

    // Non-verbose return
    body.push(ifStmt(unary('!', ident('verbose')), [
      returnStmt(cond(bin('>', ident('r'), literal(0)), literal(1),
        cond(bin('<', ident('r'), literal(0)), literal(-1), literal(0)))),
    ]));

    // Verbose return
    body.push(varDecl('const', [
      { id: 'id', init: bin('-', cond(bin('>', ident('r'), literal(0)), ident('r'), unary('-', ident('r'))), literal(1)) },
      { id: 'e', init: cond(bin('>=', ident('id'), literal(0)), memberComputed(ident('_s'), ident('id')), literal(null)) },
    ]));

    const result = cond(bin('>', ident('r'), literal(0)), literal(1),
      cond(bin('<', ident('r'), literal(0)), literal(-1), literal(0)));

    if (this.config.kolbotCompat) {
      body.push(returnStmt(object([
        { key: 'result', value: result },
        { key: 'line', value: cond(ident('e'),
          bin('+', bin('+', memberComputed(ident('_f'), memberComputed(ident('e'), literal(0))),
            literal(' #')), memberComputed(ident('e'), literal(1))),
          literal(null)) },
      ])));
    } else {
      body.push(returnStmt(object([
        { key: 'result', value: result },
        { key: 'file', value: cond(ident('e'), memberComputed(ident('_f'), memberComputed(ident('e'), literal(0))), literal(null)) },
        { key: 'line', value: cond(ident('e'), memberComputed(ident('e'), literal(1)), literal(0)) },
      ])));
    }

    return fnDecl('checkItem', ['i', 'verbose'], body);
  }

  private buildTierFunction(
    name: string,
    field: 'tierExpr' | 'mercTierExpr',
    plan: DispatchPlan,
  ): ESTree.FunctionDeclaration {
    this.currentTierField = field;
    const body: ESTree.Statement[] = [];

    body.push(varDecl('let', [
      { id: 'tier', init: literal(-1) },
      { id: 't', init: undefined },
    ]));
    body.push(varDecl('const', [
      { id: '_c', init: bin('|', member(ident('i'), 'classid'), literal(0)) },
      { id: '_q', init: bin('|', member(ident('i'), 'quality'), literal(0)) },
      { id: '_t', init: bin('|', member(ident('i'), 'itemType'), literal(0)) },
    ]));

    const buildGroup = (groups: Map<number, Map<number | null, GroupedRule[]>>, disc: ESTree.Expression) => {
      const filtered = new Map<number, Map<number | null, GroupedRule[]>>();
      for (const [key, qualityMap] of groups) {
        const fq = new Map<number | null, GroupedRule[]>();
        for (const [q, rules] of qualityMap) {
          const tierRules = rules.filter(r => r[field] !== null);
          if (tierRules.length > 0) fq.set(q, tierRules);
        }
        if (fq.size > 0) filtered.set(key, fq);
      }
      if (filtered.size === 0) return;

      const cases: ESTree.SwitchCase[] = [];
      for (const [key, qualityMap] of filtered) {
        const stmts = this.buildQualityDispatch(qualityMap, [], true);
        cases.push(switchCase(literal(key), [block([...stmts, breakStmt()])]));
      }
      body.push(switchStmt(disc, cases));
    };

    buildGroup(plan.classidGroups, member(ident('i'), 'classid'));
    buildGroup(plan.typeGroups, member(ident('i'), 'itemType'));

    const catchAllTier = plan.catchAll.filter(r => r[field] !== null);
    for (const rule of catchAllTier) {
      body.push(...this.buildTierRuleStmts(rule, field));
    }

    body.push(returnStmt(ident('tier')));
    return fnDecl(name, ['i'], body);
  }

  private buildTierGroup(rules: GroupedRule[]): ESTree.Statement[] {
    const stmts: ESTree.Statement[] = [];
    for (const rule of rules) {
      stmts.push(...this.buildTierRuleStmts(rule, this.currentTierField));
    }
    return stmts;
  }

  private buildTierRuleStmts(
    rule: GroupedRule,
    field: 'tierExpr' | 'mercTierExpr',
  ): ESTree.Statement[] {
    const tierExpr = rule[field];
    if (!tierExpr) return [];

    const stmts: ESTree.Statement[] = [];
    const tierJs = this.codegen.emitStatExpr(tierExpr);

    const conditions: ESTree.Expression[] = [];
    if (rule.residualProperty) {
      conditions.push(this.codegen.emitPropertyExpr(rule.residualProperty));
    }
    if (rule.statExpr) {
      conditions.push(this.codegen.emitStatExpr(rule.statExpr));
    }

    const tierAssign: ESTree.Statement[] = [
      exprStmt(assign(ident('t'), tierJs)),
      ifStmt(bin('>', ident('t'), ident('tier')), [
        exprStmt(assign(ident('tier'), ident('t'))),
      ]),
    ];

    const sourceComment = `${rule.source}${rule.line.comment ? ' — ' + rule.line.comment.trim() : ''}`;

    if (conditions.length > 0) {
      const cond = conditions.length === 1 ? conditions[0] : conditions.reduce((a, b) => logical('&&', a, b));
      const stmt = ifStmt(cond, tierAssign);
      stmts.push(this.comments ? withLeadingComment(stmt, ` ${sourceComment}`) : stmt);
    } else {
      const stmt = tierAssign[0];
      stmts.push(this.comments ? withLeadingComment(stmt, ` ${sourceComment}`) : stmt);
      stmts.push(tierAssign[1]);
    }

    return stmts;
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
}
