import { placeholderElement } from './placeholderRoutes';

/** Lazy-loaded wrapper so all placeholder pages share one small chunk. */
export default function PlaceholderRoute({ path }: { path: string }) {
  return placeholderElement(path);
}
