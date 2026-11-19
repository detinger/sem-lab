/// <reference lib="webworker" />
import { createDrawHandler } from './draw-core';
import type { ToDrawWorker } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = createDrawHandler((m) => scope.postMessage(m));
scope.onmessage = (e: MessageEvent<ToDrawWorker>) => handle(e.data);
