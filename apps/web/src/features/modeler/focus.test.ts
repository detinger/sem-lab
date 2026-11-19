import { beforeEach, describe, expect, it } from 'vitest';
import { useFocusRequest } from './focus';

describe('focus request', () => {
  beforeEach(() => useFocusRequest.getState().clear());

  it('stores unique ids with a fresh nonce per request', () => {
    useFocusRequest.getState().focus(['a', 'b', 'a'], 'why');
    const first = useFocusRequest.getState().request!;
    expect(first.ids).toEqual(['a', 'b']);
    useFocusRequest.getState().focus(['a'], 'again');
    expect(useFocusRequest.getState().request!.nonce).toBeGreaterThan(first.nonce);
  });

  it('clears', () => {
    useFocusRequest.getState().focus(['a'], 'x');
    useFocusRequest.getState().clear();
    expect(useFocusRequest.getState().request).toBeNull();
  });
});
