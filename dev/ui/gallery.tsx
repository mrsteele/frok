import { jobs } from './fixtures';
import './fixtures';
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Plus, Trash2 } from 'lucide-react';
import { health, scenario } from './fixtures';
import { Button } from '../../src/components/ui/primitives/button';
import { IconButton } from '../../src/components/ui/primitives/icon-button';
import { Input } from '../../src/components/ui/primitives/input';
import { Select } from '../../src/components/ui/primitives/select';
import { Textarea } from '../../src/components/ui/primitives/textarea';
import { Checkbox } from '../../src/components/ui/primitives/checkbox';
import { Badge } from '../../src/components/ui/primitives/badge';
import { Spinner } from '../../src/components/ui/primitives/spinner';
import { FormField } from '../../src/components/ui/patterns/form-field';
import { FormActions } from '../../src/components/ui/patterns/form-actions';
import { Card } from '../../src/components/ui/patterns/card';
import { InlineMessage } from '../../src/components/ui/patterns/inline-message';
import { ConfirmationDialog } from '../../src/components/ui/patterns/confirmation-dialog';
import { SettingsDialog } from '../../src/components/ui/patterns/settings-dialog';
import { Setup } from '../../src/components/settings/setup';
import { InterfacePreferences } from '../../src/components/shell/interface-preferences';
import Studio from '../../src/components/shell/studio';
import '../../src/app/globals.css';
import '../../src/components/ui/tokens.css';
import '../../src/components/ui/ui.css';
import '../../src/components/settings/settings.css';
import '../../src/components/settings/pipeline-catalog.css';
import '../../src/components/onboarding/onboarding.css';
import '../../src/components/shell/studio.css';
import './gallery.css';

