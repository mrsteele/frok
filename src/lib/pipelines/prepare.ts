import { catalog, pipelineStatus } from './catalog';
import { builtinPreparation, preparationFor } from './builtins';
import { createJob, listJobs, settings } from '../db';
import { providerFor } from '../providers/registry';
import { providerDefinitions } from '../providers/definitions';
import { workerStatus } from '../worker-health';
import { isPreparationJob } from '../preparation-job';
import { HttpError } from '../request-security';
import type { SetupRequest } from '../types';

export async function queuePreparation(id: string, signal: AbortSignal) {
  const worker = workerStatus();
  if (!worker.ready) throw new HttpError(409, worker.detail);
  const before = settings();
  const snapshot = (await catalog()).entries.find(p => p.metadata.id === id && before.pipelineSelections[p.kind] === id);
  if (!snapshot) throw new HttpError(409, 'Select a built-in workflow first.');
  const runner = snapshot.metadata.runner;
  if (!before.connections[runner]) throw new HttpError(409, `Connect ${providerDefinitions[runner].name} first.`);
  const preparation = await preparationFor(snapshot);
  if (!preparation || !providerFor(runner).prepare) throw new HttpError(409, 'This workflow uses manual setup. Follow its setup instructions.');
  const status = await pipelineStatus(snapshot);
  if (status.ready) throw new HttpError(409, 'This workflow is already ready.');
  const starter = await builtinPreparation(preparation);
  signal.throwIfAborted();
  if (JSON.stringify(settings()) !== JSON.stringify(before)) throw new HttpError(409, 'Settings changed. Refresh and try again.');
  const existing = listJobs().find(job => isPreparationJob(job) && (job.request as SetupRequest).preparation === preparation && ['queued', 'running'].includes(job.status));
  return existing || createJob({ kind: 'setup', runner, total: 1, request: {
    task: 'builtin-preparation', preparation, preparationRevision: starter.revision, name: snapshot.metadata.name,
  } });
}

export async function runPreparation(request: SetupRequest, directory: string, signal: AbortSignal, log: (text: string) => void) {
  if (request.task !== 'builtin-preparation' || !request.preparation)
    throw Error('This older installation job cannot be run. Queue a built-in starter from Generation settings.');
  const starter = await builtinPreparation(request.preparation);
  if (request.preparationRevision && request.preparationRevision !== starter.revision)
    throw Error('This setup changed after it was queued. Review the updated workflow and queue preparation again.');
  const runner = starter.snapshot.metadata.runner;
  if (!settings().connections[runner]) throw Error(`Connect ${providerDefinitions[runner].name} before running preparation.`);
  if ((await pipelineStatus(starter.snapshot)).ready) { log('Dependencies are already installed.\n'); return; }
  const provider = providerFor(runner);
  if (!provider.prepare) throw Error('This provider uses manual setup.');
  await provider.prepare({ ...starter, directory, signal, log });
  signal.throwIfAborted();
  const status = await pipelineStatus(starter.snapshot);
  if (!status.ready) throw Error(`The setup finished, but this workflow still needs attention. ${status.detail} Follow the manual setup instructions.`);
  log('Workflow ready.\n');
}
