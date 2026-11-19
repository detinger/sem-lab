/**
 * Phase 0 spike (b: diagram foundation): @xyflow/react 12 under React 19 in jsdom.
 * Findings are summarised in docs/validation/phase-0/web-spike.md.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
  getNodesBounds,
  getStraightPath,
  getViewportForBounds,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type BackgroundProps,
  type Connection,
  type Edge,
  type EdgeProps,
  type IsValidConnection,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnNodeDrag,
  type ReactFlowInstance,
  type ReactFlowProps,
} from '@xyflow/react';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { installMeasuringDom, installResizeObserverStub } from '../support/react-flow-dom';
import { installedPackage, writeEvidence } from './support/evidence';

type ConstructNode = Node<{ label: string }, 'construct'>;
// NOTE: the type key becomes the CSS class react-flow__edge-<type> on the wrapper <g>. A type
// called 'path' would collide with React Flow's own .react-flow__edge-path class (see test below).
type PathEdge = Edge<{ kind: 'structural' }, 'structural'>;

const SIZE = { width: 118, height: 64 };

function ConstructNodeView({ data, selected }: NodeProps<ConstructNode>) {
  return (
    <div data-testid="construct-node" data-selected={selected}>
      <Handle type="target" position={Position.Left} />
      {data.label}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function PathEdgeView({ id, sourceX, sourceY, targetX, targetY }: EdgeProps<PathEdge>) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return <BaseEdge id={id} path={path} />;
}

// Defined at module scope: a new object per render makes React Flow warn and remount nodes.
const nodeTypes = { construct: ConstructNodeView };
const edgeTypes = { structural: PathEdgeView };

const handles = [
  { type: 'target' as const, position: Position.Left, x: 0, y: 32, width: 1, height: 1 },
  { type: 'source' as const, position: Position.Right, x: 118, y: 32, width: 1, height: 1 },
];

const sizedNodes = (): ConstructNode[] => [
  {
    id: 'PEOU',
    type: 'construct',
    position: { x: 0, y: 0 },
    data: { label: 'PEOU' },
    ...SIZE,
    handles,
  },
  {
    id: 'PU',
    type: 'construct',
    position: { x: 208, y: 0 },
    data: { label: 'PU' },
    ...SIZE,
    handles,
  },
];
const bareNodes = (): ConstructNode[] => [
  { id: 'PEOU', type: 'construct', position: { x: 0, y: 0 }, data: { label: 'PEOU' } },
  { id: 'PU', type: 'construct', position: { x: 208, y: 0 }, data: { label: 'PU' } },
];
const oneEdge = (): PathEdge[] => [
  {
    id: 'PEOU->PU',
    type: 'structural',
    source: 'PEOU',
    target: 'PU',
    data: { kind: 'structural' },
  },
];

interface Probe {
  instance: ReactFlowInstance<ConstructNode, PathEdge> | null;
  initialized: boolean;
}

function record(
  probe: Probe,
  instance: ReactFlowInstance<ConstructNode, PathEdge>,
  initialized: boolean,
): void {
  probe.instance = instance;
  probe.initialized = initialized;
}

function ProbeInstance({ probe }: { probe: Probe }) {
  const instance = useReactFlow<ConstructNode, PathEdge>();
  const initialized = useNodesInitialized();
  useEffect(() => {
    record(probe, instance, initialized);
  });
  return null;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </div>
    </StrictMode>
  );
}

/** Controlled flow, the way the modeler will hold nodes and edges. */
function ControlledFlow({
  initialNodes,
  probe,
  flowProps,
}: {
  initialNodes: ConstructNode[];
  probe: Probe;
  flowProps?: Partial<ReactFlowProps<ConstructNode, PathEdge>>;
}) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(oneEdge());
  const onConnect: OnConnect = (connection) => {
    flowProps?.onConnect?.(connection);
    setEdges((current) => addEdge({ ...connection, type: 'structural' }, current));
  };
  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        {...flowProps}
        onConnect={onConnect}
      />
      <ProbeInstance probe={probe} />
    </>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function consoleSpies() {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return { error, warn };
}

const observed: Record<string, unknown> = {};