const views = [
  'primitives',
  'services',
  'generation',
  'recipes',
  'advanced',
  'onboarding',
] as const;
type View = (typeof views)[number];
function Gallery() {
  const initial = new URLSearchParams(location.search).get('view');
  const [view, setView] = useState<View>(
    views.includes(initial as View) ? (initial as View) : 'primitives',
  );
  const [, refresh] = useState(0),
    [modal, setModal] = useState<'confirm' | 'settings' | undefined>();
  const [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [enhance, setEnhance] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(''),
    [checked, setChecked] = useState(true);
  function navigate(next: View) {
    setView(next);
    history.replaceState(null, '', `?view=${next}&state=${scenario}`);
  }
  return (
    <main
      className="ui-gallery"
      onClick={(event) => {
        if (event.defaultPrevented) return;
        const anchor = (event.target as Element).closest('a');
        if (!anchor) return;
        event.preventDefault();
        event.stopPropagation();
        const path = new URL(anchor.href).pathname;
        const section = path.startsWith('/settings') ? path.split('/')[2] || 'services' : undefined;
        if (views.includes(section as View)) navigate(section as View);
      }}
    >
      <header className="ui-gallery-header">
        <div>
          <h1>Frok UI</h1>
          <p>Component examples · Synthetic data only</p>
        </div>
        <Select
          aria-label="Example state"
          value={scenario}
          onChange={(event) => location.assign(`?view=${view}&state=${event.target.value}`)}
        >
          {['connected', 'vpipe-only', 'comfyui-only', 'disconnected', 'offline', 'busy', 'missing', 'error', 'access-ready', 'access-partial', 'access-token-required', 'access-denied', 'access-granted', 'access-unchecked', 'access-unavailable', 'access-unknown'].map((state) => (
            <option key={state}>{state}</option>
          ))}
        </Select>
      </header>
      <nav className="ui-gallery-nav" aria-label="Component examples">
        {views.map((item) => (
          <Button key={item} aria-pressed={view === item} onClick={() => navigate(item)}>
            {item}
          </Button>
        ))}
      </nav>
      {view === 'primitives' ? (
        <div className="ui-gallery-grid">
          <Card>
            <h2>Buttons</h2>
            <FormActions align="start">
              {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => (
                <Button key={variant} variant={variant}>
                  {variant}
                </Button>
              ))}
            </FormActions>
            <FormActions align="start">
              <Button size="compact">Compact</Button>
              <Button disabled>Disabled</Button>
              <Button loading>Saving…</Button>
              <IconButton aria-label="Add example">
                <Plus size={16} />
              </IconButton>
              <Button>
                <Check size={16} />
                With icon
              </Button>
            </FormActions>
            <FormActions>
              <Button>A longer action label that wraps in a narrow window</Button>
            </FormActions>
          </Card>

          <Card>
            <h2>Status and feedback</h2>
            <FormActions align="start">
              <Badge>Optional</Badge>
              <Badge tone="success">
                <Check size={13} />
                Connected
              </Badge>
              <Badge tone="warning">Needs attention</Badge>
              <Badge tone="danger">Unavailable</Badge>
              <Badge>
                <Spinner />
                Checking
              </Badge>
            </FormActions>
            <InlineMessage>Helpful context without an interruption.</InlineMessage>
            <InlineMessage tone="success">Changes saved.</InlineMessage>
            <InlineMessage tone="warning">Check this setting before continuing.</InlineMessage>
            <InlineMessage tone="danger">
              Could not save. Your previous settings remain.
            </InlineMessage>
          </Card>
          <Card>
            <h2>Dialogs</h2>
            <FormActions align="start">
              <Button onClick={() => setModal('confirm')}>Open confirmation</Button>
              <Button onClick={() => setModal('settings')}>Open settings dialog</Button>
            </FormActions>
          </Card>
          <Card className="ui-gallery-fields">
            <h2>Fields</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitted(true);
              }}
            >
              <FormField
                label="Example name"
                hint="A label, help text and control share an accessible association."
              >
                <Input
                  name="example"
                  ref={inputRef}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="Enter a name"
                />
              </FormField>
              <FormField label="Workflow" hint="Native selection and keyboard support.">
                <Select defaultValue="one">
                  <option value="one">Example workflow with a longer descriptive name</option>
                  <option value="two">Another workflow</option>
                  <option disabled>Unavailable workflow</option>
                </Select>
              </FormField>
              <FormField label="Invalid value" error="Enter a value between 1 and 10.">
                <Input type="number" defaultValue={12} />
              </FormField>
              <FormField label="Disabled field">
                <Input disabled defaultValue="Unavailable" />
              </FormField>
              <FormField label="Notes">
                <Textarea rows={2} placeholder="Optional notes" />
              </FormField>
              <FormField
                layout="toggle"
                label="Enable example"
                hint="This preference stays in the preview."
              >
                <Checkbox
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
              </FormField>
              <FormActions>
                <Button
                  onClick={() => {
                    setValue('');
                    inputRef.current?.focus();
                  }}
                >
                  Clear
                </Button>
                <Button type="submit" variant="primary">
                  Save example
                </Button>
              </FormActions>
              {submitted && <InlineMessage tone="success">Example saved.</InlineMessage>}
            </form>
          </Card>
        </div>
      ) : view === 'onboarding' ? (
        <>
          <Button onClick={() => refresh((n) => n + 1)}>Reopen quick setup</Button>
          <Setup wizard jobs={jobs}
            key={view}
            health={health}

            checkingHealth={scenario === 'busy'}
            onRefresh={() => refresh((n) => n + 1)}
            enhance={enhance}
            onEnhancementChange={setEnhance}
            onFinished={() => navigate('services')}
          />
        </>
      ) : (
        <InterfacePreferences>
          <Setup jobs={jobs}
            health={health}

            section={view}
            checkingHealth={scenario === 'busy'}
            onRefresh={() => refresh((n) => n + 1)}
            enhance={enhance}
            onEnhancementChange={setEnhance}
            onOnboarding={() => navigate('onboarding')}
          />
        </InterfacePreferences>
      )}
      {modal === 'confirm' && (
        <ConfirmationDialog
          title="Delete this example?"
          busy={busy}
          onClose={() => setModal(undefined)}
        >
          <p>This dialog demonstrates focus, keyboard behavior and a destructive action.</p>
          <FormField layout="toggle" label="Simulate busy state">
            <Checkbox checked={busy} onChange={(event) => setBusy(event.target.checked)} />
          </FormField>
          <FormActions>
            <Button autoFocus disabled={busy} onClick={() => setModal(undefined)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => setModal(undefined)}>
              <Trash2 size={14} />
              Delete example
            </Button>
          </FormActions>
        </ConfirmationDialog>
      )}
      {modal === 'settings' && (
        <SettingsDialog
          id="gallery-settings"
          title="Example settings"
          onClose={() => setModal(undefined)}
        >
          <FormField label="Example value">
            <Input defaultValue="Saved preference" />
          </FormField>
        </SettingsDialog>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).get('view') === 'studio'
    ? <InterfacePreferences><Studio>{null}</Studio></InterfacePreferences>
    : <Gallery />,
);
