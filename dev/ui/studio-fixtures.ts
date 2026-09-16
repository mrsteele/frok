import type { Generation, Job, Media } from '../../src/lib/types';

const now = new Date().toISOString();
export const previewRequest: Generation = {
  mode: 'image', prompt: 'A quiet mountain lake at sunrise · synthetic preview',
  aspect: '4:3', duration: 6, quality: 'preview', count: 4, enhance: false, referenceIds: [],
};
export const previewMedia: Media = {
  id: '22222222-2222-4222-8222-222222222222', kind: 'image', filename: 'synthetic.svg',
  prompt: previewRequest.prompt, enhancedPrompt: '', width: 640, height: 480,
  seed: 7, favorite: false, createdAt: now, origin: 'generated',
  assetNumber: 1, rootId: '22222222-2222-4222-8222-222222222222',
  sectionId: 'example-section', jobId: 'example-completed', generation: previewRequest,
};
export function previewJobs(state: string): Job[] {
  if (['empty', 'disconnected', 'offline'].includes(state)) return [];
  const completed: Job = {
    id: 'example-completed', kind: 'generate', runner: 'vpipe', status: 'completed',
    request: previewRequest, completed: 1, total: 1, message: 'Image ready',
    createdAt: now, updatedAt: now, finishedAt: now,
  };
  const active: Job = {
    ...completed, id: 'example-active', status: state === 'error' ? 'failed' : 'running',
    request: { ...previewRequest, mode: 'video', sourceId: previewMedia.id, prompt: 'Clouds drift over the lake', count: 1 },
    completed: 0, finishedAt: undefined, startedAt: now,
    message: state === 'error' ? 'The runner connection was interrupted.' : 'Rendering video · step 3 of 8',
    error: state === 'error' ? 'Could not connect to the example runner. Check Services before retrying.' : undefined,
    step: state === 'error' ? undefined : { current: 3, total: 8 },
  };
  return state === 'busy' || state === 'error'
    ? [active, { ...completed, id: 'example-waiting', completed: 0, status: 'queued', message: 'Waiting to start', finishedAt: undefined }, completed]
    : [completed];
}

// Returns only in-memory responses. Never contacts a runner or writes a library.
export function studioResponse(route: string, method: string, body: unknown, state: string, jobs: Job[]): Response | undefined {
  const media = ['empty', 'disconnected', 'offline'].includes(state) ? [] : [previewMedia];
  if (route === 'envision' || route === 'media') return Response.json({
    media: route === 'media' && location.pathname.startsWith('/favorites') ? media.filter(item => item.favorite) : media,
    sections: media.length ? [{ id: 'example-section', prompt: previewRequest.prompt, createdAt: now, jobIds: ['example-completed'], request: previewRequest }] : [],
  });
  if (route.endsWith('/family')) return Response.json({ root: previewMedia, renders: [] });
  if (route === 'deletion/preview') return Response.json({ token: 'preview', total: 1, images: 1, videos: 0, hdVersions: 0, favorites: 0, protectedCount: 0, jobs: 1 });
  if (route === 'jobs' && method === 'POST') {
    const job: Job = { id: `preview-queued-${jobs.length}`, kind: 'generate', runner: 'vpipe', status: 'queued', request: body as Generation, completed: 0, total: 1, message: 'Synthetic job · no generation runs', createdAt: now, updatedAt: now };
    jobs.unshift(job);
    return Response.json({ job }, { status: 201 });
  }
  if (route.startsWith('jobs/')) {
    const job = jobs.find(item => item.id === route.split('/')[1]);
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });
    if (route.endsWith('/log')) return Response.json({ log: 'Synthetic runner output. No model was loaded.\n' + job.message });
    return Response.json({ job });
  }
}
