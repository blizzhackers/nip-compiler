import { ExprNode, NipLineNode } from '../types.js';

export interface AliasMapSet {
  classId: Record<string, number>;
  type: Record<string, number>;
  quality: Record<string, number>;
  flag: Record<string, number>;
  stat: Record<string, number | [number, number]>;
  color: Record<string, number>;
  class: Record<string, number>;
}

export const enum DispatchKind {
  Classid = 'classid',
  Type = 'type',
}

export interface DispatchKey {
  kind: DispatchKind;
  values: number[];
  quality: number | null;
}

export interface AnalyzedLine {
  line: NipLineNode;
  lineIndex: number;
  source: string;
  dispatch: DispatchKey | null;
  tierExpr: ExprNode | null;
  mercTierExpr: ExprNode | null;
  maxQuantity: number | null;
}

export interface GroupedRule {
  line: NipLineNode;
  lineIndex: number;
  source: string;
  residualProperty: ExprNode | null;
  statExpr: ExprNode | null;
  tierExpr: ExprNode | null;
  mercTierExpr: ExprNode | null;
  maxQuantity: number | null;
}

export interface DispatchPlan {
  classidGroups: Map<number, Map<number | null, GroupedRule[]>>;
  typeGroups: Map<number, Map<number | null, GroupedRule[]>>;
  catchAll: GroupedRule[];
}

export interface EmitterConfig {
  aliases: AliasMapSet;
  includeSourceComments?: boolean;
}
