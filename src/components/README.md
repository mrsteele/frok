# Frok components

The internal UI library has two tiers. Feature folders hold components that understand Frok.

- `ui/primitives`: native controls and small indicators. No service, job, storage or routing dependencies.
- `ui/patterns`: reusable field, action, card, feedback and dialog arrangements built from primitives.
- `generation`: composer state, workflow selection and generation preferences.
- `assets`: saved media, previews, the viewer and media deletion.
- `queue`: progress, runtime, job logs and job deletion.
- `settings`: service connections, configuration, recipes, exports and library reset.
- `onboarding`: first-run orchestration using Settings components.
- `shell`: navigation, branding, application composition and shared preference initialization.

Use direct imports. Keep a hook next to the feature that owns its behavior. Shared UI never imports a feature. Keep native paragraphs, headings, forms and fieldsets; do not create wrappers solely to rename HTML.

## Use the existing controls

```tsx
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { FormField } from '@/components/ui/patterns/form-field';
import { FormActions } from '@/components/ui/patterns/form-actions';

<form onSubmit={save}>
  <FormField controlId="service-address" label="Service address" hint="Leave blank for the default." error={error}>
    <Input value={address} onChange={event => setAddress(event.target.value)} />
  </FormField>
  <FormActions>
    <Button onClick={cancel}>Cancel</Button>
    <Button type="submit" variant="primary" loading={saving}>Save connection</Button>
  </FormActions>
</form>
```

Buttons default to `type="button"`; submit is always explicit. Variants are primary, secondary, ghost and danger; sizes are default and compact. Loading disables activation while preserving the label. IconButton requires `aria-label`. Native props and refs pass through.

FormField owns one control's ID, label and descriptions. For an explicit ID, set `controlId` on the field. Input, Select, Textarea and Checkbox consume the association, including through a feature wrapper. Put field errors in `error`; use InlineMessage for operation-level feedback. Forms retain their own validation and request logic.

Card provides a surface; AssetCard owns media behavior. Modal provides native focus and dismissal behavior; feature confirmations own the decision and operation. Busy dialogs cannot be dismissed with Escape or the backdrop. Keep their Cancel actions disabled during the operation.

## Styles and examples

Tokens live in `ui/tokens.css`, component rules in `ui/ui.css`, and feature presentation in `settings/settings.css` and `onboarding/onboarding.css`. The app imports legacy styles, tokens, UI, then feature styles centrally. Use `ui-` classes for the library and feature-specific selectors for feature layouts. Avoid styling all descendant inputs or buttons. Remove an old rule only when its remaining consumers have migrated.

Settings, onboarding and shared dialog controls use the library. Generation, assets, queue and shell retain their current visual styles for a later migration. Reuse a primitive for future work; do not create another button class.

Settings and onboarding use a rich workflow button that opens the native catalog dialog. Reuse `generation/workflow-summary` for the selected model and catalog rows: keep names, access status, speed, adherence and full download size together. Unknown metrics stay unrated; size never implies runtime memory. Keep detailed requirements in the catalog instead of adding a second stats block below a selector. The generation composer's native selector retains its existing source compatibility behavior.

Use green for success, orange for warnings, neutral text for ordinary or unknown states, and red for errors. Download locks come from `workflowDownloadAccess`, never directly from a model's gated metadata. Installed files need no lock; confirmed missing access gets an orange closed lock, and verified permission gets a green open lock. A saved token is not proof of permission. Checks must be explicit user actions, not effects or background health requests.

Run `npm run dev:ui` for a standalone gallery at http://127.0.0.1:4178. It includes primitive states and the real Settings/onboarding components with synthetic services. Every API call is intercepted, and desktop actions are harmless fixtures. It does not start the app, open a library, or contact runners. Reload to reset examples; saved preview preferences are isolated from Frok.

Run `npm run smoke:ui` for isolated Electron layout, keyboard, focus and interaction checks. Screenshots go into ignored `.data/ui-checks`. The normal Node test suite checks native props, field associations, status behavior and existing feature rules. No new UI framework or test dependency is required.

## Interaction conventions

Involve a design-focused agent when changing visual design, wording or flows, as required by the root `AGENTS.md`. Review the journey and the result, including narrow screens, keyboard access and recovery from errors.

Use task names in navigation: Create, Favorites, Settings, Docs and Queue. Call reusable motion prompts recipes, and generation configurations workflows. Reserve “load” and “show older” for existing data; generation actions must say Generate. Choosing a recipe or opening an asset must never start a job. Recipe choices populate a reviewable draft; Generate commits it. Use Cmd/Ctrl+Enter to generate and leave plain Enter available for multiline prompts.

All retained media is already on disk. Use “favorite” for the heart action and “Delete unfavorited” for bulk cleanup. Keep the deletion preview and its exact exceptions before committing deletion.

`shell/studio.css` holds the studio's task controls and responsive navigation, loaded after other feature styles in both app and gallery. Open `http://127.0.0.1:4178/?view=studio&state=connected` to review full app journeys. States `empty`, `busy`, `error`, `disconnected` and `offline` use synthetic data; generation calls create in-memory queue entries only. `npm run smoke:ux` checks these journeys and saves screenshots in `.data/ux-checks`.
