// Types for datasetShape.js — the check that a dataset's real answer matches its
// declaration (cardinality + item). The authoritative DatasetDef lives in ../dataset.ts.

export type Cardinality = 'many' | 'one';

export const CARDINALITIES: readonly Cardinality[];

/** A def's cardinality with the default ('many') applied. */
export function cardinalityOf(def: { cardinality?: Cardinality } | null | undefined): Cardinality;

/** Problems with one GET's parsed body against its declaration; [] when it fits. */
export function checkDatasetAnswer(
  def: { id: string; cardinality?: Cardinality; item?: { name: string; type: string; enum?: string[] }[] },
  body: unknown,
  opts?: { maxRows?: number },
): string[];
