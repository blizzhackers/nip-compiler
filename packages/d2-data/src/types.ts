export interface AliasMapSet {
  classId: Record<string, number>;
  type: Record<string, number>;
  quality: Record<string, number>;
  flag: Record<string, number>;
  stat: Record<string, number | [number, number]>;
  color: Record<string, number>;
  class: Record<string, number>;
  typeToClassIds?: Record<number, number[]>;
  classIdToType?: Record<number, number>;
  typeProperties?: Record<number, { magic: boolean; rare: boolean; normal: boolean; charm: boolean }>;
}

export interface UniqueItemDef {
  name: string;
  key: string;
  code: string;
  classId: number;
  classIdName: string;
  onlyUniqueForClassId: boolean;
  props: { prop: string; par: string; min: number; max: number }[];
}

export interface SetItemDef {
  name: string;
  setName: string;
  key: string;
  setKey: string;
  code: string;
  classId: number;
  classIdName: string;
  onlySetForClassId: boolean;
  props: { prop: string; par: string; min: number; max: number }[];
}
