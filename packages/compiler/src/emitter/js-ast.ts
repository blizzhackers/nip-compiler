/**
 * ESTree AST builder helpers.
 * Every function optionally accepts a NIP source location which gets
 * converted to an ESTree SourceLocation for source map generation.
 */
import type * as ESTree from 'estree';

export interface NipLoc {
  source?: string;
  line: number;
  col: number;
  end?: number;
}

function toLoc(nip: NipLoc): ESTree.SourceLocation {
  return {
    source: nip.source ?? null,
    start: { line: nip.line, column: nip.col - 1 },
    end: { line: nip.line, column: (nip.end ?? nip.col) - 1 },
  };
}

function mayLoc(nip?: NipLoc | null): { loc?: ESTree.SourceLocation } {
  return nip ? { loc: toLoc(nip) } : {};
}

// ── Statements ──────────────────────────────────────────────

export function program(body: (ESTree.Statement | ESTree.ModuleDeclaration)[]): ESTree.Program {
  return { type: 'Program', sourceType: 'script', body };
}

export function moduleProgram(body: (ESTree.Statement | ESTree.ModuleDeclaration)[]): ESTree.Program {
  return { type: 'Program', sourceType: 'module', body };
}

export function block(body: ESTree.Statement[]): ESTree.BlockStatement {
  return { type: 'BlockStatement', body };
}

export function fnDecl(
  id: string,
  params: string[],
  body: ESTree.Statement[],
  nip?: NipLoc,
): ESTree.FunctionDeclaration {
  return {
    type: 'FunctionDeclaration',
    id: ident(id),
    params: params.map(p => ident(p)),
    body: block(body),
    ...mayLoc(nip),
  };
}

export function fnExpr(
  params: string[],
  body: ESTree.Statement[],
  nip?: NipLoc,
): ESTree.FunctionExpression {
  return {
    type: 'FunctionExpression',
    id: null,
    params: params.map(p => ident(p)),
    body: block(body),
    ...mayLoc(nip),
  };
}

export function varDecl(
  kind: 'const' | 'let' | 'var',
  declarations: { id: string; init?: ESTree.Expression }[],
): ESTree.VariableDeclaration {
  return {
    type: 'VariableDeclaration',
    kind,
    declarations: declarations.map(d => ({
      type: 'VariableDeclarator' as const,
      id: ident(d.id),
      init: d.init ?? null,
    })),
  };
}

export function ifStmt(
  test: ESTree.Expression,
  consequent: ESTree.Statement[],
  alternate?: ESTree.Statement | ESTree.Statement[],
  nip?: NipLoc,
): ESTree.IfStatement {
  const alt = alternate
    ? Array.isArray(alternate) ? block(alternate) : alternate
    : null;
  return {
    type: 'IfStatement',
    test,
    consequent: block(consequent),
    alternate: alt,
    ...mayLoc(nip),
  };
}

export function switchStmt(
  discriminant: ESTree.Expression,
  cases: ESTree.SwitchCase[],
): ESTree.SwitchStatement {
  return { type: 'SwitchStatement', discriminant, cases };
}

export function switchCase(
  test: ESTree.Expression | null,
  consequent: ESTree.Statement[],
): ESTree.SwitchCase {
  return { type: 'SwitchCase', test, consequent };
}

export function returnStmt(argument?: ESTree.Expression): ESTree.ReturnStatement {
  return { type: 'ReturnStatement', argument: argument ?? null };
}

export function exprStmt(expression: ESTree.Expression): ESTree.ExpressionStatement {
  return { type: 'ExpressionStatement', expression };
}

export function breakStmt(): ESTree.BreakStatement {
  return { type: 'BreakStatement', label: null };
}

export function emptyStmt(): ESTree.EmptyStatement {
  return { type: 'EmptyStatement' };
}

// ── Expressions ─────────────────────────────────────────────

export function ident(name: string): ESTree.Identifier {
  return { type: 'Identifier', name };
}

export function literal(value: number | string | boolean | null): ESTree.Literal {
  return { type: 'Literal', value };
}

export function bin(
  operator: ESTree.BinaryExpression['operator'],
  left: ESTree.Expression,
  right: ESTree.Expression,
  nip?: NipLoc,
): ESTree.BinaryExpression {
  return { type: 'BinaryExpression', operator, left, right, ...mayLoc(nip) };
}

export function logical(
  operator: '&&' | '||',
  left: ESTree.Expression,
  right: ESTree.Expression,
  nip?: NipLoc,
): ESTree.LogicalExpression {
  return { type: 'LogicalExpression', operator, left, right, ...mayLoc(nip) };
}

export function unary(
  operator: ESTree.UnaryExpression['operator'],
  argument: ESTree.Expression,
): ESTree.UnaryExpression {
  return { type: 'UnaryExpression', operator, argument, prefix: true };
}

export function assign(
  left: ESTree.Pattern,
  right: ESTree.Expression,
): ESTree.AssignmentExpression {
  return { type: 'AssignmentExpression', operator: '=', left, right };
}

export function call(
  callee: ESTree.Expression,
  args: ESTree.Expression[],
  nip?: NipLoc,
): ESTree.CallExpression {
  return { type: 'CallExpression', callee, arguments: args, optional: false, ...mayLoc(nip) };
}

export function member(
  object: ESTree.Expression,
  property: string,
): ESTree.MemberExpression {
  return { type: 'MemberExpression', object, property: ident(property), computed: false, optional: false };
}

export function memberComputed(
  object: ESTree.Expression,
  property: ESTree.Expression,
): ESTree.MemberExpression {
  return { type: 'MemberExpression', object, property, computed: true, optional: false };
}

export function cond(
  test: ESTree.Expression,
  consequent: ESTree.Expression,
  alternate: ESTree.Expression,
): ESTree.ConditionalExpression {
  return { type: 'ConditionalExpression', test, consequent, alternate };
}

export function array(elements: (ESTree.Expression | null)[]): ESTree.ArrayExpression {
  return { type: 'ArrayExpression', elements: elements as (ESTree.Expression | ESTree.SpreadElement | null)[] };
}

export function object(
  properties: { key: string; value: ESTree.Expression }[],
): ESTree.ObjectExpression {
  return {
    type: 'ObjectExpression',
    properties: properties.map(p => ({
      type: 'Property' as const,
      key: ident(p.key),
      value: p.value,
      kind: 'init' as const,
      method: false,
      shorthand: false,
      computed: false,
    })),
  };
}

export function seq(...expressions: ESTree.Expression[]): ESTree.SequenceExpression {
  return { type: 'SequenceExpression', expressions };
}

// ── Comments ────────────────────────────────────────────────

export function withLeadingComment<T extends ESTree.Node>(node: T, text: string): T {
  const comment: ESTree.Comment = { type: 'Line', value: text };
  (node as any).leadingComments = [...((node as any).leadingComments ?? []), comment];
  return node;
}

// ── Export helpers ──────────────────────────────────────────

export function exportDefault(declaration: ESTree.FunctionDeclaration): ESTree.ExportDefaultDeclaration {
  return { type: 'ExportDefaultDeclaration', declaration };
}
