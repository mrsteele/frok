'use client';
import { useState } from 'react';
import { Pencil, Plus, RotateCcw, Star, Trash2 } from 'lucide-react';
import type { VideoPreset } from '@/lib/types';
import { useVideoPresets } from './use-video-presets';
import { ConfirmationDialog } from './confirmation-dialog';
import { defaultVideoPreset, starterVideoPresets } from '@/lib/video-presets';

export function VideoPresets() {
  const { presets, defaultPreset, ready, error, savePreset, deletePreset, resetPresets, setDefaultPreset } = useVideoPresets();
  const [draft, setDraft] = useState<VideoPreset>(), [notice, setNotice] = useState(''), [failure, setFailure] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const [resetting, setResetting] = useState(false);
  function edit(preset?: VideoPreset) { setDraft(preset ? { ...preset } : { id: crypto.randomUUID(), name: '', prompt: '' }); setNotice(''); setFailure(''); setDeleting(undefined); }
  function save() {
    if (!draft) return;
    try { savePreset(draft); setDraft(undefined); setNotice('Preset saved. Choose it in the video prompt menu.'); setFailure(''); }
    catch (e) { setFailure((e as Error).message); }
  }
  function remove(id: string) {
    try {
      const next = defaultVideoPreset(deletePreset(id));
      setDeleting(undefined); setNotice(`Preset deleted.${defaultPreset?.id === id ? next ? ` ${next.name} is now the default.` : ' Add a recipe or type a prompt to generate videos.' : ''} Existing renders keep their saved recipe.`); setFailure('');
    }
    catch (e) { setFailure((e as Error).message); }
  }
  function makeDefault(preset: VideoPreset) {
    try { setDefaultPreset(preset.id); setNotice(`${preset.name} is now the default for quick videos and empty prompts.`); setFailure(''); }
    catch (e) { setFailure((e as Error).message); }
  }
  function reset() {
    try { resetPresets(); setResetting(false); setDraft(undefined); setDeleting(undefined); setFailure(''); setNotice('Starter recipes restored.'); }
    catch (e) { setFailure((e as Error).message); }
  }
  return <section className="motion-presets" aria-labelledby="motion-presets-title">
    <div className="preset-heading"><div><h3 id="motion-presets-title">Motion presets</h3><p>Reuse a direction across different images.</p></div><div className="preset-heading-actions"><button className="settings-button" disabled={!ready} onClick={() => {setResetting(true);setDeleting(undefined);setFailure('');setNotice('');}}><RotateCcw size={13}/>Reset recipes</button><button className="settings-button" disabled={!ready || !!error || !!draft} onClick={() => edit()}><Plus size={13}/>Add preset</button></div></div>
    <p className="settings-hint">Selecting a recipe renders immediately with the image description and ignores the editor’s draft. The default is also used when you click an image’s video button or leave its video prompt empty.</p>
    {ready && !error && <p className="settings-hint" role="status">{defaultPreset ? <>Current default: <strong>{defaultPreset.name}</strong>. You can edit or replace it like any other recipe.</> : 'No default recipe. Add a recipe to enable quick videos, or type your own video prompt.'}</p>}
    {error && <div className="preset-error" role="alert"><p>{error}</p><p>Use Reset recipes to restore the starter recipes.</p></div>}
    {resetting && <ConfirmationDialog title="Reset recipes?" icon={<RotateCcw size={22}/>} onClose={() => setResetting(false)}><p>Replace all saved recipes with the starter recipes: {starterVideoPresets.map(preset=>preset.name).join(' and ')}?</p><p>Your custom recipes and edits{draft?', including the unsaved draft,':''} will be removed. This cannot be undone. Existing images, videos and queued generations keep their saved recipes.</p>{failure&&<p className="delete-warning" role="alert">{failure}</p>}<div className="delete-actions"><button className="secondary" autoFocus onClick={() => setResetting(false)}>Cancel</button><button className="delete-confirm" onClick={reset}>Reset recipes</button></div></ConfirmationDialog>}
    {!ready ? <p className="settings-hint">Loading presets…</p> : !error && <div className="preset-list">{presets.map(preset => <div className="preset-row" key={preset.id}>
      <div className="preset-copy"><strong>{preset.name}</strong><p>{preset.prompt}</p></div>
      <div className="preset-actions"><button type="button" className="settings-button preset-default" disabled={!!draft} aria-pressed={!!preset.isDefault} aria-label={preset.isDefault ? `${preset.name} is the default recipe` : `Make ${preset.name} the default recipe`} onClick={() => makeDefault(preset)}><Star size={13} fill={preset.isDefault ? 'currentColor' : 'none'}/>{preset.isDefault ? 'Default' : 'Make default'}</button><button className="icon-button" disabled={!!draft} aria-label={`Edit ${preset.name}`} onClick={() => edit(preset)}><Pencil size={15}/></button><button className="icon-button" disabled={!!draft} aria-label={`Delete ${preset.name}`} onClick={() => { setDeleting(preset.id); setFailure(''); }}><Trash2 size={15}/></button></div>
      {deleting === preset.id && <ConfirmationDialog title={`Delete “${preset.name}”?`} onClose={() => setDeleting(undefined)}><p>This removes the saved preset. Existing renders will keep their recipe.</p>{preset.isDefault && <p>{presets.find(item => item.id !== preset.id) ? `“${presets.find(item => item.id !== preset.id)!.name}” will become the default recipe.` : 'You will need to type a video prompt or add a recipe before using quick video actions.'}</p>}{failure&&<p className="delete-warning" role="alert">{failure}</p>}<div className="delete-actions"><button className="secondary" autoFocus onClick={() => setDeleting(undefined)}>Cancel</button><button className="delete-confirm" onClick={() => remove(preset.id)}>Delete preset</button></div></ConfirmationDialog>}
    </div>)}{!presets.length && !draft && <p className="preset-empty">No saved presets. Add a recipe for a campaign, a character, or a favorite kind of motion.</p>}</div>}
    {draft && <form className="preset-editor" onSubmit={e => { e.preventDefault(); save(); }}>
      <label className="settings-field">Preset name<input autoFocus required maxLength={60} value={draft.name} placeholder="e.g. Carguy" onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
      <label className="settings-field">Video prompt recipe<textarea required rows={5} maxLength={4000} value={draft.prompt} placeholder="Present the car with a confident gesture, then turn to the camera with a welcoming smile. Use a smooth commercial camera move." onChange={e => setDraft({ ...draft, prompt: e.target.value })}/></label>
      <div className="preset-editor-actions"><button type="button" className="settings-button" onClick={() => { setDraft(undefined); setFailure(''); }}>Cancel</button><button className="settings-button solid" type="submit">Save preset</button></div>
    </form>}
    {failure && !deleting && !resetting && <p className="preset-error" role="alert">{failure}</p>}{notice && <p className="settings-hint" role="status">{notice}</p>}
  </section>;
}
