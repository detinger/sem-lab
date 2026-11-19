// @vitest-environment node
/**
 * Phase 0 spike (b: automatic layout): what elkjs really does in this environment.
 * Findings are summarised in docs/validation/phase-0/web-spike.md; measurements are written to
 * docs/validation/phase-0/evidence/web/elk-*.json when SEM_WRITE_EVIDENCE=1.
 */
import ElkApi from 'elkjs/lib/elk-api.js';
import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from 'elkjs/lib/elk-api';
import ELK from 'elkjs/lib/elk.bundled.js';
import ElkMain from 'elkjs';
import { describe, expect, it } from 'vitest';

import {
  BASE_LAYOUT_OPTIONS,
  isAxisAligned,
  median,
  nodeBox,
  overlappingPairs,
  positionDelta,
  round3,
  sectionPoints,
  snapshot,
  structuralEdgeId,
  toConstructOnlyElkGraph,
  toFlatElkGraph,
  type LayoutSnapshot,
} from './support/elk-helpers';
import { writeEvidence } from './support/evidence';
import { counts, syntheticModel, tamV1, type SpikeModel } from './support/sem-graphs';

const elk = new ELK();

const anyNumber = (): number => expect.any(Number) as number;
const stringContaining = (text: string): string => expect.stringContaining(text) as string;

async function layoutFlat(
  model: SpikeModel,
  options: Parameters<typeof toFlatElkGraph>[1] = {},
): Promise<LayoutSnapshot> {
  return snapshot(await elk.layout(toFlatElkGraph(model, options)));
}

function port(id: string, side: 'NORTH' | 'EAST' | 'SOUTH' | 'WEST', index?: number): ElkPort {
  const layoutOptions: LayoutOptions = { 'elk.port.side': side };
  if (index !== undefined) {
    layoutOptions['elk.port.index'] = String(index);
  }
  return { id, width: 1, height: 1, layoutOptions };
}

function findChild(graph: ElkNode, id: string): ElkNode {
  const child = graph.children?.find((c) => c.id === id);
  if (!child) {
    throw new Error(`child ${id} missing`);
  }
  return child;
}

function findPort(node: ElkNode, id: string): Required<Pick<ElkPort, 'x' | 'y'>> & ElkPort {
  const found = node.ports?.find((p) => p.id === id);
  if (found?.x === undefined || found.y === undefined) {
    throw new Error(`port ${id} missing or unplaced`);
  }
  return { ...found, x: found.x, y: found.y };
}

describe('elkjs entry points', () => {
  it('elk.bundled.js lays out a graph on the calling thread with no worker', async () => {
    const result = await new ELK().layout(toFlatElkGraph(tamV1));
    expect(result.children).toHaveLength(27);
    expect(typeof result.width).toBe('number');
  });

  it("the package main ('elkjs') also works in Node and gives the same coordinates", async () => {
    const viaMain = snapshot(await new ElkMain().layout(toFlatElkGraph(tamV1)));
    const viaBundled = await layoutFlat(tamV1);
    expect(viaMain).toEqual(viaBundled);
  });

  it('elk-api.js cannot be constructed without a workerUrl or workerFactory', () => {
    expect(() => new ElkApi()).toThrow(/workerUrl.*workerFactory/);
  });

  it('there is no global Worker in the node test environment', () => {
    expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe('undefined');
  });

  it('layout() writes into the graph object it was given (bundled build)', async () => {
    const graph = toFlatElkGraph(tamV1);
    const result = await elk.layout(graph);
    expect(result).toBe(graph);
    expect(graph.children?.[0]?.x).toBeTypeOf('number');
  });
});