afterEach(() => {
  // written repeatedly on purpose: the last test to finish leaves the complete record
  writeEvidence(
    'reactflow.json',
    ['@xyflow/react', '@xyflow/system', 'react', 'react-dom', 'jsdom'],
    observed,
  );
});

describe('@xyflow/react in jsdom: what has to be polyfilled', () => {
  it('jsdom lacks the browser APIs React Flow measures with', () => {
    const globals = globalThis as Record<string, unknown>;
    const missing = [
      'ResizeObserver',
      'DOMMatrixReadOnly',
      'IntersectionObserver',
      'Worker',
    ].filter((name) => typeof globals[name] === 'undefined');
    observed.jsdomMissingGlobals = missing;
    expect(missing).toEqual([
      'ResizeObserver',
      'DOMMatrixReadOnly',
      'IntersectionObserver',
      'Worker',
    ]);
    expect(document.createElement('div').offsetWidth).toBe(0);
  });

  it('rendering without a ResizeObserver throws', () => {
    const spies = consoleSpies();
    expect(() =>
      render(
        <Frame>
          <ReactFlow
            nodes={sizedNodes()}
            edges={oneEdge()}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
          />
        </Frame>,
      ),
    ).toThrow(/ResizeObserver is not defined/);
    spies.error.mockRestore();
    spies.warn.mockRestore();
  });

  it('ROUTE 1: a no-op ResizeObserver plus explicit width/height/handles renders nodes AND edges', async () => {
    installResizeObserverStub();
    const spies = consoleSpies();
    const probe: Probe = { instance: null, initialized: false };

    const { container } = render(
      <Frame>
        <ReactFlow
          nodes={sizedNodes()}
          edges={oneEdge()}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          snapToGrid
          snapGrid={[16, 16]}
          selectionOnDrag
          panOnDrag={[1, 2]}
          selectionMode={SelectionMode.Partial}
          connectionMode={ConnectionMode.Strict}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
        <ProbeInstance probe={probe} />
      </Frame>,
    );
    await settle();

    // custom node type
    const nodes = screen.getAllByTestId('construct-node');
    expect(nodes.map((n) => n.textContent)).toEqual(['PEOU', 'PU']);
    const wrapper = container.querySelector<HTMLElement>('.react-flow__node-construct');
    expect(wrapper?.style.visibility).toBe('visible');
    // the flow position becomes a CSS translate on the wrapper (jsdom re-serialises the value)
    const pu = container.querySelector<HTMLElement>('.react-flow__node[data-id="PU"]');
    expect(pu?.style.transform).toContain('208px');

    // custom edge type, drawn between the declared handle centres
    const edge = container.querySelector('.react-flow__edge-path');
    expect(container.querySelectorAll('.react-flow__edge-path')).toHaveLength(1);
    // anchored on the OUTER side of each declared handle box: source (x 118, w 1, right) -> 119
    expect(edge?.getAttribute('d')).toBe('M 119,32.5L 208,32.5');

    // additional components
    expect(container.querySelector('.react-flow__background')).not.toBeNull();
    expect(container.querySelector('.react-flow__background pattern circle')).not.toBeNull();
    expect(container.querySelector('.react-flow__minimap')).not.toBeNull();
    expect(container.querySelector('.react-flow__controls')).not.toBeNull();

    // React 19 + StrictMode: nothing was logged
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();

    // `measured` is NOT filled on this route, so useNodesInitialized() stays false
    expect(probe.initialized).toBe(false);
    expect(probe.instance?.getNode('PEOU')?.measured).toBeUndefined();

    observed.route1 = {
      polyfills: ['ResizeObserver (no-op)'],
      nodeRequires: ['width', 'height', 'handles'],
      edgePath: edge?.getAttribute('d'),
      useNodesInitialized: probe.initialized,
      consoleErrors: spies.error.mock.calls.length,
      consoleWarnings: spies.warn.mock.calls.length,
    };
  });

  it('without explicit sizes the nodes stay hidden and no edge is drawn', async () => {
    installResizeObserverStub();
    const { container } = render(
      <Frame>
        <ReactFlow
          nodes={bareNodes()}
          edges={oneEdge()}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
        />
      </Frame>,
    );
    await settle();
    const wrapper = container.querySelector<HTMLElement>('.react-flow__node-construct');
    expect(wrapper?.style.visibility).toBe('hidden');
    expect(container.querySelectorAll('.react-flow__edge-path')).toHaveLength(0);
  });

  it('ROUTE 2: emulated measurement fills node.measured through onNodesChange', async () => {
    const restore = installMeasuringDom(SIZE);
    const spies = consoleSpies();
    const probe: Probe = { instance: null, initialized: false };
    try {
      const { container } = render(
        <Frame>
          <ControlledFlow initialNodes={bareNodes()} probe={probe} />
        </Frame>,
      );
      await settle();

      expect(probe.instance?.getNode('PEOU')?.measured).toEqual(SIZE);
      expect(probe.initialized).toBe(true);
      expect(container.querySelectorAll('.react-flow__edge-path')).toHaveLength(1);

      // Even with measured nodes the fitView() promise does not settle under jsdom (observed
      // with 500ms waits as well). Viewport fitting has to be checked in a real browser.
      const pending = Symbol('pending');
      let fitView: boolean | typeof pending = pending;
      await act(async () => {
        fitView = await Promise.race([
          probe.instance?.fitView({ padding: 0.1 }) ?? Promise.resolve(false),
          new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), 150)),
        ]);
      });
      expect(fitView).toBe(pending);
      expect(probe.instance?.getViewport()).toEqual({ x: 0, y: 0, zoom: 1 });
      expect(spies.error).not.toHaveBeenCalled();
      expect(spies.warn).not.toHaveBeenCalled();

      observed.route2 = {
        polyfills: [
          'ResizeObserver (reports each observed element once)',
          'DOMMatrixReadOnly (only m22 is read)',
          'HTMLElement.prototype.offsetWidth / offsetHeight',
        ],
        measured: probe.instance?.getNode('PEOU')?.measured,
        useNodesInitialized: probe.initialized,
        fitViewPromise: 'does not settle under jsdom; viewport stays {x:0,y:0,zoom:1}',
      };
    } finally {
      restore();
    }
  });

  it('a firing ResizeObserver without DOMMatrixReadOnly fails', () => {
    const restore = installMeasuringDom(SIZE);
    vi.stubGlobal('DOMMatrixReadOnly', undefined);
    const spies = consoleSpies();
    try {
      expect(() =>
        render(
          <Frame>
            <ControlledFlow
              initialNodes={bareNodes()}
              probe={{ instance: null, initialized: false }}
            />
          </Frame>,
        ),
      ).toThrow();
    } finally {
      restore();
      spies.error.mockRestore();
      spies.warn.mockRestore();
    }
  });
});

