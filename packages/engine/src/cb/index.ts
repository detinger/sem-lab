/**
 * Public API of the browser CB-SEM engine (ML / MLR, complete data or FIML).
 * Conventions (parameter keys, fit index names, deviations from lavaan) are in ./README.md.
 */
import { type CbHooks, type CbInput, type CbOutcome, estimateCbSync } from './engine.ts';

export type { CbDataInput } from './data.ts';
export type { CbError, CbErrorCode, CbHooks, CbInput, CbOutcome } from './engine.ts';
export { CB_ENGINE_VERSION, estimateCbSync } from './engine.ts';
export { cbParameterCount } from './count.ts';

/**
 * Estimate a CB-SEM model in the browser. Never throws for bad input: every failure is an
 * `{ ok: false, error }` with a stable engine-protocol code. Unexpected exceptions become
 * ENGINE_INTERNAL.
 */
export async function estimateCb(input: CbInput, hooks?: CbHooks): Promise<CbOutcome> {
  await Promise.resolve();
  try {
    return estimateCbSync(input, hooks);
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'ENGINE_INTERNAL',
        message: `Unexpected error in the CB engine: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
}