describe('elkjs layered layout of tam-v1 (5 constructs, 22 indicators)', () => {
  it('places every node without overlap and routes every edge', async () => {
    expect(counts(tamV1)).toEqual({
      constructs: 5,
      indicators: 22,
      structuralPaths: 6,
      measurementEdges: 22,
    });

    const snap = await layoutFlat(tamV1);
    expect(Object.keys(snap.nodes)).toHaveLength(27);
    expect(Object.keys(snap.edges)).toHaveLength(28);
    expect(overlappingPairs(snap)).toEqual([]);

    for (const box of Object.values(snap.nodes)) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(snap.width);
      expect(box.y + box.height).toBeLessThanOrEqual(snap.height);
    }
    for (const points of Object.values(snap.edges)) {
      // every edge comes back with one section: start point, optional bend points, end point
      expect(points.length).toBeGreaterThanOrEqual(2);
      expect(isAxisAligned(points)).toBe(true);
    }
  });

  it('DETERMINISM: three runs with identical input give bit-identical coordinates', async () => {
    const first = await layoutFlat(tamV1);
    const second = await layoutFlat(tamV1);
    const third = await layoutFlat(tamV1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // toEqual on numbers is exact; make the "no epsilon" claim explicit as well
    expect(positionDelta(first, second).maxDelta).toBe(0);
    expect(positionDelta(first, third).maxDelta).toBe(0);
  });

  it('INPUT ORDER MATTERS: shuffling children/edges changes coordinates; sorting ids fixes it', async () => {
    const seeds = [10, 20, 30, 40, 50];
    const reference = await layoutFlat(tamV1);

    const shuffledRuns = [];
    for (const seed of seeds) {
      const delta = positionDelta(reference, await layoutFlat(tamV1, { shuffleSeed: seed }));
      shuffledRuns.push({ seed, ...delta, maxDelta: round3(delta.maxDelta) });
      // The same model in a different array order is laid out differently.
      expect(delta.moved).toBeGreaterThan(0);
    }

    const sortedReference = await layoutFlat(tamV1, { sortById: true });
    const sortedRuns = [];
    for (const seed of seeds) {
      const sorted = await layoutFlat(tamV1, { shuffleSeed: seed, sortById: true });
      expect(sorted).toEqual(sortedReference);
      sortedRuns.push({ seed, ...positionDelta(sortedReference, sorted) });
    }

    // considerModelOrder does not remove the dependence on input order either.
    const modelOrder: LayoutOptions = {
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    };
    const modelOrderReference = await layoutFlat(tamV1, { layoutOptions: modelOrder });
    const modelOrderRuns = [];
    for (const seed of seeds) {
      const delta = positionDelta(
        modelOrderReference,
        await layoutFlat(tamV1, { layoutOptions: modelOrder, shuffleSeed: seed }),
      );
      modelOrderRuns.push({ seed, ...delta, maxDelta: round3(delta.maxDelta) });
      expect(delta.moved).toBeGreaterThan(0);
    }

    // elk.randomSeed = 0 seeds from the clock. Recorded, not asserted: two runs can coincide.
    const seedZero: LayoutOptions = { 'elk.randomSeed': '0' };
    const seedZeroLayouts = new Set<string>();
    for (let run = 0; run < 6; run += 1) {
      seedZeroLayouts.add(JSON.stringify(await layoutFlat(tamV1, { layoutOptions: seedZero })));
    }

    writeEvidence('elk-determinism.json', ['elkjs'], {
      model: 'tam-v1',
      graph: counts(tamV1),
      layoutOptions: BASE_LAYOUT_OPTIONS,
      identicalInputThreeRuns: { identical: true, maxDelta: 0 },
      shuffledInput: {
        conclusion: 'coordinates change when the children/edges array order changes',
        runs: shuffledRuns,
      },
      shuffledThenSortedById: {
        conclusion: 'sorting children and edges by id before layout restores identical output',
        runs: sortedRuns,
      },
      considerModelOrderNodesAndEdges: {
        conclusion: 'still depends on input order',
        runs: modelOrderRuns,
      },
      randomSeedZero: {
        note: 'observation only, not asserted',
        runs: 6,
        distinctLayouts: seedZeroLayouts.size,
      },
      referenceLayout: reference,
    });
  });
});

