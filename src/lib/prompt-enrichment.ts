// Keep the creative brief in application code; the LLM only supplies an addendum.
export const enrichmentRules = `The core creative brief is fixed. Preserve every explicit constraint: exact subject and object counts; who has each identity, appearance, physical condition, clothing and coverage; requested actions and their order; relationships; setting; medium, style, framing and viewpoint; quoted text; exclusions; and <Picture N> reference tags. Words such as both, each, only and neither apply strictly to the specified subjects. Do not drop, weaken, swap or contradict these facts. Do not add people, duplicate subjects or reinterpret the scene. Mirrors and reflections show the same existing subjects, never additional people. If two subjects share an attribute, both must retain it; their individual differences must stay assigned to the correct subject. A mirror selfie must remain a selfie, with the original person holding the phone and the same subjects in the reflection. Add only two or three small, compatible details the user left unspecified, such as lighting, surface texture or existing background materials. Pose details must preserve the requested action, framing and clothing. Do not invent new props, change the main composition or replace requested details with your preferred aesthetic. Fidelity always takes priority over variety. Before responding, check your additions against every original fact and discard any conflicting detail.`;

export const enrichmentMaxLength = 1200;
export function appendEnrichment(original: string, details: string): string {
  let addition = details.trim();
  // Tolerate an echoed brief without repeating it in the final generation prompt.
  const core = original.trim();
  if (core && addition.startsWith(core) && (addition.length === core.length || /\s/.test(addition[core.length]))) addition = addition.slice(core.length).trim();
  if (addition.length > enrichmentMaxLength || addition.split(/\s+/).filter(Boolean).length > 80) {
    throw new Error('Prompt enrichment should add only a few details.');
  }
  return addition ? `${original}\n\n${addition}` : original;
}
