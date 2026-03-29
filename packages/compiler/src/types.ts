export enum TokenType {
  // Brackets
  LeftBracket = 'LeftBracket',
  RightBracket = 'RightBracket',
  LeftParen = 'LeftParen',
  RightParen = 'RightParen',

  // Operators
  And = 'And',
  Or = 'Or',
  Equal = 'Equal',
  NotEqual = 'NotEqual',
  GreaterThan = 'GreaterThan',
  GreaterThanOrEqual = 'GreaterThanOrEqual',
  LessThan = 'LessThan',
  LessThanOrEqual = 'LessThanOrEqual',
  Not = 'Not',
  Plus = 'Plus',
  Minus = 'Minus',
  Multiply = 'Multiply',
  Divide = 'Divide',

  // Literals & identifiers
  Number = 'Number',
  Identifier = 'Identifier',

  // Structural
  Hash = 'Hash',
  Comma = 'Comma',
  Comment = 'Comment',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
  line: number;
  col: number;
}

export interface SourceLocation {
  pos: number;
  line: number;
  col: number;
  end?: number;
}

// --- AST Node Types ---

export enum NodeKind {
  NipFile = 'NipFile',
  NipLine = 'NipLine',
  PropertySection = 'PropertySection',
  StatSection = 'StatSection',
  MetaSection = 'MetaSection',
  BinaryExpr = 'BinaryExpr',
  UnaryExpr = 'UnaryExpr',
  KeywordExpr = 'KeywordExpr',
  NumberLiteral = 'NumberLiteral',
  Identifier = 'Identifier',
  MetaEntry = 'MetaEntry',
  InExpr = 'InExpr',
}

export type BinaryOp = '&&' | '||' | '==' | '!=' | '>' | '>=' | '<' | '<=' | '+' | '-' | '*' | '/';
export type UnaryOp = '!';

export interface BaseNode {
  kind: NodeKind;
  loc: SourceLocation;
}

export interface NipFileNode extends BaseNode {
  kind: NodeKind.NipFile;
  lines: NipLineNode[];
  filename: string;
}

export interface NipLineNode extends BaseNode {
  kind: NodeKind.NipLine;
  property: SectionNode | null;
  stats: SectionNode | null;
  meta: MetaSectionNode | null;
  comment: string | null;
  lineNumber: number;
}

export interface SectionNode extends BaseNode {
  kind: NodeKind.PropertySection | NodeKind.StatSection;
  expr: ExprNode;
}

export interface MetaSectionNode extends BaseNode {
  kind: NodeKind.MetaSection;
  entries: MetaEntryNode[];
}

export interface MetaEntryNode extends BaseNode {
  kind: NodeKind.MetaEntry;
  key: string;
  expr: ExprNode;
}

export interface BinaryExprNode extends BaseNode {
  kind: NodeKind.BinaryExpr;
  op: BinaryOp;
  left: ExprNode;
  right: ExprNode;
}

export interface UnaryExprNode extends BaseNode {
  kind: NodeKind.UnaryExpr;
  op: UnaryOp;
  operand: ExprNode;
}

export interface KeywordExprNode extends BaseNode {
  kind: NodeKind.KeywordExpr;
  name: string;
}

export interface NumberLiteralNode extends BaseNode {
  kind: NodeKind.NumberLiteral;
  value: number;
}

export interface IdentifierNode extends BaseNode {
  kind: NodeKind.Identifier;
  name: string;
}

export type ExprNode =
  | BinaryExprNode
  | UnaryExprNode
  | KeywordExprNode
  | NumberLiteralNode
  | IdentifierNode;

export type AstNode =
  | NipFileNode
  | NipLineNode
  | SectionNode
  | MetaSectionNode
  | MetaEntryNode
  | ExprNode;

// --- Diagnostics ---

export enum DiagnosticSeverity {
  Error = 'error',
  Warning = 'warning',
  Info = 'info',
}

export type DiagnosticTag = 'duplicate' | 'unreachable' | 'range' | 'shadowed';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  loc: SourceLocation;
  file?: string;
  line?: number;
  tag?: DiagnosticTag;
}