describe('elkjs layout options we intend to use', () => {
  it.each([
    ['RIGHT', (a: number, b: number) => a < b, 'x'],
    ['LEFT', (a: number, b: number) => a > b, 'x'],
    ['DOWN', (a: number, b: number) => a < b, 'y'],
    ['UP', (a: number, b: number) => a > b, 'y'],
  ] as const)(
    'elk.direction=%s orders every structural path along that axis',
    async (direction, ordered, axis) => {
      const snap = await layoutFlat(tamV1, { layoutOptions: { 'elk.direction': direction } });
      for (const [from, to] of tamV1.paths) {
        expect(ordered(nodeBox(snap, from)[axis], nodeBox(snap, to)[axis])).toBe(true);
      }
      expect(overlappingPairs(snap)).toEqual([]);
    },
  );

  it('spacing options control the gaps inside and between layers', async () => {
    const measure = async (nodeNode: number, betweenLayers: number, edgeNode?: number) => {
      const layoutOptions: LayoutOptions = {
        'elk.spacing.nodeNode': String(nodeNode),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(betweenLayers),
      };
      if (edgeNode !== undefined) {
        layoutOptions['elk.spacing.edgeNode'] = String(edgeNode);
      }
      const snap = await layoutFlat(tamV1, { layoutOptions });
      // direction RIGHT: a layer is a set of nodes sharing an x coordinate
      const layers = new Map<number, { y: number; bottom: number; right: number }[]>();
      for (const box of Object.values(snap.nodes)) {
        const layer = layers.get(box.x) ?? [];
        layer.push({ y: box.y, bottom: box.y + box.height, right: box.x + box.width });
        layers.set(box.x, layer);
      }
      const xs = [...layers.keys()].sort((a, b) => a - b);
      let minBetweenLayers = Number.POSITIVE_INFINITY;
      let minWithinLayer = Number.POSITIVE_INFINITY;
      xs.forEach((x, index) => {
        const layer = (layers.get(x) ?? []).sort((a, b) => a.y - b.y);
        for (let i = 1; i < layer.length; i += 1) {
          const gap = (layer[i]?.y ?? 0) - (layer[i - 1]?.bottom ?? 0);
          minWithinLayer = Math.min(minWithinLayer, gap);
        }
        const nextX = xs[index + 1];
        if (nextX !== undefined) {
          const right = Math.max(...layer.map((n) => n.right));
          minBetweenLayers = Math.min(minBetweenLayers, nextX - right);
        }
      });
      return {
        nodeNode,
        betweenLayers,
        edgeNode: edgeNode ?? 'default (10)',
        layers: xs.length,
        minWithinLayer: round3(minWithinLayer),
        minBetweenLayers: round3(minBetweenLayers),
        width: round3(snap.width),
        height: round3(snap.height),
      };
    };

    // SURPRISE: where a long edge passes between two nodes of a layer, the gap is
    // 2 * elk.spacing.edgeNode + 1 (edge thickness), NOT elk.spacing.nodeNode. With the default
    // edgeNode of 10 that is 21, which is below the nodeNode value of 24 we asked for.
    const defaults = await measure(24, 80);
    expect(defaults.minWithinLayer).toBe(21);
    expect(defaults.minBetweenLayers).toBeGreaterThanOrEqual(80);

    // Setting edgeNode to at least half of nodeNode restores the guarantee.
    const compact = await measure(24, 80, 12);
    const roomy = await measure(48, 160, 24);
    expect(compact.minWithinLayer).toBeGreaterThanOrEqual(24);
    expect(compact.minBetweenLayers).toBeGreaterThanOrEqual(80);
    expect(roomy.minWithinLayer).toBeGreaterThanOrEqual(48);
    expect(roomy.minBetweenLayers).toBeGreaterThanOrEqual(160);
    expect(roomy.width).toBeGreaterThan(compact.width);
    expect(roomy.height).toBeGreaterThan(compact.height);

    writeEvidence('elk-spacing.json', ['elkjs'], {
      rule: 'gap between two same-layer nodes with an edge passing between them = 2 * elk.spacing.edgeNode + 1',
      defaults,
      compact,
      roomy,
    });
  });

  it('a FLAT layered layout does not produce the classic SEM picture', async () => {
    const inspect = async (layoutOptions: LayoutOptions) => {
      const snap = await layoutFlat(tamV1, { layoutOptions });
      const blocks = tamV1.blocks.map((block) => {
        const top = [...block.indicators].sort((a, b) => nodeBox(snap, a).y - nodeBox(snap, b).y);
        return {
          construct: block.construct,
          indicatorsTopToBottom: top,
          inModelOrder: top.join() === block.indicators.join(),
        };
      });
      return {
        blocks,
        // measurement edges are ordinary layer-forming edges, so PU's indicators sit in the same
        // layer as the next construct
        puIndicatorsShareLayerWithAtu: nodeBox(snap, 'USEF1').x === nodeBox(snap, 'ATU').x,
      };
    };

    const defaults = await inspect({});
    expect(defaults.puIndicatorsShareLayerWithAtu).toBe(true);
    expect(defaults.blocks.some((b) => !b.inModelOrder)).toBe(true);

    const modelOrder = await inspect({
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    });

    writeEvidence('elk-flat-layout-shape.json', ['elkjs'], {
      conclusion:
        'lay out the structural graph with ELK and place each indicator fan ourselves, or model blocks as compound nodes',
      defaults,
      considerModelOrderNodesAndEdges: modelOrder,
    });
  });

  it('port constraints: FIXED_SIDE / FIXED_ORDER / FIXED_POS behave as documented below', async () => {
    const build = (constraint: string, indexOf: (k: number) => number): ElkNode => {
      const construct = (id: string): ElkNode => ({
        id,
        width: 118,
        height: 64,
        layoutOptions: { 'elk.portConstraints': constraint },
        ports: [
          port(`${id}.in`, 'WEST'),
          port(`${id}.out`, 'EAST'),
          port(`${id}.m1`, 'SOUTH', indexOf(1)),
          port(`${id}.m2`, 'SOUTH', indexOf(2)),
          port(`${id}.m3`, 'SOUTH', indexOf(3)),
        ],
      });
      const indicator = (id: string): ElkNode => ({
        id,
        width: 118,
        height: 34,
        layoutOptions: { 'elk.portConstraints': constraint },
        ports: [port(`${id}.top`, 'NORTH')],
      });
      const edges: ElkExtendedEdge[] = [
        { id: 'A-B', sources: ['A.out'], targets: ['B.in'] },
        { id: 'B-C', sources: ['B.out'], targets: ['C.in'] },
        { id: 'A-C', sources: ['A.out'], targets: ['C.in'] },
      ];
      for (const c of ['A', 'B', 'C']) {
        for (const k of [1, 2, 3]) {
          const target = `${c.toLowerCase()}${String(k)}.top`;
          edges.push({
            id: `${c}-m${String(k)}`,
            sources: [`${c}.m${String(k)}`],
            targets: [target],
          });
        }
      }
      return {
        id: 'root',
        layoutOptions: BASE_LAYOUT_OPTIONS,
        children: [
          construct('A'),
          construct('B'),
          construct('C'),
          ...['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'].map(indicator),
        ],
        edges,
      };
    };

    const sides = (node: ElkNode) => {
      const side = (p: ElkPort & { x: number; y: number }) =>
        p.y >= (node.height ?? 0)
          ? 'SOUTH'
          : p.y + (p.height ?? 0) <= 0
            ? 'NORTH'
            : p.x >= (node.width ?? 0)
              ? 'EAST'
              : p.x + (p.width ?? 0) <= 0
                ? 'WEST'
                : 'INSIDE';
      return Object.fromEntries(
        (node.ports ?? []).map((p) => [p.id, side(findPort(node, p.id))] as const),
      );
    };

    const identity = (k: number) => k - 1;
    const observed: Record<string, unknown> = {};

    // Without a constraint, elk.port.side is ignored: ELK moves the "SOUTH" ports where it likes.
    for (const constraint of ['UNDEFINED', 'FREE']) {
      const result = await elk.layout(build(constraint, identity));
      observed[constraint] = sides(findChild(result, 'A'));
    }

    for (const constraint of ['FIXED_SIDE', 'FIXED_ORDER']) {
      const result = await elk.layout(build(constraint, identity));
      const a = findChild(result, 'A');
      observed[constraint] = sides(a);
      expect(sides(a)).toEqual({
        'A.in': 'WEST',
        'A.out': 'EAST',
        'A.m1': 'SOUTH',
        'A.m2': 'SOUTH',
        'A.m3': 'SOUTH',
      });
      expect(sides(findChild(result, 'a1'))).toEqual({ 'a1.top': 'NORTH' });
      // edges are anchored on the port, so a SOUTH port edge leaves below the node
      const edge = result.edges?.find((e) => e.id === 'A-m1');
      const start = edge?.sections?.[0]?.startPoint;
      expect(start?.y).toBeGreaterThanOrEqual((a.y ?? 0) + (a.height ?? 0));
    }

    // FIXED_ORDER follows elk.port.index, counted clockwise: on the SOUTH side that is right-to-left.
    const permuted = (k: number) => [2, 0, 1][k - 1] ?? 0; // m1 -> 2, m2 -> 0, m3 -> 1
    const ordered = await elk.layout(build('FIXED_ORDER', permuted));
    const a = findChild(ordered, 'A');
    const southLeftToRight = ['A.m1', 'A.m2', 'A.m3']
      .map((id) => findPort(a, id))
      .sort((p, q) => p.x - q.x)
      .map((p) => p.id);
    observed.FIXED_ORDER_permutedIndex = {
      index: { 'A.m1': 2, 'A.m2': 0, 'A.m3': 1 },
      southPortsLeftToRight: southLeftToRight,
    };
    expect(southLeftToRight).toEqual(['A.m1', 'A.m3', 'A.m2']);

    // FIXED_POS keeps the port coordinates we supply (explicit handle positions).
    const fixedPos: ElkNode = {
      id: 'root',
      layoutOptions: BASE_LAYOUT_OPTIONS,
      children: [
        {
          id: 'A',
          width: 118,
          height: 64,
          layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
          ports: [{ id: 'A.out', x: 118, y: 31.5, width: 1, height: 1 }],
        },
        {
          id: 'B',
          width: 118,
          height: 64,
          layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
          ports: [{ id: 'B.in', x: -1, y: 10, width: 1, height: 1 }],
        },
      ],
      edges: [{ id: 'A-B', sources: ['A.out'], targets: ['B.in'] }],
    };
    const fixed = await elk.layout(fixedPos);
    const fa = findChild(fixed, 'A');
    const fb = findChild(fixed, 'B');
    expect(findPort(fa, 'A.out')).toMatchObject({ x: 118, y: 31.5 });
    expect(findPort(fb, 'B.in')).toMatchObject({ x: -1, y: 10 });
    const section = fixed.edges?.[0]?.sections?.[0];
    expect(section?.startPoint.y).toBeCloseTo((fa.y ?? 0) + 31.5 + 0.5, 6);
    expect(section?.endPoint.y).toBeCloseTo((fb.y ?? 0) + 10 + 0.5, 6);
    observed.FIXED_POS = {
      'A.out': findPort(fa, 'A.out'),
      'B.in': findPort(fb, 'B.in'),
      edgeSection: section,
    };

    writeEvidence('elk-ports.json', ['elkjs'], observed);
  });

  it('edge routing: ORTHOGONAL, POLYLINE and SPLINES all return drawable sections', async () => {
    const summary: Record<string, unknown> = {};
    for (const routing of ['ORTHOGONAL', 'POLYLINE', 'SPLINES'] as const) {
      const result = await elk.layout(
        toFlatElkGraph(tamV1, { layoutOptions: { 'elk.edgeRouting': routing } }),
      );
      const edges = result.edges ?? [];
      expect(edges).toHaveLength(28);

      let bendPoints = 0;
      let axisAligned = 0;
      let cubicCompatible = 0;
      for (const edge of edges) {
        // exactly one section per edge in a flat graph, always with start and end
        expect(edge.sections).toHaveLength(1);
        const section = edge.sections?.[0];
        expect(section?.startPoint).toEqual({ x: anyNumber(), y: anyNumber() });
        expect(section?.endPoint).toEqual({ x: anyNumber(), y: anyNumber() });
        const bends = section?.bendPoints?.length ?? 0;
        bendPoints += bends;
        if (isAxisAligned(sectionPoints(edge))) {
          axisAligned += 1;
        }
        // start + bends + end must be 3k + 1 points to be read as k cubic Bezier segments
        if ((bends + 1) % 3 === 0 || bends === 0) {
          cubicCompatible += 1;
        }
      }
      summary[routing] = {
        edges: edges.length,
        totalBendPoints: bendPoints,
        axisAlignedEdges: axisAligned,
        edgesReadableAsCubicBezier: cubicCompatible,
        sample: edges.find((e) => e.id === structuralEdgeId('PEOU', 'ATU'))?.sections,
      };
      if (routing === 'ORTHOGONAL') {
        expect(axisAligned).toBe(edges.length);
      } else {
        // the other two styles really are different geometry, not an ignored option
        expect(axisAligned).toBeLessThan(edges.length);
      }
      if (routing === 'SPLINES') {
        expect(cubicCompatible).toBe(edges.length);
      }
    }
    writeEvidence('elk-edge-routing.json', ['elkjs'], summary);
  });

  it('edge labels are given positions and the layout makes room for them', async () => {
    const withLabels = (labelled: boolean): ElkNode => {
      const graph = toConstructOnlyElkGraph(tamV1, { width: 118, height: 64 });
      if (labelled) {
        for (const edge of graph.edges ?? []) {
          edge.labels = [{ id: `${edge.id}:label`, text: '0.432***', width: 56, height: 18 }];
        }
      }
      return graph;
    };
    const plain = snapshot(await elk.layout(withLabels(false)));
    const result = await elk.layout(withLabels(true));
    const labelled = snapshot(result);

    const labels = (result.edges ?? []).map((edge) => {
      const label = edge.labels?.[0];
      expect(label?.x).toBeTypeOf('number');
      expect(label?.y).toBeTypeOf('number');
      return { edge: edge.id, x: label?.x ?? 0, y: label?.y ?? 0, width: 56, height: 18 };
    });
    // no label box overlaps a node box
    for (const label of labels) {
      for (const box of Object.values(labelled.nodes)) {
        const separate =
          label.x + label.width <= box.x ||
          box.x + box.width <= label.x ||
          label.y + label.height <= box.y ||
          box.y + box.height <= label.y;
        expect(separate).toBe(true);
      }
    }
    expect(labelled.width).toBeGreaterThan(plain.width);

    writeEvidence('elk-edge-labels.json', ['elkjs'], {
      widthWithoutLabels: plain.width,
      widthWithLabels: labelled.width,
      labels,
    });
  });

  it('compound nodes: children are relative to the parent; cross-hierarchy edges need INCLUDE_CHILDREN', async () => {
    const group = (c: string): ElkNode => ({
      id: `g${c}`,
      layoutOptions: { 'elk.padding': '[top=20,left=20,bottom=20,right=20]' },
      children: [
        { id: c, width: 118, height: 64 },
        ...[1, 2, 3].map((k) => ({ id: `${c.toLowerCase()}${String(k)}`, width: 118, height: 34 })),
      ],
      edges: [1, 2, 3].map((k) => ({
        id: `${c}-${String(k)}`,
        sources: [c],
        targets: [`${c.toLowerCase()}${String(k)}`],
      })),
    });
    const build = (hierarchyHandling?: string): ElkNode => ({
      id: 'root',
      layoutOptions: {
        ...BASE_LAYOUT_OPTIONS,
        ...(hierarchyHandling ? { 'elk.hierarchyHandling': hierarchyHandling } : {}),
      },
      children: [group('A'), group('B')],
      edges: [{ id: 'A-B', sources: ['A'], targets: ['B'] }],
    });

    const included = await elk.layout(build('INCLUDE_CHILDREN'));
    const gA = findChild(included, 'gA');
    const inner = findChild(gA, 'A');
    // child coordinates are relative to the group, and ELK sized the group around its content
    expect(inner.x).toBe(20);
    expect((inner.x ?? 0) + 118).toBeLessThanOrEqual(gA.width ?? 0);
    const cross = included.edges?.[0];
    expect(cross?.sections).toHaveLength(1);
    expect(cross?.container).toBe('root');
    expect(gA.edges?.[0]?.container).toBe('gA');

    // Default hierarchy handling silently returns the cross-hierarchy edge with NO route.
    const separate = await elk.layout(build());
    expect(separate.edges?.[0]?.sections).toBeUndefined();

    writeEvidence('elk-compound.json', ['elkjs'], {
      INCLUDE_CHILDREN: {
        group: { x: gA.x, y: gA.y, width: gA.width, height: gA.height },
        childRelativeToGroup: { x: inner.x, y: inner.y },
        crossHierarchyEdge: cross,
      },
      defaultHandling: { crossHierarchyEdge: separate.edges?.[0] },
    });
  });

  it('unknown option keys and invalid enum values are accepted SILENTLY; unknown algorithms reject', async () => {
    const reference = await layoutFlat(tamV1);
    const typoValue = await layoutFlat(tamV1, { layoutOptions: { 'elk.direction': 'SIDEWAYS' } });
    const typoKey = await layoutFlat(tamV1, { layoutOptions: { 'elk.noSuchOption': 'x' } });
    // no error, and the layout silently falls back to the default (identical to RIGHT here)
    expect(typoValue).toEqual(reference);
    expect(typoKey).toEqual(reference);

    await expect(
      elk.layout(toFlatElkGraph(tamV1, { layoutOptions: { 'elk.algorithm': 'nope' } })),
    ).rejects.toMatchObject({ message: stringContaining("Layout algorithm 'nope' not found") });
  });

  it('the installed build knows every option id we plan to use', async () => {
    const options = await elk.knownLayoutOptions();
    const algorithms = await elk.knownLayoutAlgorithms();
    const ids = new Set(options.map((o) => o.id));

    const planned = [
      'org.eclipse.elk.algorithm',
      'org.eclipse.elk.direction',
      'org.eclipse.elk.edgeRouting',
      'org.eclipse.elk.randomSeed',
      'org.eclipse.elk.padding',
      'org.eclipse.elk.hierarchyHandling',
      'org.eclipse.elk.portConstraints',
      'org.eclipse.elk.port.side',
      'org.eclipse.elk.port.index',
      'org.eclipse.elk.spacing.nodeNode',
      'org.eclipse.elk.spacing.edgeNode',
      'org.eclipse.elk.spacing.edgeEdge',
      'org.eclipse.elk.spacing.edgeLabel',
      'org.eclipse.elk.spacing.componentComponent',
      'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers',
      'org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers',
      'org.eclipse.elk.layered.spacing.edgeEdgeBetweenLayers',
      'org.eclipse.elk.layered.considerModelOrder.strategy',
      'org.eclipse.elk.layered.crossingMinimization.strategy',
      'org.eclipse.elk.layered.nodePlacement.strategy',
      'org.eclipse.elk.layered.layering.strategy',
      'org.eclipse.elk.layered.cycleBreaking.strategy',
      'org.eclipse.elk.layered.mergeEdges',
      'org.eclipse.elk.edgeLabels.placement',
      'org.eclipse.elk.edgeLabels.inline',
      'org.eclipse.elk.separateConnectedComponents',
      'org.eclipse.elk.partitioning.activate',
      'org.eclipse.elk.partitioning.partition',
    ];
    const missing = planned.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
    expect(algorithms.map((a) => a.id)).toContain('org.eclipse.elk.layered');

    writeEvidence('elk-known-options.json', ['elkjs'], {
      note: 'knownLayoutOptions() reports ids and value TYPES only; it does not list enum members.',
      algorithms: algorithms.map((a) => a.id),
      optionCount: options.length,
      plannedOptionsPresent: planned,
      options: options
        .map((o) => ({ id: o.id, type: o.type, targets: o.targets, group: o.group }))
        .sort((a, b) => ((a.id ?? '') < (b.id ?? '') ? -1 : 1)),
    });
  });
});

