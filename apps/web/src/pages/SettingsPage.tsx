import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from '@/app/ThemeProvider';
import { isThemePreference } from '@/app/theme';
import { Callout, Card, CardHeader, PageHeader, SegmentedControl } from '@/components/ui';

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
            Data you import stays in your browser. In this version nothing is sent to a server:
            models and datasets are processed and stored on your device only.
          </p>
          <Callout variant="info" title="Backend not configured">
            No analysis service is connected. If one is added in a later version, you will be told
            before any data leaves your browser.
          </Callout>
        </Card>
      </div>
    </>
  );
}
