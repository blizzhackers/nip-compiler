// Lexer / Parser / Binder
export { Lexer, LexerError } from './lexer.js';
export { Parser, ParseError } from './parser.js';
export { Binder } from './binder.js';
export type { BinderResult, JipLanguage } from './binder.js';

// AST types (tokens, nodes, expressions)
export * from './types.js';

// Emitter pipeline
export { Emitter, EmitterAST, CodeGenAST, Analyzer, Grouper, DiagnosticAnalyzer,
  OutputFormat, DispatchKind, DispatchStrategy,
} from './emitter/index.js';
export type { AliasMapSet, EmitterConfig, DispatchPlan, AnalyzedLine, GroupedRule,
  StatCheck, UniqueResolveResult, SetResolveResult,
} from './emitter/index.js';

// D2 game data
export { d2Aliases } from './emitter/index.js';
export { typeToClassIds, classIdToType, typeProperties } from './emitter/d2-type-map.js';
export {
  uniqueItems, uniqueNameToKey, uniqueNameToKeyLower, uniquesByClassId,
  type UniqueItemDef,
} from './emitter/d2-unique-items.js';
export {
  setItems, setNameToKey, setNameToKeyLower, setNameToItems,
  setFullNameToKey, setFullNameToKeyLower, setsByClassId,
  type SetItemDef,
} from './emitter/d2-set-items.js';

// Discriminator (JIP → NIP resolution)
export {
  resolveUnique, resolveSetItem, resolveSetName,
  isUniqueName, isSetItemName, isSetName,
  getAllUniqueNames, getAllSetItemNames, getAllSetNames,
} from './emitter/index.js';

// Printer (AST → text)
export { printLine, printExpr, printLineFromTokens, printExprFromTokens } from './printer.js';

// Rewriter (code actions)
export { getAvailableRewrites, type Rewrite } from './rewriter.js';
