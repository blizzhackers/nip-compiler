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

interface ASTRuleBlock {
  condition: ESTree.Expression | null;
  conditionKey: string | null;
  comment: string | null;
  vars: ESTree.Statement[];
  body: ESTree.Statement[];
}

interface ASTFlagGroup {
  flagCondition: ESTree.Expression | null;
  flagConditionKey: string | null;
  rules: { original: GroupedRule; stripped: GroupedRule }[];
}

export class EmitterAST {
  private analyzer: Analyzer;
  private grouper: Grouper;
  private codegen: CodeGenAST;
  private comments: boolean;
  private sourceIdMap = new Map<string, number>();
  private fileTable: string[] = [];
  private fileIdMap = new Map<string, number>();
  private currentTierField: 'tierExpr' | 'mercTierExpr' = 'tierExpr';
  private localVarCounter = 0;
  private helperFunctions: ESTree.Statement[] = [];
  private helperCounter = 0;

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

  // Encode source location as a single integer: (fileId << 16) | lineNumber.
  // This eliminates the _s lookup table — the return value IS the source info.
  // Decode: file = _f[value >>> 16], line = value & 0xFFFF
  private getSourceEncoded(source: string): number {
    let encoded = this.sourceIdMap.get(source);
    if (encoded === undefined) {
      const [file, lineNum] = source.split('#');
      encoded = (this.getFileId(file) << 16) | parseInt(lineNum);
      this.sourceIdMap.set(source, encoded);
    }
    return encoded;
  }

  emitAST(files: NipFileNode[]): ESTree.Program {
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

    // _ci function (helper functions emitted first — they're populated during buildCi)
    this.helperFunctions = [];
    this.helperCounter = 0;
    const ciFunc = this.buildCiFunction(plan, mqRules.map(m => m.source));
    body.push(...this.helperFunctions);
    body.push(ciFunc);

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
    // _s table eliminated — source info is encoded directly in return values:
    // positive = match, negative = unid bail. Decode: file = _f[|value| >>> 16], line = |value| & 0xFFFF

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
      const normalized = JSON.stringify(entry.stmts);
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
      let caseBody: ESTree.Statement[];

      // V8's TurboFan JIT has a bytecode size limit (~100KB). Our _ci function
      // can be 300K+ with many NIP rules. By extracting each classid's dispatch
      // into its own function, _ci stays small enough for TurboFan (jump tables,
      // inlining) and hot helpers get individually optimized.
      const stmtsJson = JSON.stringify(group.stmts);
      if (stmtsJson.length > 2000) {
        const helperName = `_d${this.helperCounter++}`;
        this.helperFunctions.push(fnDecl(helperName, ['i', '_id'], [
          varDecl('const', [
            { id: '_c', init: bin('|', member(ident('i'), 'classid'), literal(0)) },
            { id: '_q', init: bin('|', member(ident('i'), 'quality'), literal(0)) },
            { id: '_t', init: bin('|', member(ident('i'), 'itemType'), literal(0)) },
          ]),
          ...group.stmts,
          returnStmt(literal(0)),
        ]));
        // Call helper; if it returned non-zero (match or maybe), propagate it
        const resultVar = `_r${this.helperCounter}`;
        caseBody = [
          varDecl('const', [{ id: resultVar, init: call(ident(helperName), [ident('i'), ident('_id')]) }]),
          ifStmt(ident(resultVar), [returnStmt(ident(resultVar))]),
          breakStmt(),
        ];
      } else {
        caseBody = [...group.stmts, breakStmt()];
      }

      // Fall-through labels
      for (let i = 0; i < group.keys.length - 1; i++) {
        cases.push(switchCase(literal(group.keys[i]), []));
      }
      cases.push(switchCase(literal(group.keys[group.keys.length - 1]),
        [block(caseBody)]));
    }