describe('@xyflow/react instance helpers and interaction callbacks', () => {
  it('useReactFlow() exposes fitView / getNodesBounds; getViewportForBounds is a standalone export', async () => {
    installResizeObserverStub();
    const probe: Probe = { instance: null, initialized: false };
    render(
      <Frame>
        <ControlledFlow initialNodes={sizedNodes()} probe={probe} />
      </Frame>,
    );
    await settle();
    const instance = probe.instance;
    if (!instance) {
      throw new Error('useReactFlow() did not provide an instance');
    }

    expect(instance.fitView).toBeTypeOf('function');
    expect(instance.getNodesBounds).toBeTypeOf('function');
    expect(instance.screenToFlowPosition).toBeTypeOf('function');
    expect(instance.setViewport).toBeTypeOf('function');
    expect('getViewportForBounds' in instance).toBe(false);

    const bounds = instance.getNodesBounds(['PEOU', 'PU']);
    expect(bounds).toEqual({ x: 0, y: 0, width: 326, height: 64 });
    // the standalone util gives the same rectangle for user nodes that carry sizes
    expect(getNodesBounds(instance.getNodes())).toEqual(bounds);

    // export framing: viewport that fits `bounds` into a 1024x768 image with 10% padding
    const viewport = getViewportForBounds(bounds, 1024, 768, 0.1, 4, 0.1);
    // padding 0.1 -> floor((1024 - 1024 / 1.1) / 2) = 46px per side -> zoom = (1024 - 92) / 326
    expect(viewport.zoom).toBeCloseTo(932 / 326, 9);
    expect(viewport.x).toBeCloseTo((1024 - bounds.width * viewport.zoom) / 2, 6);
    expect(viewport.y).toBeCloseTo((768 - bounds.height * viewport.zoom) / 2, 6);

    // fitView() queues the fit and settles its promise after a later node pass. Under jsdom that
    // never happens (see ROUTE 2 as well), so the promise must not be awaited in unit tests.
    const pending = Symbol('pending');
    let fitViewResult: boolean | typeof pending = pending;
    await act(async () => {
      fitViewResult = await Promise.race([
        instance.fitView({ padding: 0.1 }),
        new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), 150)),
      ]);
    });
    expect(fitViewResult).toBe(pending);

    observed.instance = {
      methodsOnInstance: [
        'fitView',
        'fitBounds',
        'getNodesBounds',
        'screenToFlowPosition',
        'setViewport',
      ],
      standaloneExports: ['getViewportForBounds', 'getNodesBounds'],
      getNodesBounds: bounds,
      getViewportForBounds: { args: [bounds, 1024, 768, 0.1, 4, 0.1], viewport },
      fitViewPromiseInJsdomRoute1: 'never settles (no measuring pass)',
    };
  });

  it('dragging a node with snapToGrid lands on the 16px grid and calls onNodeDragStop', async () => {
    installResizeObserverStub();
    const probe: Probe = { instance: null, initialized: false };
    const onNodeDragStop = vi.fn<OnNodeDrag<ConstructNode>>();
    // PEOU deliberately starts OFF the grid, PU starts on it
    const initialNodes = sizedNodes().map((n) =>
      n.id === 'PEOU' ? { ...n, position: { x: 5, y: 131 } } : n,
    );
    const { container } = render(
      <Frame>
        <ControlledFlow
          initialNodes={initialNodes}
          probe={probe}
          // autoPanOnNodeDrag (default true) must be off under jsdom: the pane measures 0x0, so the
          // pointer always counts as "at the edge" and the auto-pan loop keeps moving the node on
          // every animation frame while the button is down.
          flowProps={{
            snapToGrid: true,
            snapGrid: [16, 16],
            autoPanOnNodeDrag: false,
            onNodeDragStop,
          }}
        />
      </Frame>,
    );
    await settle();

    // d3-drag binds its move/up listeners on event.view. In Vitest's jsdom environment
    // window === globalThis === document.defaultView, and jsdom rejects that object as a `view`;
    // the real jsdom Window is only reachable through the `jsdom` global Vitest exposes.
    const view = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;
    expect(() => new MouseEvent('mousedown', { view: window })).toThrow(/not of type Window/);

    const drag = async (id: string, from: [number, number], to: [number, number]) => {
      const node = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
      if (!node) {
        throw new Error(`${id} node wrapper not found`);
      }
      const at = ([clientX, clientY]: [number, number]) => ({ clientX, clientY, button: 0, view });
      // The first move past nodeDragThreshold only STARTS the drag (onNodeDragStart); the grab
      // offset is taken at that event, so later movement is measured from `dragStart`.
      const dragStart: [number, number] = [from[0] + 2, from[1] + 2];
      const middle: [number, number] = [(dragStart[0] + to[0]) / 2, (dragStart[1] + to[1]) / 2];
      // One act() per event, so React re-renders between pointer events as it does in a browser.
      const step = async (fire: () => void) => {
        await act(async () => {
          fire();
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      };
      await step(() => fireEvent.mouseDown(node, at(from)));
      await step(() => fireEvent.mouseMove(document, at(dragStart)));
      await step(() => fireEvent.mouseMove(document, at(middle)));
      await step(() => fireEvent.mouseMove(document, at(to)));
      await step(() => fireEvent.mouseUp(document, at(to)));
      return {
        position: probe.instance?.getNode(id)?.position,
        pointerTravel: { x: to[0] - dragStart[0], y: to[1] - dragStart[1] },
      };
    };
    const nearestGrid = (value: number) => Math.round(value / 16) * 16;

    // PU starts ON the grid at (208, 0) and travels (41, 35): unsnapped target (249, 35)
    const pu = await drag('PU', [220, 10], [263, 47]);
    expect(pu.pointerTravel).toEqual({ x: 41, y: 35 });
    expect(pu.position).toEqual({ x: nearestGrid(208 + 41), y: nearestGrid(0 + 35) });
    expect(pu.position).toEqual({ x: 256, y: 32 });
    expect(onNodeDragStop).toHaveBeenCalledTimes(1);
    const [, draggedNode, draggedNodes] = onNodeDragStop.mock.calls[0] ?? [];
    expect(draggedNode?.id).toBe('PU');
    expect(draggedNode?.position).toEqual(pu.position);
    expect(draggedNodes?.map((n) => n.id)).toEqual(['PU']);

    // PEOU starts OFF the grid at (5, 131) and travels (28, 48): unsnapped target (33, 179)
    const peou = await drag('PEOU', [20, 140], [50, 190]);
    expect(peou.position).toEqual({ x: nearestGrid(5 + 28), y: nearestGrid(131 + 48) });
    expect(peou.position).toEqual({ x: 32, y: 176 });
    expect(onNodeDragStop).toHaveBeenCalledTimes(2);

    observed.snapToGrid = {
      snapGrid: [16, 16],
      rule: 'final position = nearest grid point to (start + pointer travel since drag start)',
      onGridStart: { start: { x: 208, y: 0 }, ...pu },
      offGridStart: { start: { x: 5, y: 131 }, ...peou },
      jsdomDragSimulation: {
        eventViewMustBe: 'globalThis.jsdom.window',
        vitestWindowAcceptedAsView: false,
        autoPanOnNodeDragMustBeFalse: true,
        oneActPerPointerEvent: true,
        firstMoveOnlyStartsTheDrag: true,
      },
    };
  });

  it('isValidConnection gates onConnect (click-to-connect path)', async () => {
    installResizeObserverStub();
    const probe: Probe = { instance: null, initialized: false };
    const onConnect = vi.fn<OnConnect>();
    const seen: (Connection | PathEdge)[] = [];
    let allow = false;
    const isValidConnection: IsValidConnection<PathEdge> = (candidate) => {
      seen.push(candidate);
      return allow;
    };

    const { container } = render(
      <Frame>
        <ControlledFlow
          initialNodes={sizedNodes()}
          probe={probe}
          flowProps={{ onConnect, isValidConnection, connectionMode: ConnectionMode.Strict }}
        />
      </Frame>,
    );
    await settle();

    const source = container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="PU"] .react-flow__handle.source',
    );
    const target = container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="PEOU"] .react-flow__handle.target',
    );
    if (!source || !target) {
      throw new Error('handles not found');
    }
    // jsdom has no hit testing; React Flow asks the document which handle is under the pointer
    const elementFromPoint = vi.fn(() => target);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: elementFromPoint,
    });

    const connect = async () => {
      await act(async () => {
        fireEvent.click(source);
        fireEvent.click(target);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    };

    try {
      await connect();
      expect(seen.at(-1)).toMatchObject({
        source: 'PU',
        target: 'PEOU',
        sourceHandle: null,
        targetHandle: null,
      });
      expect(onConnect).not.toHaveBeenCalled();
      expect(probe.instance?.getEdges()).toHaveLength(1);

      allow = true;
      await connect();
      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(onConnect.mock.calls[0]?.[0]).toEqual({
        source: 'PU',
        target: 'PEOU',
        sourceHandle: null,
        targetHandle: null,
      });
      expect(probe.instance?.getEdges().map((e) => e.id)).toHaveLength(2);
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }

    observed.connection = {
      path: 'connectOnClick (default true): click a source handle, then a target handle',
      isValidConnectionReceives: seen.at(-1),
      onConnectReceives: onConnect.mock.calls[0]?.[0],
      jsdomNeeds: 'document.elementFromPoint stub',
    };
  });
});

