/**
 * Graph builders for the layout spike. These are layout inputs only (ids, sizes, edges); they are
 * not the canonical model contract, which belongs to packages/contracts.
 */

export interface SpikeBlock {
  construct: string;
  indicators: string[];
}

export interface SpikeModel {
  id: string;
  blocks: SpikeBlock[];
  /** [from, to] structural regression paths between constructs. */
  paths: [from: string, to: string][];
}

/** STYLE.md section 16 minimum node geometry. */
export const CONSTRUCT_SIZE = { width: 118, height: 64 } as const;
export const INDICATOR_SIZE = { width: 118, height: 34 } as const;

/** tam-v1: SEM Lab's own specification of the Technology Acceptance Model (all reflective). */
export const tamV1: SpikeModel = {
  id: 'tam-v1',
  blocks: [
    { construct: 'PU', indicators: ['USEF1', 'USEF2', 'USEF3', 'USEF4', 'USEF5'] },
    { construct: 'PEOU', indicators: ['EOU1', 'EOU2', 'EOU3', 'EOU4', 'EOU5'] },
    { construct: 'ATU', indicators: ['ATT1', 'ATT2', 'ATT3', 'ATT4', 'ATT5'] },
    { construct: 'BI', indicators: ['BI1', 'BI2', 'BI3'] },
    { construct: 'USE', indicators: ['USE1', 'USE2', 'USE3', 'USE4'] },
  ],
  paths: [
    ['PEOU', 'PU'],
    ['PEOU', 'ATU'],
    ['PU', 'ATU'],
    ['PU', 'BI'],
    ['ATU', 'BI'],
    ['BI', 'USE'],
  ],
};

/** Small deterministic PRNG (mulberry32) so synthetic graphs and shuffles are reproducible. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = a;
  }
  return copy;
}

/**
 * Acyclic synthetic model: construct k receives paths from one to three earlier constructs, and
 * indicators are dealt round-robin so every construct has at least one.
 */
export function syntheticModel(
  constructs: number,
  indicators: number,
  seed = 20261119,
): SpikeModel {
  const random = mulberry32(seed);
  const blocks: SpikeBlock[] = Array.from({ length: constructs }, (_, k) => ({
    construct: `C${String(k + 1).padStart(2, '0')}`,
    indicators: [],
  }));
  for (let i = 0; i < indicators; i += 1) {
    const block = blocks[i % constructs] as SpikeBlock;
    block.indicators.push(`${block.construct}_x${String(block.indicators.length + 1)}`);
  }
  const paths: [string, string][] = [];
  for (let k = 1; k < constructs; k += 1) {
    const wanted = Math.min(k, 1 + Math.floor(random() * 3));
    const sources = new Set<number>();
    while (sources.size < wanted) {
      // prefer recent predecessors so the graph has depth instead of one giant fan-out
      const reach = Math.min(k, 6);
      sources.add(k - 1 - Math.floor(random() * reach));
    }
    for (const s of [...sources].sort((a, b) => a - b)) {
      paths.push([(blocks[s] as SpikeBlock).construct, (blocks[k] as SpikeBlock).construct]);
    }
  }
  return { id: `synthetic-${String(constructs)}c-${String(indicators)}i`, blocks, paths };
}

export function counts(model: SpikeModel) {
  const indicators = model.blocks.reduce((sum, b) => sum + b.indicators.length, 0);
  return {
    constructs: model.blocks.length,
    indicators,
    structuralPaths: model.paths.length,
    measurementEdges: indicators,
  };
}
