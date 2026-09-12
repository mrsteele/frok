import type { Media } from './types';

export type PromptDetail = { label: string; text: string };
export function promptDetails(root: Media, video?: Media): PromptDetail[] {
  const rows: PromptDetail[] = [];
  const image = root.kind==='image' && root.origin!=='upload' ? video?.promptTrace?.image ?? (root.origin !== 'poster' || video?.generation?.sourceId
    ? { original: root.prompt, actual: root.enhancedPrompt || root.prompt } : undefined) : undefined;
  if (image) {
    if (image.original && image.original !== image.actual) rows.push({ label: 'Original image prompt', text: image.original });
    rows.push({ label: 'Image prompt', text: image.actual || 'Uploaded image · no text prompt' });
  }
  // A poster extracted from text-to-video has a video prompt, not an image-generation prompt.
  const item = video ?? (root.kind==='video' || root.origin === 'poster' ? root : undefined);
  if (!item) return rows;
  const style = item.videoStyle ?? item.generation?.videoStyle;
  const name = item.generation?.videoPreset?.name || (style ? style[0].toUpperCase() + style.slice(1) : undefined);
  const actual = item.enhancedPrompt || item.prompt;
  const raw = item.promptTrace?.raw ?? (style === 'preset' ? item.generation?.videoPreset?.prompt || item.prompt
    : style === 'normal' ? 'Show simple, natural motions in the video, continuing the action described in the starting image.' : item.prompt);
  // Older records lack an enhancement result. Their unenhanced motion briefs used this fixed marker.
  const legacyBrief = actual.includes('second shot, starting from the supplied image.');
  const enhanced = item.promptTrace?.enhanced ?? (item.generation?.enhance !== false && !legacyBrief && raw !== actual);
  if (raw && enhanced) rows.push({ label: 'Raw video prompt', text: raw });
  rows.push({ label: name ? `Video prompt [${name}]` : 'Video prompt', text: actual || 'No saved video prompt' });
  return rows;
}
