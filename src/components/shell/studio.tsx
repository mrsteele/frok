'use client';
import { isPreparationJob } from '@/lib/preparation-job';
import { PipelineUtils } from '@/components/settings/pipeline-utils';
import { selectedPipeline } from '@/lib/pipelines/schema';
import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import {
  GripVertical,
  Play,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Film,
  Heart,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Terminal,
  Trash2,
  X,
  CircleAlert,
  Info,
  Wrench,
} from 'lucide-react';
import type { DeleteTarget, Generation, Health, Job, Media, Telemetry } from '@/lib/types';
import { mediaUrl } from '@/lib/types';
import {
  generationBlocker,
  generationIssue,
  promptEnhancementIssue,
  missingSetup,
  type SetupTarget,
} from '@/lib/readiness';

import { motionChoices, motionChoiceInput } from '@/lib/video-presets';
import { useVideoPresets } from '@/components/generation/use-video-presets';
import { assetId, groupAssets } from '@/lib/asset-groups';
import { PendingCard } from '@/components/assets/pending-card';
import { AssetCard } from '@/components/assets/asset-card';
import type { GalleryEntry } from '@/lib/gallery';
import { promptGallery, sectionRequest, type PromptSection } from '@/lib/envision';
import { PromptJump, PromptSections } from '@/components/generation/prompt-sections';
import { DeleteConfirmation } from '@/components/assets/delete-confirmation';
import { DeleteJobsConfirmation } from '@/components/queue/delete-jobs-confirmation';
import { JobProgressBar as Progress } from '@/components/queue/job-progress';
import { jobProgress } from '@/lib/progress';
import { queueView } from '@/lib/queue-view';
import { JobRuntime } from '@/components/queue/job-runtime';
import { MediaPage } from '@/components/assets/media-page';
import { About } from './about';
import { BrandMark } from './brand-mark';
import { SocialLinks } from './social-links';
import { Setup } from '@/components/settings/setup';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { mediaPath, settingsPath, studioRoute } from '@/lib/navigation';
import { BackButton, PageShell } from './page-shell';
import { JobLog } from '@/components/queue/job-log';
import { GenerationSettings } from '@/components/generation/generation-settings';
import { api } from '@/lib/client-api';
import { animationRequest } from '@/lib/media-family';
import { useComposer } from '@/components/generation/use-composer';
import { useDraftImages } from '@/components/generation/use-draft-images';
import { draftModeSelection, resolveDraftImages } from '@/lib/draft-images';
import { generationSchema } from '@/lib/validation';
import { GpuGraph } from '@/components/queue/gpu-graph';
import { SidebarQueue } from '@/components/queue/sidebar-queue';
import { DocumentationLink } from './documentation-link';

type View = 'envision' | 'favorites' | 'about';
type LibraryPage = {
  media: Media[];
  sections?: PromptSection[];
  revision?: number;
  nextCursor?: string | null;
  endCursor?: string | null;
};
const viewPath = (view: View) => (view === 'envision' ? '/' : `/${view}`);
const jobTitle = (job: Job) =>
  job.kind === 'setup'
    ? `Setup · ${(job.request as { name?:string }).name || job.request.pipeline?.metadata.name || (job.request as { task: string }).task}`
    : (job.request as Generation).mode === 'upscale'
      ? 'Enhance video to HD'
      : (job.request as Generation).prompt ||
        `${(job.request as Generation).videoPreset?.name || (job.request as Generation).videoStyle || 'Video'} animation`;
