export { Emitter } from './emitter.js';
export { Analyzer } from './analyzer.js';
export { Grouper } from './grouper.js';
export type { AliasMapSet, EmitterConfig, DispatchPlan, AnalyzedLine, GroupedRule } from './types.js';
export { DispatchKind, DispatchStrategy, OutputFormat } from './types.js';
export { d2Aliases } from './d2-aliases.js';
export { DiagnosticAnalyzer } from './diagnostic-analyzer.js';
export { EmitterAST } from './emitter-ast.js';
export { CodeGenAST } from './codegen-ast.js';
export { resolveUnique, resolveSetItem, resolveSetName,
  isUniqueName, isSetItemName, isSetName,
  getAllUniqueNames, getAllSetItemNames, getAllSetNames,
} from './d2-discriminator.js';
export type { StatCheck, UniqueResolveResult, SetResolveResult } from './d2-discriminator.js';
export { uniqueItems, uniqueNameToKey, uniquesByClassId } from './d2-unique-items.js';
export { setItems, setNameToKey, setNameToItems, setFullNameToKey } from './d2-set-items.js';