describe('@xyflow/react typings and enums we rely on', () => {
  it('has the props, callbacks and enum members named in the plan', () => {
    type Props = ReactFlowProps<ConstructNode, PathEdge>;

    expectTypeOf<Props>().toHaveProperty('snapToGrid').toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Props>().toHaveProperty('snapGrid').toEqualTypeOf<[number, number] | undefined>();
    expectTypeOf<Props>().toHaveProperty('selectionOnDrag').toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Props>()
      .toHaveProperty('panOnDrag')
      .toEqualTypeOf<boolean | number[] | undefined>();
    expectTypeOf<Props>()
      .toHaveProperty('onNodeDragStop')
      .toEqualTypeOf<OnNodeDrag<ConstructNode> | undefined>();
    expectTypeOf<Props>().toHaveProperty('onConnect').toEqualTypeOf<OnConnect | undefined>();
    expectTypeOf<Props>()
      .toHaveProperty('isValidConnection')
      .toEqualTypeOf<IsValidConnection<PathEdge> | undefined>();
    expectTypeOf<Props>().toHaveProperty('nodeTypes');
    expectTypeOf<Props>().toHaveProperty('edgeTypes');
    expectTypeOf<Props>()
      .toHaveProperty('connectionMode')
      .toEqualTypeOf<ConnectionMode | undefined>();
    expectTypeOf<Props>()
      .toHaveProperty('selectionMode')
      .toEqualTypeOf<SelectionMode | undefined>();
    expectTypeOf<Props>().toHaveProperty('onlyRenderVisibleElements');
    expectTypeOf<Props>().toHaveProperty('colorMode');
    expectTypeOf<Props>().toHaveProperty('onBeforeDelete');
    expectTypeOf<Props>().toHaveProperty('onReconnect');
    expectTypeOf<Props>().toHaveProperty('nodeExtent');
    expectTypeOf<Props>().toHaveProperty('minZoom');
    expectTypeOf<Props>().toHaveProperty('maxZoom');

    expectTypeOf<IsValidConnection<PathEdge>>().parameter(0).toEqualTypeOf<PathEdge | Connection>();
    // the event type is a union of pointer events in 12.x; only the node arguments are pinned
    expectTypeOf<OnNodeDrag<ConstructNode>>().parameter(1).toEqualTypeOf<ConstructNode>();
    expectTypeOf<OnNodeDrag<ConstructNode>>().parameter(2).toEqualTypeOf<ConstructNode[]>();

    expectTypeOf<BackgroundProps>().toHaveProperty('variant');
    expectTypeOf<BackgroundProps>().toHaveProperty('gap');
    expectTypeOf<BackgroundProps>().toHaveProperty('size');
    expectTypeOf<BackgroundProps>().toHaveProperty('color');

    type Instance = ReactFlowInstance<ConstructNode, PathEdge>;
    expectTypeOf<Instance>().toHaveProperty('fitView');
    expectTypeOf<Instance>().toHaveProperty('fitBounds');
    expectTypeOf<Instance>().toHaveProperty('getNodesBounds');
    expectTypeOf<Instance>().toHaveProperty('screenToFlowPosition');
    expectTypeOf<Instance>().toHaveProperty('updateNode');
    expectTypeOf<Instance>().toHaveProperty('deleteElements');
    expectTypeOf(getViewportForBounds).toBeFunction();

    expectTypeOf<ConstructNode>()
      .toHaveProperty('measured')
      .toEqualTypeOf<{ width?: number; height?: number } | undefined>();
    expectTypeOf<ConstructNode>().toHaveProperty('width').toEqualTypeOf<number | undefined>();
    expectTypeOf<ConstructNode>().toHaveProperty('handles');
    expectTypeOf<ConstructNode>().toHaveProperty('parentId').toEqualTypeOf<string | undefined>();

    expect(ConnectionMode).toEqual({ Strict: 'strict', Loose: 'loose' });
    expect(SelectionMode).toEqual({ Partial: 'partial', Full: 'full' });
    expect(BackgroundVariant).toEqual({ Lines: 'lines', Dots: 'dots', Cross: 'cross' });

    observed.versions = {
      xyflowReact: installedPackage('@xyflow/react').version,
      xyflowSystem: installedPackage('@xyflow/system').version,
      enums: { ConnectionMode, SelectionMode, BackgroundVariant },
    };
  });
});
