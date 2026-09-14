import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { Button } from '../src/components/ui/primitives/button';
import { IconButton } from '../src/components/ui/primitives/icon-button';
import { Input } from '../src/components/ui/primitives/input';
import { Checkbox } from '../src/components/ui/primitives/checkbox';
import { FormField } from '../src/components/ui/patterns/form-field';
import { ConnectionStatus } from '../src/components/settings/service-panel';

test('buttons preserve native submission semantics and loading prevents activation', () => {
  const plain = render(h(Button, { name: 'action', value: 'save', form: 'example' }, 'Save'));
  assert.match(plain, /type="button"/);
  assert.match(plain, /form="example"/);
  assert.match(plain, /name="action"/);
  const submit = render(
    h(Button, { type: 'submit', loading: true, 'aria-label': 'Save preferences' }, 'Saving…'),
  );
  assert.match(submit, /type="submit"/);
  assert.match(submit, /disabled=""/);
  assert.match(submit, /aria-busy="true"/);
  assert.match(submit, /aria-label="Save preferences"/);
  assert.match(submit, /aria-hidden="true"/);
  assert.match(
    render(h(IconButton, { 'aria-label': 'Add reference' }, '+')),
    /aria-label="Add reference"/,
  );
});

test('fields connect labels, hints and errors while preserving native input attributes', () => {
  const markup = render(
    h(
      FormField,
      {
        controlId: 'seed',
        label: 'Seed',
        hint: 'Leave empty for random.',
        error: 'Use a nonnegative number.',
      },
      h(Input, {
        type: 'number',
        min: 0,
        max: 10,
        required: true,
        'aria-describedby': 'external-help',
      }),
    ),
  );
  assert.match(markup, /for="seed"/);
  assert.match(markup, /id="seed"/);
  assert.match(markup, /id="seed-hint"/);
  assert.match(markup, /id="seed-error"/);
  assert.match(markup, /aria-describedby="external-help seed-hint seed-error"/);
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /min="0"/);
  assert.match(markup, /required=""/);
});

test('toggle fields have an associated checkbox, and native fieldsets can disable controls', () => {
  const markup = render(
    h(
      'fieldset',
      { disabled: true },
      h(
        FormField,
        { controlId: 'enabled', layout: 'toggle', label: 'Enable previews' },
        h(Checkbox, { defaultChecked: true, name: 'previews' }),
      ),
    ),
  );
  assert.match(markup, /<fieldset disabled=""/);
  assert.match(markup, /for="enabled"/);
  assert.match(markup, /type="checkbox"/);
  assert.match(markup, /checked=""/);
  assert.match(markup, /id="enabled"/);
});

test('connection status distinguishes checking, edits, ready, offline and disabled services', () => {
  const base = { pending: false, dirty: false, connected: false, enabled: false };
  assert.match(render(h(ConnectionStatus, base)), /Not connected/);
  assert.match(render(h(ConnectionStatus, { ...base, enabled: true })), /Offline/);
  assert.match(render(h(ConnectionStatus, { ...base, connected: true })), /Connected/);
  assert.match(
    render(
      h(ConnectionStatus, { ...base, connected: true, dirty: true, dirtyLabel: 'Unsaved address' }),
    ),
    /Unsaved address/,
  );
  assert.match(
    render(h(ConnectionStatus, { ...base, connected: true, pending: true })),
    /Checking/,
  );
});