describe('elkjs layout timing (bundled build, calling thread)', () => {
  it(
    'lays out 15c/60i and 50c/300i graphs within an interactive budget',
    { timeout: 120_000 },
    async () => {
      const time = async (build: () => ElkNode, runs: number) => {
        const timer = new ELK(); // fresh instance: the first layout includes engine warm-up
        const samples: number[] = [];
        let size = { width: 0, height: 0 };
        for (let run = 0; run < runs; run += 1) {
          const graph = build();
          const start = performance.now();
          const result = await timer.layout(graph);
          samples.push(performance.now() - start);
          size = { width: result.width ?? 0, height: result.height ?? 0 };
        }
        const [first, ...rest] = samples;
        return {
          runs,
          firstRunMs: round3(first ?? 0),
          warmMedianMs: round3(median(rest)),
          warmMinMs: round3(Math.min(...rest)),
          warmMaxMs: round3(Math.max(...rest)),
          drawing: { width: round3(size.width), height: round3(size.height) },
        };
      };

      const medium = syntheticModel(15, 60);
      const large = syntheticModel(50, 300);
      expect(counts(medium)).toMatchObject({ constructs: 15, indicators: 60 });
      expect(counts(large)).toMatchObject({ constructs: 50, indicators: 300 });

      const blockBox = { width: 280, height: 220 }; // construct plus a fan of indicators

      const results = {
        note: 'elk.bundled.js on the calling thread, Node; firstRun includes GWT engine start-up',
        'tam-v1 flat (27 nodes, 28 edges)': {
          graph: counts(tamV1),
          ...(await time(() => toFlatElkGraph(tamV1), 7)),
        },
        'synthetic 15c/60i flat (75 nodes)': {
          graph: counts(medium),
          ...(await time(() => toFlatElkGraph(medium), 7)),
        },
        'synthetic 50c/300i flat (350 nodes)': {
          graph: counts(large),
          ...(await time(() => toFlatElkGraph(large), 7)),
        },
        'synthetic 15c constructs only': {
          graph: { constructs: 15, structuralPaths: medium.paths.length },
          ...(await time(() => toConstructOnlyElkGraph(medium, blockBox), 7)),
        },
        'synthetic 50c constructs only': {
          graph: { constructs: 50, structuralPaths: large.paths.length },
          ...(await time(() => toConstructOnlyElkGraph(large, blockBox), 7)),
        },
      };

      // Generous regression bounds; the measured values are in the evidence file.
      expect(results['synthetic 15c/60i flat (75 nodes)'].warmMedianMs).toBeLessThan(2_000);
      expect(results['synthetic 50c/300i flat (350 nodes)'].warmMedianMs).toBeLessThan(10_000);

      // large graphs stay deterministic as well
      const a = snapshot(await elk.layout(toFlatElkGraph(large)));
      const b = snapshot(await elk.layout(toFlatElkGraph(large)));
      expect(b).toEqual(a);
      expect(overlappingPairs(a)).toEqual([]);

      writeEvidence('elk-timing.json', ['elkjs'], results);
    },
  );
});