    body.push(switchStmt(disc, cases));
  }

  private static readonly MIN_QUALITY = 1;
  private static readonly MAX_QUALITY = 8;

  private buildQualityDispatch(
    qualityMap: Map<number | null, GroupedRule[]>,
    mqSources: string[],
    isTier: boolean,
  ): ESTree.Statement[] {
    const stmts: ESTree.Statement[] = [];
    const fixedQualities = [...qualityMap.entries()].filter(([q]) => q !== null);
    const anyQuality = qualityMap.get(null);

    // Partition any-quality rules into range-quality and true catch-all
    const rangeGroups: { qualities: number[]; rules: GroupedRule[] }[] = [];
    const trueCatchAll: GroupedRule[] = [];

    if (anyQuality) {
      // Group consecutive rules with the same quality range together
      for (const rule of anyQuality) {
        const extracted = this.extractQualityRange(rule.residualProperty);
        if (extracted) {
          const strippedRule = { ...rule, residualProperty: extracted.rest };
          const key = extracted.qualities.join(',');
          const last = rangeGroups[rangeGroups.length - 1];
          if (last && last.qualities.join(',') === key) {
            last.rules.push(strippedRule);
          } else {
            rangeGroups.push({ qualities: extracted.qualities, rules: [strippedRule] });
          }
        } else {
          trueCatchAll.push(rule);
        }
      }
    }

    // Merge range-quality rules into the quality map: add them to each matching quality bucket
    const mergedMap = new Map<number, GroupedRule[]>();
    for (const [quality, rules] of fixedQualities) {
      mergedMap.set(quality!, [...rules]);
    }
    for (const group of rangeGroups) {
      for (const q of group.qualities) {
        if (!mergedMap.has(q)) mergedMap.set(q, []);
        mergedMap.get(q)!.push(...group.rules);
      }
    }

    if (mergedMap.size > 0) {
      const cases: ESTree.SwitchCase[] = [];

      // Group cases with identical rule sets (for fallthrough dedup)
      const caseEntries: { key: number; rules: GroupedRule[] }[] = [];
      for (const [quality, rules] of mergedMap) {
        caseEntries.push({ key: quality, rules });
      }
      const caseGroups: { keys: number[]; rules: GroupedRule[] }[] = [];
      const bodyMap = new Map<string, number>();
      for (const entry of caseEntries) {
        const sig = entry.rules.map(r => r.source).join('|');
        const existing = bodyMap.get(sig);
        if (existing !== undefined) {
          caseGroups[existing].keys.push(entry.key);
        } else {
          bodyMap.set(sig, caseGroups.length);
          caseGroups.push({ keys: [entry.key], rules: entry.rules });
        }
      }

      for (const group of caseGroups) {
        const caseBody = isTier
          ? this.buildTierGroup(group.rules)
          : this.buildHoistedGroup(group.rules, mqSources);
        for (let i = 0; i < group.keys.length - 1; i++) {
          cases.push(switchCase(literal(group.keys[i]), []));
        }
        cases.push(switchCase(literal(group.keys[group.keys.length - 1]),
          [block([...caseBody, breakStmt()])]));
      }
      stmts.push(switchStmt(ident('_q'), cases));
    }

    if (trueCatchAll.length > 0) {
      const groupStmts = isTier
        ? this.buildTierGroup(trueCatchAll)
        : this.buildHoistedGroup(trueCatchAll, mqSources);
      stmts.push(...groupStmts);
    }

    return stmts;
  }

  // Quality is an enum (1=lowquality..8=crafted). Range checks like [quality] <= superior
  // become individual switch case labels instead of if(_q <= 3), because the JIT
  // generates a jump table for dense integer switches.
  private extractQualityRange(expr: ExprNode | null): { qualities: number[]; rest: ExprNode | null } | null {
    if (!expr) return null;

    // Direct quality comparison: [quality] <= 3, [quality] >= 4, etc.
    if (expr.kind === NodeKind.BinaryExpr
      && expr.left.kind === NodeKind.KeywordExpr
      && expr.left.name === 'quality'
      && (expr.op === '<=' || expr.op === '>=' || expr.op === '<' || expr.op === '>')) {
      const value = this.resolveQualityValue(expr.right);
      if (value === null) return null;
      const qualities = this.expandQualityRange(expr.op, value);
      if (!qualities) return null;
      return { qualities, rest: null };
    }

    // OR of quality equalities: [quality] == rare || [quality] == unique
    if (expr.kind === NodeKind.BinaryExpr && expr.op === '||') {
      const qualities: number[] = [];
      const branches = this.flattenOr(expr);
      const allQuality = branches.every(b => {
        if (b.kind === NodeKind.BinaryExpr && b.op === '=='
          && b.left.kind === NodeKind.KeywordExpr && b.left.name === 'quality') {
          const v = this.resolveQualityValue(b.right);
          if (v !== null) { qualities.push(v); return true; }
        }
        return false;
      });
      if (allQuality && qualities.length > 0) {
        return { qualities, rest: null };
      }
    }

    // Quality comparison as part of AND: [quality] <= 3 && [flag] != ethereal
    if (expr.kind === NodeKind.BinaryExpr && expr.op === '&&') {
      const leftRange = this.extractQualityRange(expr.left);
      if (leftRange) {
        const rest = leftRange.rest
          ? { ...expr, left: leftRange.rest } as ExprNode
          : expr.right;
        return { qualities: leftRange.qualities, rest };
      }
      const rightRange = this.extractQualityRange(expr.right);
      if (rightRange) {
        const rest = rightRange.rest
          ? { ...expr, right: rightRange.rest } as ExprNode
          : expr.left;
        return { qualities: rightRange.qualities, rest };
      }
    }

    return null;
  }

  private resolveQualityValue(expr: ExprNode): number | null {
    if (expr.kind === NodeKind.NumberLiteral) return expr.value;
    if (expr.kind === NodeKind.Identifier) {
      const map = this.config.aliases.quality;
      if (map && expr.name in map) return map[expr.name];
    }
    return null;
  }

  private expandQualityRange(op: string, value: number): number[] | null {
    let low: number, high: number;
    switch (op) {
      case '<=': low = EmitterAST.MIN_QUALITY; high = value; break;
      case '<':  low = EmitterAST.MIN_QUALITY; high = value - 1; break;
      case '>=': low = value; high = EmitterAST.MAX_QUALITY; break;
      case '>':  low = value + 1; high = EmitterAST.MAX_QUALITY; break;
      default: return null;
    }
    if (low > high) return null;
    const result: number[] = [];
    for (let i = low; i <= high; i++) result.push(i);
    return result;
  }

  private buildHoistedGroup(rules: GroupedRule[], mqSources: string[]): ESTree.Statement[] {
    const stmts: ESTree.Statement[] = [];

    // Sort rules for optimal dispatch:
    // 1. Property-only rules first (no stat checks = fast unconditional match)
    // 2. Group by flag condition so consecutive rules share the same getFlag() call
    const sorted = [...rules].sort((a, b) => {
      const aHasStats = a.statExpr !== null ? 1 : 0;
      const bHasStats = b.statExpr !== null ? 1 : 0;
      if (aHasStats !== bHasStats) return aHasStats - bHasStats;
      const aFlag = this.getFlagKey(a.residualProperty);
      const bFlag = this.getFlagKey(b.residualProperty);
      if (aFlag < bFlag) return -1;
      if (aFlag > bFlag) return 1;
      return 0;
    });

    // Dead code elimination: a rule with no residual property AND no stats
    // is an unconditional match — everything after it is unreachable
    const alive: GroupedRule[] = [];
    for (const rule of sorted) {
      alive.push(rule);
      if (!rule.residualProperty && !rule.statExpr) break;
    }

    // Collect stat frequencies for hoisting (only from alive rules)
    const statFreq = new Map<string, number>();
    for (const rule of alive) {
      if (rule.statExpr) {
        const stats = this.codegen.collectStatIds(rule.statExpr);
        for (const [name] of stats) {
          statFreq.set(name, (statFreq.get(name) ?? 0) + 1);
        }
      }
    }

    // Build hoisted var declarations (emitted upfront — shared across base + magical)
    const hoisted = new Map<number | string, string>();
    const hoistedDecls: ESTree.Statement[] = [];
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
        hoistedDecls.push(varDecl('const', [{
          id: varName,
          init: bin('|', call(member(ident('i'), 'getStatEx'), getStatArgs), literal(0)),
        }]));
      }
    }

    // Group consecutive rules by shared flag/property condition
    const groups = this.groupBySharedConditionAST(alive);

    // Unid bail ordering: in the original NTIP, the entire property section
    // (classid, quality, flags, class, level) is evaluated as one function.
    // If any property check fails, the rule is skipped — no unid bail.
    // The unid bail ("maybe, ID this item") only fires when ALL property
    // conditions pass but magical stats can't be verified because unidentified.
    //
    // Flagged groups (eth/runeword/etc.) are self-contained: the flag check
    // is a property condition, so the unid bail goes INSIDE the if(flag) block.
    // Unflagged groups have all property conditions already dispatched (classid,
    // quality) so their unid bail is at the current scope.
    stmts.push(...hoistedDecls);
    let pendingBaseBlocks: ASTRuleBlock[] = [];
    let pendingMagicalBlocks: ASTRuleBlock[] = [];
    let pendingMagicalSource: string | null = null;

    const flushPending = (): void => {
      stmts.push(...this.chainBlocksAST(pendingBaseBlocks));
      pendingBaseBlocks = [];
      if (pendingMagicalBlocks.length > 0 && pendingMagicalSource) {
        const encoded = this.getSourceEncoded(pendingMagicalSource);
        stmts.push(ifStmt(unary('!', ident('_id')), [returnStmt(literal(-encoded))]));
        stmts.push(...this.chainBlocksAST(pendingMagicalBlocks));
        pendingMagicalBlocks = [];
        pendingMagicalSource = null;
      }
    };

    for (const group of groups) {
      if (group.flagCondition) {
        // Flush any pending unflagged blocks first
        flushPending();

        // Self-contained flagged group: base + unid bail + magical all inside if(flag)
        const baseRules: typeof group.rules = [];
        const magicalRules: typeof group.rules = [];
        let firstMagical: string | null = null;

        for (const rule of group.rules) {
          const effective = rule.stripped;
          if (effective.statExpr && this.usesMagicalStatsOnly(effective.statExpr)) {
            magicalRules.push(rule);
            if (!firstMagical) firstMagical = effective.source;
          } else {
            baseRules.push(rule);
          }
        }

        const innerStmts: ESTree.Statement[] = [];
        const baseBlocks = baseRules.map(r =>
          this.buildCheckRuleBlock(r.stripped, mqSources, hoisted));
        innerStmts.push(...this.chainBlocksAST(baseBlocks));

        if (magicalRules.length > 0 && firstMagical) {
          const encoded = this.getSourceEncoded(firstMagical);
          innerStmts.push(ifStmt(unary('!', ident('_id')), [returnStmt(literal(-encoded))]));
          const magicBlocks = magicalRules.map(r => {
            const stripped = this.stripIdentifiedCheck(r.stripped);
            return this.buildCheckRuleBlock(stripped, mqSources, hoisted);
          });
          innerStmts.push(...this.chainBlocksAST(magicBlocks));
        }

        stmts.push(ifStmt(group.flagCondition, innerStmts));
      } else {
        // Unflagged: accumulate base/magical separately
        for (const rule of group.rules) {
          const effective = rule.original;
          if (effective.statExpr && this.usesMagicalStatsOnly(effective.statExpr)) {
            if (!pendingMagicalSource) pendingMagicalSource = effective.source;
            const stripped = this.stripIdentifiedCheck(effective);
            pendingMagicalBlocks.push(
              this.buildCheckRuleBlock(stripped, mqSources, hoisted));
          } else {
            pendingBaseBlocks.push(
              this.buildCheckRuleBlock(effective, mqSources, hoisted));
          }
        }
      }
    }
    flushPending();

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
    const matchStmt = returnStmt(literal(this.getSourceEncoded(rule.source)));
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

    const encoded = this.getSourceEncoded(rule.source);
    const maybeStmt: ESTree.Statement = exprStmt(assign(ident('_r'), literal(-encoded)));

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
      } else if (skipMaybe) {
        stmts.push(wrapComment(ifStmt(propCond, [ifStmt(statExpr!, [matchStmt])])));
      } else {
        // if(prop){if(stat){return N}else if(!_id)_r=-N}
        const inner: ESTree.IfStatement = {
          type: 'IfStatement',
          test: statExpr!,
          consequent: { type: 'BlockStatement', body: [matchStmt] },
          alternate: ifStmt(unary('!', ident('_id')), [maybeStmt]),
        };
        stmts.push(wrapComment(ifStmt(propCond, [inner])));
      }
    } else if (conditions.length > 0) {
      const propCond = conditions.length === 1 ? conditions[0] : conditions.reduce((a, b) => logical('&&', a, b));
      stmts.push(wrapComment(ifStmt(propCond, [matchStmt])));
    } else if (hasStats) {
      if (hasMq) {
        const mqEntry = memberComputed(ident('_mq'), literal(mqIdx));
        const mqCheck = bin('<',
          call(ident('checkQuantityOwned'), [
            literal(null),
            member(mqEntry, 'stat'),
          ]),
          literal(rule.maxQuantity!));
        stmts.push(wrapComment(ifStmt(statExpr!, [ifStmt(mqCheck, [matchStmt])])));
      } else if (skipMaybe) {
        stmts.push(wrapComment(ifStmt(statExpr!, [matchStmt])));
      } else {
        // if(stat){return N}else if(!_id)_r=-N
        const inner: ESTree.IfStatement = {
          type: 'IfStatement',
          test: statExpr!,
          consequent: { type: 'BlockStatement', body: [matchStmt] },
          alternate: ifStmt(unary('!', ident('_id')), [maybeStmt]),
        };
        stmts.push(wrapComment(inner));
      }
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

    // Verbose return: decode source info from r directly.
    // r is encoded as (fileId << 16 | lineNumber), sign indicates match vs unid bail.
    // const v = r > 0 ? r : -r;  (absolute value)
    body.push(varDecl('const', [
      { id: 'v', init: cond(bin('>', ident('r'), literal(0)), ident('r'), unary('-', ident('r'))) },
    ]));

    const result = cond(bin('>', ident('r'), literal(0)), literal(1),
      cond(bin('<', ident('r'), literal(0)), literal(-1), literal(0)));

    // file = _f[v >>> 16], line = v & 0xFFFF
    const fileExpr = cond(ident('v'),
      memberComputed(ident('_f'), bin('>>>', ident('v'), literal(16))),
      literal(null));
    const lineExpr = cond(ident('v'),
      bin('&', ident('v'), literal(0xFFFF)),
      literal(0));

    if (this.config.kolbotCompat) {
      body.push(returnStmt(object([
        { key: 'result', value: result },
        { key: 'line', value: cond(ident('v'),
          bin('+', bin('+', fileExpr, literal(' #')), lineExpr),
          literal(null)) },
      ])));
    } else {
      body.push(returnStmt(object([
        { key: 'result', value: result },
        { key: 'file', value: fileExpr },
        { key: 'line', value: lineExpr },
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

  private buildCheckRuleBlock(
    rule: GroupedRule,
    mqSources: string[],
    hoisted?: Map<number | string, string>,
  ): ASTRuleBlock {
    const comment = this.comments
      ? `${rule.source}${rule.line.comment ? ' — ' + rule.line.comment.trim() : ''}`
      : null;

    const conditions: ESTree.Expression[] = [];
    if (rule.residualProperty) {
      conditions.push(this.codegen.emitPropertyExpr(rule.residualProperty));
    }

    const hasStats = rule.statExpr !== null;
    const reorderedStat = hasStats ? this.reorderBySelectivity(rule.statExpr!) : null;

    const vars: ESTree.Statement[] = [];
    const exprHoisted = new Map<number | string, string>(hoisted ?? []);

    // Per-rule local hoisting: stats used 2+ times within this single rule
    if (reorderedStat) {
      const freq = new Map<string, number>();
      this.countStatFreq(reorderedStat, freq);
      for (const [name, count] of freq) {
        if (count < 2) continue;
        const stat = this.config.aliases.stat[name];
        const numStat = stat === undefined
          ? (name.includes(',') ? name.split(',').map(Number) as [number, number] : Number(name))
          : stat;
        if (typeof numStat === 'number' && isNaN(numStat)) continue;
        const key = Array.isArray(numStat) ? `${numStat[0]}_${numStat[1]}` : numStat;
        if (exprHoisted.has(key)) continue;
        const varName = `_l${this.localVarCounter++}`;
        exprHoisted.set(key, varName);
        const getStatArgs = Array.isArray(numStat)
          ? [literal(numStat[0]), literal(numStat[1])]
          : [literal(numStat)];
        vars.push(varDecl('const', [{
          id: varName,
          init: bin('|', call(member(ident('i'), 'getStatEx'), getStatArgs), literal(0)),
        }]));
      }
    }

    const statExpr = reorderedStat
      ? this.codegen.emitStatExprWithHoisted(reorderedStat, exprHoisted)
      : null;

    const mqIdx = mqSources.indexOf(rule.source);
    const hasMq = mqIdx !== -1;
    const matchStmt = returnStmt(literal(this.getSourceEncoded(rule.source)));

    let condition: ESTree.Expression | null = null;
    const body: ESTree.Statement[] = [];

    if (conditions.length > 0 && hasStats) {
      condition = conditions.length === 1 ? conditions[0] : conditions.reduce((a, b) => logical('&&', a, b));
      if (hasMq) {
        const mqEntry = memberComputed(ident('_mq'), literal(mqIdx));
        const mqCheck = bin('<',
          call(ident('checkQuantityOwned'), [
            member(mqEntry, 'prop'),
            member(mqEntry, 'stat'),
          ]),
          literal(rule.maxQuantity!));
        body.push(ifStmt(statExpr!, [ifStmt(mqCheck, [matchStmt])]));
      } else {
        body.push(ifStmt(statExpr!, [matchStmt]));
      }
    } else if (conditions.length > 0) {
      condition = conditions.length === 1 ? conditions[0] : conditions.reduce((a, b) => logical('&&', a, b));
      if (hasMq) {
        const mqEntry = memberComputed(ident('_mq'), literal(mqIdx));
        const mqCheck = bin('<',
          call(ident('checkQuantityOwned'), [
            member(mqEntry, 'prop'),
            literal(null),
          ]),
          literal(rule.maxQuantity!));
        body.push(ifStmt(mqCheck, [matchStmt]));
      } else {
        body.push(matchStmt);
      }
    } else if (hasStats) {
      condition = statExpr;
      if (hasMq) {
        const mqEntry = memberComputed(ident('_mq'), literal(mqIdx));
        const mqCheck = bin('<',
          call(ident('checkQuantityOwned'), [
            literal(null),
            member(mqEntry, 'stat'),
          ]),
          literal(rule.maxQuantity!));
        body.push(ifStmt(mqCheck, [matchStmt]));
      } else {
        body.push(matchStmt);
      }
    } else {
      body.push(matchStmt);
    }

    const conditionKey = condition ? JSON.stringify(condition) : null;
    return { condition, conditionKey, comment, vars, body };
  }

  private chainBlocksAST(blocks: ASTRuleBlock[]): ESTree.Statement[] {
    const stmts: ESTree.Statement[] = [];
    let i = 0;
    while (i < blocks.length) {
      const blk = blocks[i];
      if (!blk.condition) {
        if (blk.comment) {
          const first = blk.vars.length > 0 ? blk.vars[0] : blk.body[0];
          if (first) withLeadingComment(first, ` ${blk.comment}`);
        }
        stmts.push(...blk.vars, ...blk.body);
        i++;
        continue;
      }

      const allVars = [...blk.vars];
      const entries: { comment: string | null; body: ESTree.Statement[]; isElse: boolean }[] = [
        { comment: blk.comment, body: blk.body, isElse: false },
      ];
      const baseCond = blk.condition;
      const baseKey = blk.conditionKey;
      i++;

      while (i < blocks.length && blocks[i].condition) {
        const next = blocks[i];
        if (next.conditionKey === baseKey) {
          allVars.push(...next.vars);
          entries.push({ comment: next.comment, body: next.body, isElse: false });
          i++;
        } else if (this.isComplementAST(baseCond, next.condition!)) {
          allVars.push(...next.vars);
          entries.push({ comment: next.comment, body: next.body, isElse: true });
          i++;
          break;
        } else {
          break;
        }
      }

      stmts.push(...allVars);

      // Build the if body, skip dead code after unconditional return
      const ifBody: ESTree.Statement[] = [];
      let elseBody: ESTree.Statement[] | null = null;
      let ifTerminated = false;
      let elseTerminated = false;
      for (const entry of entries) {
        const isElse = entry.isElse;
        const target = isElse ? (elseBody = elseBody ?? []) : ifBody;
        const terminated = isElse ? elseTerminated : ifTerminated;
        if (terminated) continue;
        if (entry.comment) {
          const first = entry.body[0];
          if (first) withLeadingComment(first, ` ${entry.comment}`);
        }
        target.push(...entry.body);
        // Check if this entry ends with a return (makes subsequent entries dead)
        const last = entry.body[entry.body.length - 1];
        if (last?.type === 'ReturnStatement') {
          if (isElse) elseTerminated = true;
          else ifTerminated = true;
        }
      }

      if (elseBody) {
        const ifNode: ESTree.IfStatement = {
          type: 'IfStatement',
          test: baseCond,
          consequent: { type: 'BlockStatement', body: ifBody },
          alternate: { type: 'BlockStatement', body: elseBody },
        };
        stmts.push(ifNode);
      } else {
        stmts.push(ifStmt(baseCond, ifBody));
      }
    }
    return stmts;
  }

  private isComplementAST(a: ESTree.Expression, b: ESTree.Expression): boolean {
    // !X vs X
    if (a.type === 'UnaryExpression' && a.operator === '!' && a.prefix) {
      if (JSON.stringify(a.argument) === JSON.stringify(b)) return true;
    }
    if (b.type === 'UnaryExpression' && b.operator === '!' && b.prefix) {
      if (JSON.stringify(b.argument) === JSON.stringify(a)) return true;
    }

    // X op1 Y vs X op2 Y where ops are complementary
    if (a.type === 'BinaryExpression' && b.type === 'BinaryExpression') {
      if (JSON.stringify(a.left) === JSON.stringify(b.left) &&
          JSON.stringify(a.right) === JSON.stringify(b.right)) {
        const comp: Record<string, string> = {
          '<': '>=', '>=': '<', '<=': '>', '>': '<=', '===': '!==', '!==': '===',
          '==': '!=', '!=': '==',
        };
        return comp[a.operator] === b.operator;
      }
    }

    return false;
  }

  private groupBySharedConditionAST(rules: GroupedRule[]): ASTFlagGroup[] {
    const groups: ASTFlagGroup[] = [];
    let current: ASTFlagGroup | null = null;

    for (const rule of rules) {
      const extracted = this.extractGroupableCondition(rule.residualProperty);

      if (extracted) {
        const condExpr = this.codegen.emitPropertyExpr(extracted.condition);
        const condKey = JSON.stringify(condExpr);
        if (current && current.flagConditionKey === condKey) {
          current.rules.push({ original: rule, stripped: { ...rule, residualProperty: extracted.rest } });
        } else {
          current = {
            flagCondition: condExpr,
            flagConditionKey: condKey,
            rules: [{ original: rule, stripped: { ...rule, residualProperty: extracted.rest } }],
          };
          groups.push(current);
        }
      } else {
        current = null;
        groups.push({
          flagCondition: null,
          flagConditionKey: null,
          rules: [{ original: rule, stripped: rule }],
        });
      }
    }

    // Keep all flag groups — even single-rule ones — because the flag condition
    // is a property check that must happen before unid bail
    return groups;
  }

  private extractGroupableCondition(expr: ExprNode | null): { condition: ExprNode; rest: ExprNode | null } | null {
    if (!expr) return null;

    if (this.isPropertyOnlyExpr(expr)) {
      return { condition: expr, rest: null };
    }

    if (expr.kind !== NodeKind.BinaryExpr || expr.op !== '&&') return null;

    const leftProp = this.isPropertyOnlyExpr(expr.left);
    const rightProp = this.isPropertyOnlyExpr(expr.right);

    if (leftProp && rightProp) {
      const leftCallable = this.isCallablePropertyExpr(expr.left);
      const rightCallable = this.isCallablePropertyExpr(expr.right);
      if (!leftCallable && rightCallable) return { condition: expr.left, rest: expr.right };
      if (leftCallable && !rightCallable) return { condition: expr.right, rest: expr.left };
    }

    if (leftProp) return { condition: expr.left, rest: expr.right };
    if (rightProp) return { condition: expr.right, rest: expr.left };
    return null;
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

  private isCallablePropertyExpr(expr: ExprNode): boolean {
    if (expr.kind === NodeKind.KeywordExpr)
      return expr.name === 'flag' || expr.name === 'prefix' || expr.name === 'suffix';
    if (expr.kind === NodeKind.BinaryExpr)
      return this.isCallablePropertyExpr(expr.left);
    if (expr.kind === NodeKind.UnaryExpr)
      return this.isCallablePropertyExpr(expr.operand);
    return false;
  }

  private getFlagKey(expr: ExprNode | null): string {
    if (!expr) return '';
    const flag = this.extractGroupableCondition(expr);
    if (!flag) return '';
    return JSON.stringify(this.codegen.emitPropertyExpr(flag.condition));
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

  private reorderBySelectivity(expr: ExprNode): ExprNode {
    if (expr.kind !== NodeKind.BinaryExpr) return expr;
    if (expr.op === '&&' || expr.op === '||') {
      const left = this.reorderBySelectivity(expr.left);
      const right = this.reorderBySelectivity(expr.right);
      expr = { ...expr, left, right };
    }
    if (expr.op === '&&') {
      const conjuncts = this.flattenAnd(expr);
      conjuncts.sort((a, b) => this.selectivityScore(a) - this.selectivityScore(b));
      return this.rebuildChain(conjuncts, '&&');
    }
    if (expr.op === '||') {
      const disjuncts = this.flattenOr(expr);
      disjuncts.sort((a, b) => this.exprCost(a) - this.exprCost(b));
      return this.rebuildChain(disjuncts, '||');
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
      if (expr.op === '>=' || expr.op === '<=' || expr.op === '>' || expr.op === '<') return 2;
      if (expr.op === '&&') return Math.min(this.selectivityScore(expr.left), this.selectivityScore(expr.right));
      if (expr.op === '||') return 3;
    }
    return 4;
  }

  private exprCost(expr: ExprNode): number {
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
}
