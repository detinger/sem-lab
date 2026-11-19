import { useCallback, useState } from 'react';

export const SIDEBAR_STORAGE_KEY = 'sem-lab:sidebar-collapsed';

function read(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Sidebar collapsed state, remembered in localStorage (never fatal if storage is unavailable). */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(read);
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Not remembering the choice is acceptable.
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}
