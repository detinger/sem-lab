import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cx } from './cx';
import { IconButton } from './IconButton';
import './Toast.css';

export type ToastVariant = 'default' | 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds before auto-dismiss; default 5000 (errors 8000). 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastApi {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>.');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((list) => [...list, { ...options, id }]);
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toast-region" aria-label="Notifications" role="region">
        {toasts.map((entry) => (
          <ToastItem key={entry.id} entry={entry} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ICONS = {
  default: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
};

function ToastItem({ entry, onDismiss }: { entry: ToastEntry; onDismiss: (id: number) => void }) {
  const variant = entry.variant ?? 'default';
  const duration = entry.duration ?? (variant === 'error' ? 8000 : 5000);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const Icon = ICONS[variant];
  const urgent = variant === 'error' || variant === 'warning';
  const { id } = entry;

  // Count down while not hovered/focused; the remaining time survives pauses.
  useEffect(() => {
    if (duration === 0 || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, duration, id, onDismiss]);

  return (
    // role="status" / "alert" announce the message; the handlers only pause the timer.
    <div
      role={urgent ? 'alert' : 'status'}
      className={cx('ui-toast', `ui-toast--${variant}`)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className="ui-toast__icon" size={16} aria-hidden="true" />
      <div className="ui-toast__body">
        <p className="ui-toast__title">{entry.title}</p>
        {entry.description ? <p className="ui-toast__desc">{entry.description}</p> : null}
      </div>
      <IconButton aria-label="Dismiss notification" size="small" onClick={() => onDismiss(id)}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
