import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from '@/app/ThemeProvider';
import { isThemePreference } from '@/app/theme';
import { Card, CardHeader, PageHeader, SegmentedControl } from '@/components/ui';

import './pages.css';

export function SettingsPage() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <>
      <PageHeader title="Settings" description="Appearance and privacy for this browser." />
      <div className="settings-grid">
        <Card>
          <CardHeader title="Appearance" />
          <p className="text-muted">
            Choose a theme, or follow your operating system.
            {preference === 'system' ? ` The system is currently set to ${resolved}.` : ''}
          </p>
          <SegmentedControl
            aria-label="Theme"
            value={preference}
            onChange={(value) => {
              if (isThemePreference(value)) setPreference(value);
            }}
            options={[
              { value: 'light', label: 'Light', icon: <Sun /> },
              { value: 'dark', label: 'Dark', icon: <Moon /> },
              { value: 'system', label: 'System', icon: <Monitor /> },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Privacy" />
          <p>
            Data you import stays in your browser. Estimation runs on this device, so nothing is
            sent to a server: models, datasets and results are processed and stored on your device
            only.
          </p>
        </Card>

        <Card id="about-engine">
          <CardHeader title="About the engine" />
          <p>
            SEM Studio estimates models with its own engine, written in TypeScript, in Web Workers
            in this browser. There is no analysis server. PLS-SEM, PLSc and CB-SEM (ML, MLR, FIML)
            are offered only where their numbers reproduce reference results from R (cSEM and
            lavaan) in automated tests; R and Python are used for exported scripts and for
            verification, not for running your analysis.
          </p>
        </Card>
      </div>
    </>
  );
}
