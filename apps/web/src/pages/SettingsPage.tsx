import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';

import { useTheme } from '@/app/ThemeProvider';
import { isThemePreference } from '@/app/theme';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  PageHeader,
  SegmentedControl,
  useToast,
} from '@/components/ui';
import { useProgress } from '@/features/learn/progress';

import './pages.css';

export function SettingsPage() {
  const { preference, resolved, setPreference } = useTheme();
  const { toast } = useToast();
  const resetProgress = useProgress((s) => s.reset);
  const [confirmReset, setConfirmReset] = useState(false);
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

        <Card id="learning-progress">
          <CardHeader title="Learning progress" />
          <p>
            Completed lessons, challenge attempts and achieved skills are kept in this browser only.
            Resetting removes them; your projects and data are not touched.
          </p>
          <Button variant="danger" onClick={() => setConfirmReset(true)}>
            Reset progress
          </Button>
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
      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset learning progress?"
        description="This removes your completed lessons, challenge attempts, hints used and achieved skills from this browser. It cannot be undone. Projects and data are not affected."
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmReset(false);
                void resetProgress().then(() =>
                  toast({ variant: 'success', title: 'Progress reset' }),
                );
              }}
            >
              Reset progress
            </Button>
          </>
        }
      />
    </>
  );
}
