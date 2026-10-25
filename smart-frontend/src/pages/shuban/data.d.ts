export interface ShubanFile {
  id: string;
  version: string;
  name: string;
  size: number;
  updatedAt: number;
}

export interface ShubanReport {
  file: string;
  size: number;
  lines: number;
  annot_total: number;
  annot_names: number;
  ctrl: Record<string, number>;
  warnings: string[];
  low_confidence: Record<string, string[]>;
  pro: { path: string | null; exists: boolean };
  geometry: Record<string, unknown>;
}

export interface ShubanToken {
  kind: string;
  line: number;
  offset: number;
  depth: number;
  name: string;
  params: string;
  op: string;
  category: string;
  description: string;
  confidence: string;
  known: boolean;
  inDefinition: boolean;
  raw: string;
}

export interface ShubanAst {
  text: string;
  warnings: string[];
  notes: string[];
  summary: { nodes: number; max_depth: number; crossed: number };
  definitions: Record<string, number>;
  macros: {
    calls: number;
    callsWithArguments: number;
    expanded: number;
    undefined: string[];
  };
}
