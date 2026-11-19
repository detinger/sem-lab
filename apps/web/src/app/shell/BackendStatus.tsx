import { Cloud, CloudAlert, CloudOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_BASE_URL, api } from '@/features/analysis/api';

type State = 'not-configured' | 'checking' | 'ready' | 'engine-unavailable' | 'unreachable';

const TEXT: Record<State, string> = {
  'not-configured': 'Backend: not configured',
  checking: 'Backend: checking…',
  ready: 'Backend: R engine ready',
  'engine-unavailable': 'Backend: R engine unavailable',
  unreachable: 'Backend: unreachable',
};

/**
 * Honest backend indicator: "not configured" for a build without VITE_API_BASE_URL, otherwise
 * the result of `/api/health` (re-checked every 60 s). It never claims an engine is ready unless
 * the health probe says so.
 */
export function BackendStatus() {
  const [state, setState] = useState<State>(API_BASE_URL ? 'checking' : 'not-configured');
  useEffect(() => {
    if (!API_BASE_URL) return;
    let alive = true;
    const check = (): void => {
      api
        .health()
        .then(
          (h) =>
            alive &&
            setState(
              h.engines.some((e) => e.id === 'r-csem' && e.available && e.jobs !== false)
                ? 'ready'
                : 'engine-unavailable',
            ),
        )
        .catch(() => alive && setState('unreachable'));
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  const Icon = state === 'ready' ? Cloud : state === 'not-configured' ? CloudOff : CloudAlert;
  return (
    <div className="nav-item nav-item--static" role="status" title={TEXT[state]}>
      <Icon size={18} aria-hidden="true" />
      <span className="nav-item__label">{TEXT[state]}</span>
    </div>
  );
}
