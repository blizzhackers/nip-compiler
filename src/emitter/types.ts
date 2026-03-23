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

export const enum DispatchStrategy {
  Switch = 'switch',
  ObjectLookup = 'object-lookup',
}

// Stats readable on unidentified items (base item properties, not magical affixes)
// Sockets (194) excluded — only visible on normal quality, not on magic/rare/unique/set
// All other stats return 0 on unid items
export const BASE_STATS = new Set([
  31,  // defense / armorclass
  21,  // mindamage (base)
  22,  // maxdamage (base)
  23,  // secondary mindamage
  24,  // secondary maxdamage
  72,  // durability
  73,  // maxdurability
  70,  // quantity (stackable items)
]);

export function getAliasMap(aliases: AliasMapSet, keyword: string): Record<string, number> | null {
  switch (keyword) {
    case 'name': case 'classid': return aliases.classId;
    case 'type': return aliases.type;
    case 'quality': return aliases.quality;
    case 'flag': return aliases.flag;
    case 'color': return aliases.color;
    case 'class': return aliases.class;
    default: return null;
  }
}

export interface EmitterConfig {
  aliases: AliasMapSet;
  includeSourceComments?: boolean;
  dispatchStrategy?: DispatchStrategy;
  prettyPrint?: boolean;
  minify?: boolean;
}
