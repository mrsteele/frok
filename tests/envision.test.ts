import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { initializePromptLibrary, listPromptLibrary, registerPromptJob, registerPromptMedia } from '../src/lib/prompt-library';
import { promptGallery, sectionRequest } from '../src/lib/envision';
import type { Generation, Job, Media } from '../src/lib/types';

const input: Generation = {mode:'image',prompt:'Paper boats',aspect:'4:3',duration:6,quality:'preview',count:4,enhance:false,referenceIds:[],seed:123};
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE media(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,status TEXT,created_at TEXT,data TEXT);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  initializePromptLibrary(db);
  let clock = 0;
  const time = () => new Date(Date.UTC(2026,0,1,0,0,clock++)).toISOString();
  function job(request: Partial<Generation> = {}, status: Job['status'] = 'queued') {
    const at=time(), draft: Job={id:randomUUID(),kind:'generate',request:{...input,...request},runner:'vpipe',status,completed:status==='completed'?4:0,total:request.count??4,message:'Synthetic job',createdAt:at,updatedAt:at};
    const saved=registerPromptJob(db,draft);
    db.prepare('INSERT INTO jobs VALUES (?,?,?,?)').run(saved.id,saved.status,saved.createdAt,JSON.stringify(saved));
    return saved;
  }
  function media(job?: Job, patch: Partial<Media> = {}) {
    const id=randomUUID(), request=job?.request as Generation|undefined;
    const draft: Media={id,rootId:id,jobId:job?.id,kind:'image',filename:'synthetic.jpg',prompt:request?.prompt??'Uploaded image',enhancedPrompt:request?.prompt??'',width:640,height:480,seed:1,batchIndex:0,favorite:false,origin:job?'generated':'upload',createdAt:time(),generation:request,...patch};
    const saved=registerPromptMedia(db,draft);
    db.prepare('INSERT INTO media VALUES (?,?)').run(saved.id,JSON.stringify(saved));
    return saved;
  }
  return {db,job,media,page:()=>listPromptLibrary(db),close:()=>db.close()};
}

test('new prompt sections appear newest first, even with identical text', () => {
  const f=fixture();try {
    const first=f.job(), second=f.job(), third=f.job({prompt:'Blue mountains'});
    assert.deepEqual(f.page().sections.map(s=>s.id),[third.id,second.id,first.id]);
    assert.deepEqual(f.page().sections.map(s=>s.prompt),['Blue mountains','Paper boats','Paper boats']);
    initializePromptLibrary(f.db);
    assert.deepEqual(f.page().sections.map(s=>s.id),[third.id,second.id,first.id]);
  }finally{f.close();}
});

test('Load more preserves a section position and settings, appending fresh batch slots after its images', () => {
  const f=fixture();try {
    const first=f.job({},'completed'), images=Array.from({length:4},(_,batchIndex)=>f.media(first,{batchIndex}));
    const newer=f.job({aspect:'3:4',enhance:true});
    const section=f.page().sections.find(s=>s.id===first.id)!;
    const more=sectionRequest(section);
    assert.equal(more.seed,undefined);assert.equal(more.sectionId,first.id);assert.equal(more.aspect,'4:3');
    more.referenceIds.push('isolated');assert.deepEqual(section.request!.referenceIds,[]);
    const next=f.job(sectionRequest(section),'running'), page=f.page();
    assert.deepEqual(page.sections.map(s=>s.id),[newer.id,first.id]);
    assert.equal(page.sections[1].createdAt,section.createdAt);
    const grid=promptGallery(page.sections,page.media,[first,newer,next])[1];
    assert.equal(grid.entries.length,8);
    assert.deepEqual(grid.entries.slice(0,4).map(e=>e.kind==='media'&&e.media.id),images.map(m=>m.id));
    assert.equal(grid.entries.filter(e=>e.kind==='pending').length,4);
  }finally{f.close();}
});

test('a missing section cannot silently add work to another same-prompt section', () => {
  const f=fixture();try { f.job(); assert.throws(()=>f.job({sectionId:randomUUID()}),/no longer available/); }
  finally{f.close();}
});

test('SD and HD videos stay in their root section without replacing its image Load more settings', () => {
  const f=fixture();try {
    const first=f.job({},'completed'), root=f.media(first);
    const other=f.job({},'completed'); f.media(other);
    const video=f.job({mode:'video',sourceId:root.id,prompt:'Drift left',count:1},'completed');
    const clip=f.media(video,{kind:'video',sourceId:root.id,rootId:root.id});
    const upscale=f.job({mode:'upscale',sourceId:clip.id,count:1},'completed');
    const hd=f.media(upscale,{kind:'video',sourceId:clip.id,rootId:root.id,origin:'upscale'});
    const page=f.page(), section=page.sections.find(s=>s.id===first.id)!;
    assert.equal(page.sections.length,2);
    assert.equal(sectionRequest(section).mode,'image');assert.equal(sectionRequest(section).prompt,'Paper boats');
    assert.equal((video.request as Generation).sectionId,first.id);
    assert.equal(hd.sectionId,first.id);
    const entries=promptGallery(page.sections,page.media,[]).find(s=>s.id===first.id)!.entries;
    assert.equal(entries.length,1);assert.equal(entries[0].kind==='media'&&entries[0].media.id,hd.id);
  }finally{f.close();}
});

