/**
 * DOM stand-ins that @xyflow/react needs under jsdom. jsdom 31 has no ResizeObserver, no
 * DOMMatrixReadOnly and no layout engine (offsetWidth/offsetHeight are always 0).
 *
 * Two levels, both verified by src/tests/spike/reactflow.spike.test.tsx:
 *
 * 1. installResizeObserverStub(): enough to RENDER a flow whose nodes carry explicit `width`,
 *    `height` and `handles`. This is the route for SEM Lab component tests, because construct
 *    and indicator nodes have known sizes.
 * 2. installMeasuringDom(): emulates measurement, so React Flow fills `node.measured` itself
 *    through `onNodesChange`. Use it only when a test is about the measuring lifecycle.
 *
 * Globals are installed with vi.stubGlobal and removed by Vitest (`unstubGlobals: true`).
 * installMeasuringDom also patches HTMLElement.prototype and returns a function that undoes it.
 */
import { vi } from 'vitest';

class NoopResizeObserver implements ResizeObserver {
  observe(): void {
    // nothing to observe: jsdom never lays anything out
  }
  unobserve(): void {
    // see observe
  }
  disconnect(): void {
    // see observe
  }
}

export function installResizeObserverStub(): void {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
}

/** Reports every observed element once, immediately, like a first layout pass would. */
class ImmediateResizeObserver implements ResizeObserver {
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe(target: Element): void {
    this.#callback([{ target } as ResizeObserverEntry], this);
  }
  unobserve(): void {
    // nothing is retained
  }
  disconnect(): void {
    // nothing is retained
  }
}

/** React Flow only reads `m22` (the zoom factor) from the viewport transform. */
class ScaleOnlyDOMMatrix {
  readonly m22: number;

  constructor(transform?: string) {
    const scale = /scale\(([0-9.]+)\)/.exec(transform ?? '')?.[1];
    this.m22 = scale ? Number(scale) : 1;
  }
}

export function installMeasuringDom(size: { width: number; height: number }): () => void {
  vi.stubGlobal('ResizeObserver', ImmediateResizeObserver);
  vi.stubGlobal('DOMMatrixReadOnly', ScaleOnlyDOMMatrix);

  const previousWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const previousHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => size.width,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => size.height,
  });

  return () => {
    if (previousWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', previousWidth);
    }
    if (previousHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', previousHeight);
    }
  };
}