const isActive = (job: Job) => job.status === 'running' || job.status === 'queued';
export default function Studio({ children }: { children: ReactNode }) {
  const router = useRouter(),
    pathname = usePathname();
  const route = studioRoute(pathname);
  const view = route?.view || 'not-found';
  const filter = route?.view === 'favorites' ? route.filter : 'all';
  const [resettingSession, setResettingSession] = useState(false);
  const resetting = useRef(false);
  function resetPending(pending: boolean) {
    resetting.current = pending;
    setResettingSession(pending);
  }
  const library = view === 'favorites';
  const { presets, error: presetError, resolveGeneration } = useVideoPresets();
  const { request, setRequest, storageError } = useComposer();
  const draftImages = useDraftImages(request.sourceId, request.referenceIds);
  const [sections, setSections] = useState<PromptSection[]>([]);
  const [scrollToImageJob, setScrollToImageJob] = useState<string>();
  const composerRef = useRef<HTMLDivElement>(null);
  const workspaceEpoch = useRef(0),
    through = useRef<string | null>(null),
    focusComposer = useRef(false);
  const [media, setMedia] = useState<Media[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [health, setHealth] = useState<Health>();
  const [telemetry, setTelemetry] = useState<Telemetry>();
  const [checkingHealth, setCheckingHealth] = useState(false);
  const healthSequence = useRef(0);
  const [uploads, setUploads] = useState<Media[]>([]);
  const [deleting, setDeleting] = useState<DeleteTarget>();
  const [deletingJob, setDeletingJob] = useState<{ job?: Job }>();
  const [jobSources, setJobSources] = useState<Media[]>([]);
  const deletedIds = useRef(new Set<string>()),
    mediaRevision = useRef<number | undefined>(undefined);
  const [onboarding, setOnboarding] = useState(false);
  const welcomeSeen = useRef(false);
  const [advanced, setAdvanced] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [uploading, setUploading] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(true),
    [hasMore, setHasMore] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    textRef = useRef<HTMLTextAreaElement>(null);
  const mediaPage = useRef(0),
    nextCursor = useRef<string | null>(null),
    submissionLock = useRef(false);
  const favoriteLocks = useRef(new Set<string>()),
    [favoriting, setFavoriting] = useState<string[]>([]);
  const [draggingJob, setDraggingJob] = useState<string>(),
    [dropBefore, setDropBefore] = useState<string | null>(),
    [movingQueue, setMovingQueue] = useState(false);
  const queueMoveLock = useRef(false);
  const jobLocks = useRef(new Set<string>()),
    [busyJobs, setBusyJobs] = useState<string[]>([]);
  useEffect(() => {
    const current = studioRoute(pathname);
    if (
      current?.view === 'settings' &&
      current.section !== 'welcome' &&
      pathname !== settingsPath(current.section)
    )
      router.replace(settingsPath(current.section) + window.location.search + window.location.hash);
  }, [pathname, router]);
  const currentView = useRef(view);
  currentView.current = view;
  const currentFilter = useRef(filter);
  currentFilter.current = filter;
  const refresh = useCallback(async () => {
    if (resetting.current) return;
    try {
      const loadedThrough = through.current;
      const endpoint =
        view === 'envision'
          ? `envision${loadedThrough ? `?through=${encodeURIComponent(loadedThrough)}` : ''}`
          : library
            ? `media?favorites=true${filter === 'all' ? '' : `&kind=${filter}`}`
            : 'media?sessions=';
      const [m, j, t] = await Promise.all([
        api<LibraryPage>(endpoint),
        api<{ jobs: Job[]; sources?: Media[] }>('jobs'),
        api<Telemetry>('telemetry'),
      ]);
      if (
        resetting.current ||
        currentView.current !== view ||
        currentFilter.current !== filter ||
        (view === 'envision' && loadedThrough !== through.current)
      )
        return;
      if (view === 'envision') {
        setSections(m.sections || []);
        through.current = m.endCursor || null;
      }
      const changed =
        mediaRevision.current !== undefined &&
        m.revision !== undefined &&
        mediaRevision.current !== m.revision;
      mediaRevision.current = m.revision;
      if (changed) mediaPage.current = 0;
      setJobSources((j.sources || []).filter((item) => !deletedIds.current.has(item.id)));
      setMedia((previous) => {
        const fresh = m.media.filter((item) => !deletedIds.current.has(item.id));
        if (view === 'envision') return fresh;
        const received = new Set(fresh.map(assetId));
        return groupAssets([
          ...fresh,
          ...(!changed && mediaPage.current
            ? previous.filter(
                (item) => !deletedIds.current.has(item.id) && !received.has(assetId(item)),
              )
            : []),
        ]);
      });
      if (!mediaPage.current || view === 'envision') {
        nextCursor.current = m.nextCursor || null;
        setHasMore(!!nextCursor.current);
      }
      setJobs(j.jobs);
      setTelemetry(t);
    } catch (e) {
      if (!resetting.current) setError((e as Error).message);
    } finally {
      if (!resetting.current) setLoading(false);
    }
  }, [view, filter, library]);
  const refreshHealth = useCallback(async (force = false) => {
    if (resetting.current) return;
    const sequence = ++healthSequence.current;
    if (force) setCheckingHealth(true);
    try {
      const next = await api<Health>(force ? 'health?refresh=1' : 'health');
      if (!resetting.current && sequence === healthSequence.current) setHealth(next);
    } catch {
      if (!resetting.current && sequence === healthSequence.current) setHealth(undefined);
    } finally {
      if (!resetting.current && sequence === healthSequence.current) setCheckingHealth(false);
    }
  }, []);
  useEffect(() => {
    setMedia([]);
    setLoading(true);
    mediaPage.current = 0;
    nextCursor.current = null;
    setHasMore(false);
  }, [view, filter]);
  useEffect(() => {
    setDeleting(undefined);
  }, [pathname]);
  useEffect(() => {
    if (view === 'envision' && focusComposer.current) {
      focusComposer.current = false;
      textRef.current?.focus();
    }
  }, [view]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    void refreshHealth(true);
    const timer = setInterval(() => void refreshHealth(), 10000);
    const focus = () => void refreshHealth(true);
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refreshHealth]);
  useEffect(() => {
    if (!health || welcomeSeen.current) return;
    welcomeSeen.current = true;
    if (!health.setupDismissed) setOnboarding(true);
  }, [health, view]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!scrollToImageJob) return;
    if (view !== 'envision') {
      setScrollToImageJob(undefined);
      return;
    }
    const section = sections.find((item) => item.jobIds.includes(scrollToImageJob));
    if (!section || !jobs.some((job) => job.id === scrollToImageJob)) return;
    // Wait for the new batch slots to mount, then scroll once. Polling must not pull the user back down.
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`prompt-end-${section.id}`);
      if (!target) return;
      const details = target.closest('details');
      if (details) details.open = true;
      const visibleBottom =
        Math.min(
          window.innerHeight,
          composerRef.current?.getBoundingClientRect().top ?? window.innerHeight,
        ) - 24;
      window.scrollTo({
        top: Math.max(0, window.scrollY + target.getBoundingClientRect().bottom - visibleBottom),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
      setScrollToImageJob(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollToImageJob, view, sections, jobs]);
  const queue = queueView(jobs),
    { active, running, pending, failed, completed, cancelled, unfinished } = queue;
  const finished = [...completed, ...cancelled].sort((a, b) =>
    (b.finishedAt || b.updatedAt).localeCompare(a.finishedAt || a.updatedAt),
  );
  const hasCreations = sections.length > 0;
  const collection = groupAssets(media).filter((m) => view !== 'favorites' || m.favorite);
  const visible = collection.filter((m) => filter === 'all' || m.kind === filter);
  const availableMedia = [
    ...new Map([...jobSources, ...uploads, ...media].map((item) => [item.id, item])).values(),
  ].filter((item) => !deletedIds.current.has(item.id));
  const gallery: GalleryEntry[] = visible.map((item) => ({
    key: assetId(item),
    kind: 'media',
    media: item,
  }));
  const promptSections = promptGallery(sections, availableMedia, jobs);
  const attachments = [
    ...draftImages.items.map((item) => ({ id: item.id, url: item.previewUrl })),
    ...uploads.map((item) => ({ id: item.id, url: mediaUrl(item.id) })),
    ...media.map((item) => ({ id: item.id, url: mediaUrl(item.id) })),
  ];
  const source = attachments.find((item) => item.id === request.sourceId);
  const references = request.referenceIds.flatMap((id) =>
    attachments.filter((item) => item.id === id).slice(0, 1),
  );
  const issue =
    generationIssue(health, request.mode, request.sourceId, request.pipelineId) ||
    promptEnhancementIssue(health, request.enhance);
  const blocked = issue?.message;
  const missing = missingSetup(health);
  const needsSetup = !!health && missing.length > 0;
  const setupDescription = needsSetup
    ? `Setup needed: ${missing.map((item) => item.name).join(', ')}`
    : health
      ? 'Settings · All required models are ready'
      : 'Settings · Checking setup';
  function openSetup(target?: SetupTarget) {
    router.push(
      target === 'prompt'
        ? '/settings?service=ollama#setup-prompt'
        : target === 'ffmpeg'
          ? '/settings/advanced#video-tools-folder'
          : target
            ? `${['worker', 'runner'].includes(target) ? '/settings' : '/settings/generation'}#setup-${target}`
            : '/settings',
    );
  }
  function openQueue(id?: string) {
    router.push(id ? `/queue/${encodeURIComponent(id)}` : '/queue');
  }
  function finishWelcome(destination?: string) {
    setOnboarding(false);
    if (destination) router.push(destination);
    else if (pathname === '/settings/welcome') router.replace('/settings');
  }
  const patch = (p: Partial<Generation>) =>
    setRequest((r) => {
      const mode = p.mode || r.mode,
        choices = { ...r.pipelineChoices, ...p.pipelineChoices };
      if (Object.hasOwn(p, 'pipelineId') && (!p.mode || p.mode === r.mode))
        choices[mode] = p.pipelineId;
      return {
        ...r,
        ...p,
        pipelineChoices: choices,
        pipelineId:
          Object.hasOwn(p, 'pipelineId') && (!p.mode || p.mode === r.mode)
            ? p.pipelineId
            : mode !== r.mode
              ? choices[mode]
              : r.pipelineId,
      };
    });
  function changeMode(mode: Generation['mode']) {
    if (submissionLock.current) return;
    const selected = draftModeSelection(request, mode, draftImages.items);
    if (
      mode === 'video' &&
      request.referenceIds.filter((id) => draftImages.items.some((item) => item.id === id)).length >
        1
    )
      setNotice('Using the first reference as the starting image.');
    patch({
      mode,
      ...selected,
      pipelineId: undefined,
      adapters: undefined,
      videoStyle: undefined,
      videoPreset: undefined,
    });
  }
  function changeView(next: View) {
    router.push(viewPath(next));
  }
  async function submit(input = request, stay = false): Promise<Job | undefined> {
    const reason = generationBlocker(health, input.mode, input.sourceId, input.pipelineId);
    if (input.enhance && !health?.ollama) {
      setError(
        health?.capabilities?.prompt.detail ||
          'Choose a prompt enhancement model in Settings → Services.',
      );
      openSetup('prompt');
      return;
    }
    if (reason) {
      setError(reason);
      openSetup(generationIssue(health, input.mode, input.sourceId, input.pipelineId)?.target);
      return;
    }
    if (submissionLock.current) return;
    submissionLock.current = true;
    setError('');
    setSubmitting(true);
    const epoch = workspaceEpoch.current;
    try {
      const clean = generationSchema.parse(resolveGeneration(input));
      const prepared = await resolveDraftImages(
        clean,
        draftImages.items,
        async (file, purpose) => {
          setUploading(true);
          const data = new FormData();
          data.set('image', file);
          data.set('purpose', purpose);
          const result = await api<{ media: Media }>('upload', 'POST', data);
          if (epoch === workspaceEpoch.current) setUploads((items) => [...items, result.media]);
          return result.media;
        },
        async (media) => {
          const response = await fetch(`/api/media/${media.id}`, {
            method: 'HEAD',
            credentials: 'same-origin',
            cache: 'no-store',
          });
          if (response.status === 404) return false;
          if (!response.ok) throw Error('Could not check the uploaded image. Try again.');
          return true;
        },
      );
      setUploading(false);
      const { job } = await api<{ job: Job }>('jobs', 'POST', prepared.request);
      setJobs((previous) => [job, ...previous.filter((j) => j.id !== job.id)]);
      if (epoch === workspaceEpoch.current && prepared.replacements.size)
        setRequest((current) => ({
          ...current,
          sourceId: current.sourceId
            ? (prepared.replacements.get(current.sourceId)?.id ?? current.sourceId)
            : undefined,
          referenceIds: current.referenceIds.map((id) => prepared.replacements.get(id)?.id ?? id),
        }));
      if (
        epoch === workspaceEpoch.current &&
        input.mode === 'image' &&
        currentView.current === 'envision'
      )
        setScrollToImageJob(job.id);
      const uploadedSource = input.sourceId && prepared.replacements.get(input.sourceId);
      if (epoch === workspaceEpoch.current && uploadedSource && currentView.current === 'envision')
        router.push(mediaPath(uploadedSource));
      else if (epoch === workspaceEpoch.current && !stay && view !== 'envision')
        changeView('envision');
      await refresh();
      setNotice(
        input.mode === 'image'
          ? `${input.count} images queued`
          : input.mode === 'upscale'
            ? 'HD enhancement queued'
            : 'Video queued',
      );
      return job;
    } catch (e) {
      setError((e as Error).message);
      void refreshHealth();
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
      setUploading(false);
    }
  }
  function stageImages(files: FileList | File[] | null) {
    if (!files?.length || submissionLock.current) return;
    setError('');
    const isRef = request.mode === 'reference',
      count = isRef ? 9 - request.referenceIds.length : 1;
    if (files.length > count)
      setNotice(
        isRef
          ? 'You can add up to 9 reference images.'
          : 'Using the first image as your starting frame.',
      );
    try {
      const added = draftImages.stage(Array.from(files).slice(0, count));
      if (isRef)
        patch({ referenceIds: [...request.referenceIds, ...added.map((item) => item.id)] });
      else if (added[0])
        patch({
          mode: 'video',
          sourceId: added[0].id,
          referenceIds: [],
          videoStyle: undefined,
          videoPreset: undefined,
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  async function favorite(item: Media) {
    const id = assetId(item);
    if (favoriteLocks.current.has(id)) return;
    favoriteLocks.current.add(id);
    setFavoriting([...favoriteLocks.current]);
    try {
      const result = await api<{ media: Media }>(`media/${item.id}`, 'PATCH', {
        favorite: !item.favorite,
      });
      const update = (value: Media) =>
        assetId(value) === id ? { ...value, favorite: result.media.favorite } : value;
      setMedia((items) => items.map(update));
      setUploads((items) => items.map(update));
      setJobSources((items) => items.map(update));
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      favoriteLocks.current.delete(id);
      setFavoriting([...favoriteLocks.current]);
    }
  }
  function chooseMotion(value: string) {
    const choice = motionChoices(presets).find((item) => item.value === value);
    if (!choice) return;
    if (draftImages.items.some((item) => item.id === request.sourceId)) {
      patch({ videoStyle: choice.videoStyle, videoPreset: choice.videoPreset });
      setAdvanced(false);
      if (choice.videoStyle === 'custom') textRef.current?.focus();
      return;
    }
    if (choice.videoStyle === 'custom') {
      setAdvanced(false);
      textRef.current?.focus();
      return;
    }
    if (blocked || submitting || uploading) return;
    setAdvanced(false);
    void submit({ ...request, ...motionChoiceInput(choice, request.prompt), count: 1 });
  }
  function makeVideo(item: Media) {
    void submit(
      animationRequest(item, undefined, { prompt: '', videoStyle: 'custom' }, request.enhance, {
        duration: request.duration,
        quality: request.quality,
        pipelineId: request.pipelineChoices?.video,
      }),
      true,
    );
  }
  async function moveJob(job: Job, action: 'move' | 'next' | 'start', beforeId?: string | null) {
    if (queueMoveLock.current) return;
    queueMoveLock.current = true;
    setMovingQueue(true);
    try {
      const result = await api<{ jobs: Job[] }>(`jobs/${job.id}/${action}`, 'POST', { beforeId });
      setJobs(result.jobs);
      setNotice(
        action === 'start'
          ? 'Job moved to the front. Any current job will stop and resume afterward.'
          : action === 'next'
            ? 'Job is next up.'
            : 'Queue order updated.',
      );
      void refresh();
    } catch (error) {
      setError((error as Error).message);
      void refresh();
    } finally {
      queueMoveLock.current = false;
      setMovingQueue(false);
      setDraggingJob(undefined);
      setDropBefore(undefined);
    }
  }
  async function jobAction(job: Job, action: 'cancel' | 'retry') {
    if (jobLocks.current.has(job.id)) return;
    jobLocks.current.add(job.id);
    setBusyJobs([...jobLocks.current]);
    try {
      const result = await api<{ job?: Job }>(`jobs/${job.id}/${action}`, 'POST', {});
      if (action === 'retry') {
        if (!result.job) throw Error('The retry did not create a job.');
        setJobs((previous) => [
          result.job!,
          ...previous.filter((item) => item.id !== result.job!.id),
        ]);
        setNotice('Retry queued.');
        openQueue(result.job.id);
      } else {
        if (result.job)
          setJobs((previous) => previous.map((item) => (item.id === job.id ? result.job! : item)));
        setNotice('Job cancelled. Its details and logs remain available.');
      }
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      jobLocks.current.delete(job.id);
      setBusyJobs([...jobLocks.current]);
    }
  }

  async function loadOlder() {
    const before = nextCursor.current;
    if (!before) return;
    try {
      const endpoint =
        view === 'envision'
          ? `envision?before=${encodeURIComponent(before)}`
          : `media?favorites=true${filter === 'all' ? '' : `&kind=${filter}`}&before=${encodeURIComponent(before)}`;
      const result = await api<LibraryPage>(endpoint);
      if (resetting.current || currentView.current !== view || currentFilter.current !== filter)
        return;
      if (result.revision !== undefined && mediaRevision.current !== result.revision) {
        await refresh();
        return;
      }
      if (nextCursor.current !== before) return;
      mediaPage.current++;
      nextCursor.current = result.nextCursor || null;
      setHasMore(!!result.nextCursor);
      if (view === 'envision') {
        through.current = result.endCursor || through.current;
        setSections((items) => [
          ...new Map(
            [...items, ...(result.sections || [])].map((item) => [item.id, item]),
          ).values(),
        ]);
      }
      setMedia((items) => {
        const merged = [
          ...items,
          ...result.media.filter((item) => !deletedIds.current.has(item.id)),
        ];
        return view === 'envision'
          ? [...new Map(merged.map((item) => [item.id, item])).values()]
          : groupAssets(merged);
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function onDeleted(ids: string[], cleanupPending = false) {
    if (cleanupPending)
      setError(
        'Records were deleted, but some file cleanup is pending. Frok will retry cleanup while running.',
      );
    ids.forEach((id) => deletedIds.current.add(id));
    const retained = (item: Media) => !deletedIds.current.has(item.id);
    setMedia((items) => items.filter(retained));
    setUploads((items) => items.filter(retained));
    setJobSources((items) => items.filter(retained));
    if (route?.view === 'media')
      router.replace(
        deletedIds.current.has(route.id) || route.legacy
          ? '/'
          : `/asset/${encodeURIComponent(route.id)}`,
        { scroll: false },
      );
    setRequest((value) => ({
      ...value,
      sourceId:
        value.sourceId && deletedIds.current.has(value.sourceId) ? undefined : value.sourceId,
      referenceIds: value.referenceIds.filter((id) => !deletedIds.current.has(id)),
      videoStyle:
        value.sourceId && deletedIds.current.has(value.sourceId) ? undefined : value.videoStyle,
      videoPreset:
        value.sourceId && deletedIds.current.has(value.sourceId) ? undefined : value.videoPreset,
    }));
    setNotice(
      deleting?.scope === 'section'
        ? 'Unsaved creations deleted · favorites kept'
        : `${ids.length} ${ids.length === 1 ? 'item' : 'items'} deleted`,
    );
    void refresh();
  }
  function newIdea() {
    workspaceEpoch.current++;
    setScrollToImageJob(undefined);
    setUploads([]);
    patch({
      prompt: '',
      sourceId: undefined,
      referenceIds: [],
      videoStyle: undefined,
      videoPreset: undefined,
      sectionId: undefined,
    });
    if (view === 'envision') textRef.current?.focus();
    else {
      focusComposer.current = true;
      changeView('envision');
    }
  }

  const renderJob = (job: Job) => (
    <div
      className={`job-row ${job.status}${draggingJob === job.id ? ' queue-dragging' : ''}${draggingJob && dropBefore === job.id ? ' queue-drop-before' : ''}${draggingJob && dropBefore === null && pending.at(-1)?.id === job.id ? ' queue-drop-after' : ''}`}
      key={job.id}
      onDragOver={(event) => {
        if (!draggingJob || job.status !== 'queued' || movingQueue) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        setDropBefore(
          event.clientY < rect.top + rect.height / 2
            ? job.id
            : (pending[pending.findIndex((item) => item.id === job.id) + 1]?.id ?? null),
        );
      }}
      onDrop={(event) => {
        if (!draggingJob || job.status !== 'queued') return;
        event.preventDefault();
        const source = pending.find((item) => item.id === draggingJob);
        if (source && dropBefore !== undefined && dropBefore !== source.id)
          void moveJob(source, 'move', dropBefore);
        else {
          setDraggingJob(undefined);
          setDropBefore(undefined);
        }
      }}
    >
      {(job.kind === 'generate' || isPreparationJob(job)) && job.status === 'queued' && route?.view === 'queue' && !route.id && (
        <button
          className="icon-button queue-drag-handle"
          draggable={!movingQueue}
          disabled={movingQueue}
          aria-label="Drag to reorder pending job"
          title="Drag to reorder pending job"
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', job.id);
            event.dataTransfer.effectAllowed = 'move';
            setDraggingJob(job.id);
          }}
          onDragEnd={() => {
            setDraggingJob(undefined);
            setDropBefore(undefined);
          }}
        >
          <GripVertical size={16} />
        </button>
      )}
      <div className={`job-status ${job.status}`}>
        {job.status === 'running' ? (
          <Loader2 size={18} className="spin" />
        ) : job.status === 'completed' ? (
          <Check size={18} />
        ) : job.status === 'queued' ? (
          <Clock3 size={18} />
        ) : job.status === 'cancelled' ? (
          <X size={18} />
        ) : (
          <CircleAlert size={18} />
        )}
      </div>
      <div className="job-body">
        <strong>{jobTitle(job)}</strong>
        <p>
          <span className="status-name">{job.status}</span> · {job.message}
        </p>
        {job.kind === 'generate' && job.status === 'running' && (
          <>
            <Progress job={job} />
            <small>
              {job.completed}/{job.total} saved
              {jobProgress(job).percent !== undefined ? ` · ${jobProgress(job).text}` : ''}
            </small>
          </>
        )}
        <JobRuntime job={job} />
        {job.error && (
          <details>
            <summary>Error details</summary>
            <pre>{job.error}</pre>
          </details>
        )}
        {job.kind === 'generate' && (job.request as Generation).adapters && (
          <details>
            <summary>Adapter settings</summary>
            <pre>{JSON.stringify((job.request as Generation).adapters, null, 2)}</pre>
          </details>
        )}
      </div>
      <div
        className="job-actions"
        inert={busyJobs.includes(job.id)}
        aria-busy={busyJobs.includes(job.id)}
      >
        {job.kind === 'generate' && job.status === 'queued' && (
          <>
            <button
              className="queue-quick-action"
              disabled={movingQueue || running?.kind === 'setup'}
              title="Run first; the current job will stop and resume afterward"
              onClick={() => void moveJob(job, 'start')}
            >
              <Play size={14} />
              Start immediately
            </button>
            <button
              className="queue-quick-action"
              disabled={movingQueue || pending[0]?.id === job.id}
              title="Run after the current job"
              onClick={() => void moveJob(job, 'next')}
            >
              <ArrowUp size={14} />
              Next Up
            </button>
          </>
        )}
        {!(route?.view === 'queue' && route.id === job.id) && (
          <Link
            className="icon-button job-log-link"
            title="View runner log"
            aria-label="View runner log"
            href={`/queue/${encodeURIComponent(job.id)}`}
          >
            <Terminal size={16} />
          </Link>
        )}
        {isActive(job) ? (
          <button
            className="icon-button"
            title={job.status === 'running' ? 'Stop job' : 'Cancel queued job'}
            aria-label={job.status === 'running' ? 'Stop job' : 'Cancel queued job'}
            onClick={() => void jobAction(job, 'cancel')}
          >
            <X size={17} />
          </button>
        ) : (
          <>
            {(job.kind === 'generate' || isPreparationJob(job)) && (job.status === 'failed' || job.status === 'cancelled') && (
              <button
                className="icon-button"
                title={job.kind === 'setup' ? "Retry preparation" : "Retry remaining outputs"}
                aria-label={job.kind === 'setup' ? "Retry preparation" : "Retry remaining outputs"}
                onClick={() => void jobAction(job, 'retry')}
              >
                <RefreshCw size={16} />
              </button>
            )}
            <button
              className="icon-button"
              title="Delete job and logs"
              aria-label="Delete job and logs"
              onClick={() => setDeletingJob({ job })}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
  const renderMedia = (item: Media, key: string) => {
    const rootId = assetId(item);
    const animations = active.filter(
      (job) =>
        job.kind === 'generate' &&
        ['video', 'reference', 'upscale'].includes((job.request as Generation).mode) &&
        ((job.request as Generation).rootId === rootId ||
          (job.request as Generation).sourceId === rootId ||
          availableMedia.some(
            (member) =>
              member.id === (job.request as Generation).sourceId && assetId(member) === rootId,
          )),
    );
    const animation = animations.find((job) => job.status === 'running') || animations[0];
    return (
      <AssetCard
        key={key}
        item={item}
        animation={animation}
        queued={animations.length - 1}
        submitting={submitting}
        saving={favoriting.includes(rootId)}
        href={mediaPath(item)}
        onFavorite={() => void favorite(item)}
        onDelete={() => setDeleting({ scope: 'media', id: rootId })}
        onAnimate={() => (animation ? openQueue(animation.id) : makeVideo(item))}
      />
    );
  };
  const composer = (
    <div ref={composerRef} className={`composer-wrap ${hasCreations ? 'docked' : ''}`}>
      {issue && health && (
        <div className="readiness-warning" role="status">
          <CircleAlert size={19} />
          <div>
            <strong>{issue.message}</strong>
            <button onClick={() => openSetup(issue.target)}>
              {issue.action}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
      <div
        className="composer"
        inert={submitting}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          stageImages(e.dataTransfer.files);
        }}
      >
        {(source || references.length > 0) && (
          <div className="attachments">
            {(source ? [source] : references).map((item, index) => (
              <div className="attachment" key={item.id}>
                <img src={item.url} alt={source ? 'Starting frame' : `Reference ${index + 1}`} />
                <span>{source ? 'First frame' : `Ref ${index + 1}`}</span>
                <button
                  aria-label={`Remove ${source ? 'starting frame' : `reference ${index + 1}`}`}
                  onClick={() =>
                    source
                      ? patch({
                          sourceId: undefined,
                          videoStyle: undefined,
                          videoPreset: undefined,
                        })
                      : patch({ referenceIds: request.referenceIds.filter((id) => id !== item.id) })
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {request.mode === 'reference' && references.length < 9 && (
              <button
                className="add-reference"
                onClick={() => fileRef.current?.click()}
                aria-label="Add reference"
              >
                <Plus size={20} />
              </button>
            )}
          </div>
        )}
        <label className="visually-hidden" htmlFor="prompt">
          Describe what you want to envision
        </label>
        <textarea
          id="prompt"
          ref={textRef}
          value={request.prompt}
          maxLength={8000}
          rows={hasCreations ? 2 : 4}
          placeholder={
            request.mode === 'reference'
              ? 'Describe your video. Use <Picture 1> to refer to an image…'
              : source
                ? 'Let it move naturally, or describe what happens next…'
                : 'Type to envision'
          }
          onChange={(e) => patch({ prompt: e.target.value })}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              if (!blocked) void submit();
            }
          }}
        />
        <div className="composer-controls">
          <div className="control-left">
            <button
              className="icon-button add-image"
              aria-label="Add image"
              title="Add a starting image or reference"
              disabled={submitting}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 size={19} className="spin" /> : <Plus size={20} />}
            </button>
            <label className="select-control mode-select">
              {request.mode === 'image' ? (
                <ImageIcon size={16} />
              ) : request.mode === 'reference' ? (
                <Layers3 size={16} />
              ) : (
                <Film size={16} />
              )}
              <span className="select-value" aria-hidden="true">
                {request.mode === 'image'
                  ? 'Image'
                  : request.mode === 'reference'
                    ? 'References'
                    : 'Video'}
              </span>
              <select
                aria-label="Generation mode"
                value={request.mode}
                onChange={(e) => changeMode(e.target.value as Generation['mode'])}
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
                <option value="reference">References</option>
              </select>
              <ChevronDown size={12} />
            </label>
            <label
              className="select-control ratio-select"
              title={source ? 'Matches the starting frame' : 'Aspect ratio'}
            >
              <span className={`ratio-icon ratio-${request.aspect.replace(':', '-')}`} />
              <span className="select-value" aria-hidden="true">
                {request.aspect}
              </span>
              <select
                aria-label="Aspect ratio"
                disabled={!!source}
                value={request.aspect}
                onChange={(e) => patch({ aspect: e.target.value })}
              >
                {(
                  selectedPipeline(health, request.mode, request.pipelineId)?.controls.aspects || [
                    '1:1',
                    '3:4',
                    '4:3',
                    '9:16',
                    '16:9',
                    '3:2',
                    '2:3',
                  ]
                ).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
            {request.mode !== 'image' && (
              <label className="select-control duration-select">
                <span className="select-value" aria-hidden="true">
                  {request.duration}s
                </span>
                <select
                  aria-label="Video duration"
                  value={request.duration}
                  onChange={(e) => patch({ duration: Number(e.target.value) })}
                >
                  {(
                    selectedPipeline(health, request.mode, request.pipelineId)?.controls
                      .durations || [6, 8, 10]
                  ).map((n) => (
                    <option value={n} key={n}>
                      {n}s
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </label>
            )}
            <button
              type="button"
              className={`icon-button generation-settings-toggle ${request.mode === 'image' ? 'with-count' : ''} ${advanced ? 'on' : ''}`}
              title={
                request.mode === 'image'
                  ? `Generation settings · ${request.count} ${request.count === 1 ? 'image' : 'images'} per batch`
                  : 'Generation settings'
              }
              aria-label="Generation settings"
              aria-description={
                request.mode === 'image'
                  ? `${request.count} ${request.count === 1 ? 'image' : 'images'} per batch`
                  : undefined
              }
              aria-haspopup="dialog"
              aria-expanded={advanced}
              aria-controls={advanced ? 'generation-settings' : undefined}
              onClick={() => setAdvanced(true)}
            >
              <SlidersHorizontal size={17} />
              {request.mode === 'image' && (
                <span className="generation-count" aria-hidden="true">
                  {request.count}
                </span>
              )}
            </button>
          </div>
          <button
            className="create-button"
            aria-label="Generate"
            title={blocked || 'Generate · ⌘ / Ctrl + Enter'}
            disabled={
              !!blocked ||
              (!request.prompt.trim() && !(request.mode === 'video' && request.sourceId)) ||
              submitting ||
              uploading ||
              (request.mode === 'reference' && !references.length)
            }
            onClick={() => void submit()}
          >
            {submitting ? <Loader2 size={18} className="spin" /> : <ArrowUp size={20} />}
          </button>
        </div>
      </div>
      {advanced && (
        <GenerationSettings
          stagedSource={draftImages.items.some((item) => item.id === request.sourceId)}
          request={request}
          health={health}
          presets={presets}
          presetError={presetError}
          storageError={storageError}
          disabled={!!blocked || submitting || uploading}
          onPatch={patch}
          onChoose={(choice) => {
            setAdvanced(false);
            chooseMotion(choice);
          }}
          onDone={() => setAdvanced(false)}
        />
      )}
      <div className="composer-footnote">
        {!health ? (
          <span>Checking local setup…</span>
        ) : (
          !blocked && (
            <span>
              <span className="mode-ready">
                <Check size={12} />
                Ready for{' '}
                {request.mode === 'image'
                  ? 'images'
                  : request.mode === 'reference'
                    ? 'reference video'
                    : 'video'}
              </span>
              <span className="generation-summary">
                {request.mode === 'image'
                  ? `${selectedPipeline(health, request.mode, request.pipelineId)?.name || ''} · ${request.count} images · ${request.quality === 'preview' ? 'Fast previews' : 'Full size'}`
                  : `${source ? 'Matches your image · ' : ''}${request.quality === 'preview' ? '480p' : '720p'} · ${request.duration}s`}
              </span>
              <span className="shortcut">⌘ / Ctrl + Enter</span>
            </span>
          )
        )}
      </div>
    </div>
  );
  return (
    <div className="studio" aria-busy={resettingSession}>
      <aside inert={resettingSession} className="sidebar" aria-label="Main navigation">
        <div className="sidebar-top">
          <Link className="wordmark" href="/" aria-label="Frok home">
            <BrandMark />
            <span>Frok</span>
          </Link>
          <nav>
            {(
              [
                { id: 'envision', label: 'Envision', Icon: ImageIcon },
                { id: 'favorites', label: 'Favorites', Icon: Heart },
              ] as const
            ).map(({ id, label, Icon }) => (
              <Link
                key={id}
                href={viewPath(id)}
                aria-label={label}
                aria-current={view === id ? 'page' : undefined}
              >
                <Icon size={17} />
                <span>{label}</span>
              </Link>
            ))}
            <Link
              href="/settings"
              title={setupDescription}
              aria-label="Settings"
              aria-current={view === 'settings' ? 'page' : undefined}
            >
              <Settings size={17} />
              <span>Settings</span>
              {needsSetup && (
                <span className="setup-dot settings-badge" aria-hidden="true">
                  !
                </span>
              )}
            </Link>
            <DocumentationLink onError={setError} />
          </nav>
          <button className="new-idea" aria-label="New idea" onClick={newIdea}>
            <Plus size={17} />
            <span>New idea</span>
          </button>
        </div>
        <div className="sidebar-bottom">
          <SidebarQueue
            queue={queue}
            worker={health?.worker}
            telemetry={telemetry}
            current={view === 'queue'}
            stopping={!!running && busyJobs.includes(running.id)}
            title={running ? jobTitle(running) : pending[0] ? jobTitle(pending[0]) : ''}
            onStop={(job) => void jobAction(job, 'cancel')}
          />
          <div className="sidebar-footer">
            <Link
              className="sidebar-about"
              href="/about"
              title="About Frok"
              aria-label="About Frok"
              aria-current={view === 'about' ? 'page' : undefined}
            >
              <Info size={15} />
              <span>Frok · About</span>
            </Link>
            <Link href="/utils" className="sidebar-about" title="Utilities" aria-label="Utilities">
              <Wrench size={15} />
              <span>Utilities</span>
            </Link>
            <SocialLinks />
          </div>
        </div>
      </aside>
      <main
        className={`workspace ${view === 'about' ? 'about-view' : view === 'envision' ? (hasCreations ? 'session-view' : 'landing-view') : library ? 'library-view' : 'page-view'}`}
      >
        {children}
        {!resettingSession &&
          (onboarding || (route?.view === 'settings' && route.section === 'welcome')) && (
            <Setup
              wizard
              jobs={jobs}
              health={health}
              checkingHealth={checkingHealth}
              onRefresh={async () => {
                await Promise.all([refreshHealth(true), refresh()]);
              }}
              enhance={request.enhance}
              onEnhancementChange={(enhance) => patch({ enhance })}
              onFinished={finishWelcome}
            />
          )}
        {deleting && (
          <DeleteConfirmation
            key={JSON.stringify(deleting)}
            target={deleting}
            onClose={() => setDeleting(undefined)}
            onDeleted={onDeleted}
          />
        )}
        {route?.view === 'settings' ? (
          <PageShell
            showBack={false}
            title="Settings"
            fallback="/"
            className="settings-route"
            busy={resettingSession}
          >
            <Setup
              jobs={jobs}
              key={route.section}
              section={route.section === 'welcome' ? 'services' : route.section}
              enhance={request.enhance}
              onEnhancementChange={(enhance) => patch({ enhance })}
              resetting={resettingSession}
              onResetting={resetPending}
              onOnboarding={() => setOnboarding(true)}
              checkingHealth={checkingHealth}
              health={health}
              onRefresh={async () => {
                await Promise.all([refreshHealth(true), refresh()]);
              }}
            />
          </PageShell>
        ) : route?.view === 'queue' ? (
          <PageShell
            showBack={!!route.id}
            title={route.id ? 'Job & runner log' : 'Queue'}
            fallback={route.id ? '/queue' : '/'}
          >
            {route.id ? (
              <JobLog key={route.id} id={route.id} renderJob={renderJob} />
            ) : (
              <>
                <div className="queue-toolbar">
                  <p className="muted">
                    One job at a time · {pending.length} pending · Drag pending jobs to reorder
                  </p>
                  <button
                    disabled={!failed.length && !completed.length && !cancelled.length}
                    onClick={() => setDeletingJob({})}
                  >
                    <Trash2 size={14} />
                    Delete finished jobs
                  </button>
                </div>
                {running && <GpuGraph telemetry={telemetry} />}
                <div className="job-list">
                  {!unfinished.length && !completed.length && !cancelled.length ? (
                    <p className="empty-state muted">Your queue is empty.</p>
                  ) : unfinished.length ? (
                    unfinished.map(renderJob)
                  ) : (
                    <p className="queue-idle">
                      <Check size={16} />
                      Nothing waiting. Finished jobs are below.
                    </p>
                  )}
                </div>
                {finished.length > 0 && (
                  <details className="completed-jobs">
                    <summary>
                      <ChevronRight size={15} />
                      <span>Finished jobs</span>
                      <span className="completed-count">{finished.length}</span>
                    </summary>
                    <div className="job-list">{finished.map(renderJob)}</div>
                  </details>
                )}
              </>
            )}
          </PageShell>
        ) : route?.view === 'media' ? (
          <PageShell
            title="Creation"
            description="Starting asset and every video render, together."
            fallback="/"
            className="media-route"
          >
            <MediaPage
              key={route.id}
              id={route.id}
              renderNumber={route.renderNumber}
              legacy={route.legacy}
              preferences={{ ...request, pipelineId: request.pipelineChoices?.video }}
              onPreferencesChange={(change, mode = 'video') => {
                const { pipelineId, ...rest } = change;
                patch({
                  ...rest,
                  ...(Object.hasOwn(change, 'pipelineId')
                    ? {
                        pipelineChoices: { ...request.pipelineChoices, [mode]: pipelineId },
                        ...(request.mode === mode ? { pipelineId } : {}),
                      }
                    : {}),
                });
              }}
              storageError={storageError}
              health={health}
              jobs={jobs}
              submitting={submitting}
              onGenerate={(input) => submit(input, true)}
              onSetup={(target) => openSetup(target)}
              onQueue={openQueue}
              onChanged={() => void refresh()}
              onDelete={(item) => setDeleting({ scope: 'media', id: item.id })}
            />
          </PageShell>
        ) : route?.view === 'utils' ? (
          <PageShell title="Utilities" fallback="/settings/advanced">
            <PipelineUtils />
          </PageShell>
        ) : view === 'about' ? (
          <>
            <div className="standalone-back">
              <BackButton />
            </div>
            <About
              onCreate={() => changeView('envision')}
              onSetup={() => router.push('/settings/welcome')}
            />
          </>
        ) : view === 'envision' ? (
          <>
            {!hasCreations && (
              <div className="landing">
                <h1>Envision anything.</h1>
                {composer}
              </div>
            )}
            {hasCreations && (
              <>
                <header className="session-header">
                  <span>Envision</span>
                  <PromptJump sections={sections} />
                  <button
                    className="clear-history"
                    onClick={() => setDeleting({ scope: 'history' })}
                  >
                    <Trash2 size={14} />
                    Clear unsaved
                  </button>
                  <button onClick={newIdea}>
                    <Plus size={15} />
                    New idea
                  </button>
                </header>
                {composer}
              </>
            )}
          </>
        ) : library ? (
          <header className="library-header">
            <div>
              <h1>Favorites</h1>
              <p>The things you love, saved on your machine.</p>
            </div>
            <nav className="filter-tabs" aria-label="Filter media">
              {(['all', 'image', 'video'] as const).map((kind) => (
                <Link
                  key={kind}
                  aria-current={filter === kind ? 'page' : undefined}
                  className={filter === kind ? 'active' : ''}
                  href={kind === 'all' ? '/favorites' : `/favorites/${kind}s`}
                >
                  {kind === 'all' ? 'All' : kind === 'image' ? 'Images' : 'Videos'}
                </Link>
              ))}
            </nav>
          </header>
        ) : null}
        {(library || (view === 'envision' && hasCreations)) && (
          <section
            aria-label={view === 'envision' ? 'Your creations' : 'Saved media'}
            className="gallery"
          >
            {view === 'envision' ? (
              <PromptSections
                sections={promptSections}
                submitting={submitting}
                moreDisabled={(section) =>
                  !section.request ||
                  !!generationBlocker(
                    health,
                    section.request.mode,
                    section.request.sourceId,
                    section.request.pipelineId,
                  )
                }
                onMore={(section) => void submit(sectionRequest(section), true)}
                onDelete={(section) =>
                  setDeleting({ scope: 'section', sectionId: section.id, jobIds: [] })
                }
                renderEntry={(entry) =>
                  entry.kind === 'media' ? (
                    renderMedia(entry.media, entry.key)
                  ) : (
                    <PendingCard
                      key={entry.key}
                      entry={entry}
                      onQueue={() => openQueue(entry.job.id)}
                    >
                      {entry.state === 'generating' && <Progress job={entry.job} />}
                    </PendingCard>
                  )
                }
              />
            ) : (
              <div className="media-grid">
                {gallery.map((entry) =>
                  entry.kind === 'media' ? renderMedia(entry.media, entry.key) : null,
                )}
              </div>
            )}
            {!visible.length && library && (
              <div className="empty-state">
                {loading ? <Loader2 className="spin" size={22} /> : <Heart size={28} />}
                <h2>{loading ? 'Loading…' : 'Save something you love'}</h2>
                {!loading && <p>Tap a heart to save an image. Videos are saved automatically.</p>}
              </div>
            )}
            {hasMore && (
              <div className="load-more">
                <button className="secondary" onClick={() => void loadOlder()}>
                  {view === 'envision' ? 'Show older prompts' : 'Load older creations'}
                </button>
              </div>
            )}
          </section>
        )}
      </main>
      <input
        className="visually-hidden"
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple={request.mode === 'reference'}
        onChange={(e) => stageImages(e.target.files)}
      />
      {deletingJob && (
        <DeleteJobsConfirmation
          job={deletingJob.job}
          onClose={() => setDeletingJob(undefined)}
          onDeleted={(pending) => {
            setDeletingJob(undefined);
            if (pending)
              setError(
                'Job records were deleted, but some file cleanup is pending. Frok will retry cleanup while running.',
              );
            else setNotice('Job details and logs deleted. Saved media was kept.');
            if (route?.view === 'queue' && route.id) router.replace('/queue');
            void refresh();
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