test('clearing queue records preserves grouping, Load more and batch ordering', () => {
  const f=fixture();try {
    const job=f.job({},'completed'), first=f.media(job), second=f.media(job,{batchIndex:1});
    const more=f.job(sectionRequest(f.page().sections[0]),'completed'), third=f.media(more);
    f.db.exec('DELETE FROM jobs');initializePromptLibrary(f.db);
    const page=f.page();assert.equal(page.sections.length,1);
    assert.equal(sectionRequest(page.sections[0]).prompt,input.prompt);
    assert.deepEqual(promptGallery(page.sections,page.media,[])[0].entries.map(e=>e.kind==='media'&&e.media.id),[first.id,second.id,third.id]);
    assert.equal((f.job(sectionRequest(page.sections[0])).request as Generation).sectionId,job.id);
  }finally{f.close();}
});

test('uploaded starting frames remain visible but reference-only inputs stay out of the gallery', () => {
  const f=fixture();try {
    const source=f.media();f.media(undefined,{referenceOnly:true});f.media(undefined,{origin:'poster'});
    assert.equal(f.page().sections.length,1);
    assert.equal(f.page().sections[0].request,undefined);
    const job=f.job({mode:'video',sourceId:source.id,prompt:'Rock gently',count:1},'running');
    const page=f.page(), entries=promptGallery(page.sections,page.media,[job])[0].entries;
    assert.equal(entries.length,1);assert.equal(entries[0].kind==='media'&&entries[0].media.id,source.id);
    assert.equal((job.request as Generation).sectionId,source.id);
  }finally{f.close();}
});

test('empty cancelled sections disappear, failed prompts can be retried, partial outputs stay', () => {
  const f=fixture();try {
    f.job({},'cancelled');const failed=f.job({},'failed'), partial=f.job({},'cancelled');f.media(partial);
    assert.deepEqual(f.page().sections.map(s=>s.id),[partial.id,failed.id]);
    f.db.prepare('DELETE FROM jobs WHERE id=?').run(failed.id);
    assert.deepEqual(f.page().sections.map(s=>s.id),[partial.id]);
  }finally{f.close();}
});

test('older-prompt pagination stays stable across new prompts and Load more', () => {
  const f=fixture();try {
    const jobs=Array.from({length:16},()=>f.job());
    const first=listPromptLibrary(f.db,{limit:12}), second=listPromptLibrary(f.db,{before:first.nextCursor!});
    assert.equal(first.sections.length,12);assert.equal(second.sections.length,4);assert.equal(second.nextCursor,null);
    const newest=f.job(), extra=f.job(sectionRequest(second.sections.at(-1)!));
    const refreshed=listPromptLibrary(f.db,{through:second.endCursor!});
    assert.deepEqual(refreshed.sections.map(s=>s.id),[newest.id,...jobs.map(j=>j.id).reverse()]);
    assert.equal(refreshed.sections.at(-1)!.jobIds.at(-1),extra.id);
    f.db.prepare('DELETE FROM jobs WHERE id=?').run(jobs[0].id);
    assert.equal(listPromptLibrary(f.db,{through:second.endCursor!}).sections.length,17);
    assert.throws(()=>listPromptLibrary(f.db,{before:'invalid'}));
  }finally{f.close();}
});

test('existing libraries gain sections without losing assets or changing their generations', () => {
  const f=fixture();try {
    const job=f.job({},'completed'), root=f.media(job);
    const video=f.job({mode:'video',sourceId:root.id,count:1},'completed');
    const clip=f.media(video,{rootId:root.id,sourceId:root.id,kind:'video'});
    f.db.exec("DELETE FROM prompt_sections;DELETE FROM settings WHERE key='promptLibraryVersion';UPDATE jobs SET data=json_remove(data,'$.request.sectionId');UPDATE media SET data=json_remove(data,'$.sectionId','$.generation.sectionId')");
    initializePromptLibrary(f.db);
    const page=f.page();assert.equal(page.sections.length,1);assert.equal(page.sections[0].id,job.id);
    assert.deepEqual(new Set(page.media.map(m=>m.id)),new Set([root.id,clip.id]));
    assert.equal(page.sections[0].request?.prompt,input.prompt);
  }finally{f.close();}
});

test('an older worker finishing after the upgrade is included without restarting its job', () => {
  const f=fixture();try {
    const first=f.job({},'completed'), root=f.media(first);
    const more=f.job(sectionRequest(f.page().sections[0]),'completed'), late=f.media(more);
    f.db.prepare("UPDATE media SET data=json_remove(data,'$.sectionId') WHERE id=?").run(late.id);
    const page=f.page();assert.equal(page.sections.length,1);
    assert.deepEqual(new Set(page.media.map(m=>m.id)),new Set([root.id,late.id]));
    assert.ok(page.media.every(m=>m.sectionId===first.id));
  }finally{f.close();}
});
