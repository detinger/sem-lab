import { Cpu } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Static, honest status line: estimation runs in this browser; there is no service to check. */
export function EngineStatus() {
  return (
    <Link
      to="/settings#about-engine"
      className="nav-item"
      title="Engine: in browser. Open Settings, About the engine."
    >
      <Cpu size={18} aria-hidden="true" />
      <span className="nav-item__label">Engine: in browser</span>
    </Link>
  );
}
