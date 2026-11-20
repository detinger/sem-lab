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
            only. To remove them, use Clear all under Recent projects on the Overview page; learning
            progress has its own Reset there.
          </p>
        </Card>
      </div>
    </>
  );
}
