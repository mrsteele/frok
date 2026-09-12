import { createLibraryFixture } from './fixtures/library';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Media } from '../src/lib/types';

const root=fs.mkdtempSync(path.resolve('.data/media-publication-test-'));
process.env.FROK_DATA_DIR=root;process.env.FROK_ENV_FILE=path.join(root,'absent.env');
const fixture=await createLibraryFixture(),{test,beforeEach,after}=fixture;
const store=await import('../src/lib/db');
const {publishMedia,recoverMediaPublications}=await import('../src/lib/media-publication');
const {auditLibrary}=await import('../src/lib/library-audit');
const journals=path.join(fixture.directory,'publications');
const media=():Media=>{const id=randomUUID();return {id,filename:`${id}.jpg`,kind:'image',origin:'upload',prompt:'',enhancedPrompt:'',width:16,height:16,seed:0,favorite:false,createdAt:new Date().toISOString()};};
beforeEach(()=>{
  store.db.exec('DELETE FROM media; DELETE FROM jobs; DELETE FROM settings');
  for(const dir of [fixture.mediaDir,fixture.jobsDir,journals]){fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});}
});
after(()=>{fixture.close();fs.rmSync(root,{recursive:true,force:true});});

test('publishes uploaded bytes or validated job output with a matching record and clears its journal',()=>{
  const upload=media(),video={...media(),kind:'video' as const,origin:'generated' as const};video.filename=`${video.id}.mp4`;
  const staged=path.join(fixture.jobsDir,'finished.mp4');fs.writeFileSync(staged,'validated video');
  for(const [item,content] of [[upload,Buffer.from('uploaded image')],[video,staged]] as const){
    const saved=publishMedia(item,content);assert.ok(store.getMedia(saved.id));assert.ok(fs.existsSync(path.join(fixture.mediaDir,saved.filename)));
  }
  assert.equal(fs.existsSync(staged),false);assert.deepEqual(fs.readdirSync(journals),[]);
});

test('failed database registration removes the published file but keeps job-owned output for inspection',()=>{
  const item=media(),staged=path.join(fixture.jobsDir,'finished.jpg');fs.writeFileSync(staged,'validated output');
  store.db.exec("CREATE TRIGGER reject_media BEFORE INSERT ON media BEGIN SELECT RAISE(ABORT,'Synthetic registration failure'); END");
  try{assert.throws(()=>publishMedia(item,staged),/Synthetic registration failure/);}finally{store.db.exec('DROP TRIGGER reject_media');}
  assert.equal(store.getMedia(item.id),undefined);assert.equal(fs.existsSync(path.join(fixture.mediaDir,item.filename)),false);
  assert.ok(fs.existsSync(staged));assert.deepEqual(fs.readdirSync(journals),[]);
});

test('partial file writes leave neither a library record nor an orphan file',()=>{
  const item=media(),write=fs.writeFileSync;
  fs.writeFileSync=(...args)=>{if(String(args[0])===path.join(fixture.mediaDir,item.filename)){write(args[0],'partial');throw Error('Synthetic disk full');}return write(...args);};
  try{assert.throws(()=>publishMedia(item,Buffer.from('image')),/Synthetic disk full/);}finally{fs.writeFileSync=write;}
  assert.equal(store.getMedia(item.id),undefined);assert.equal(fs.existsSync(path.join(fixture.mediaDir,item.filename)),false);
});

test('recovery removes uncommitted publications, preserves committed files, and retries failed cleanup',()=>{
  for(const committed of [false,true]){
    const item=media(),destination=path.join(fixture.mediaDir,item.filename),journal=path.join(journals,`${item.id}.json`);
    fs.writeFileSync(destination,'interrupted output');fs.writeFileSync(journal,JSON.stringify({filename:item.filename}));
    if(committed)store.saveMedia(item);
    const remove=fs.rmSync;
    fs.rmSync=(...args)=>{if(String(args[0])===journal)throw Error('Synthetic access failure');return remove(...args);};
    try{assert.throws(recoverMediaPublications,/Synthetic access failure/);}finally{fs.rmSync=remove;}
    recoverMediaPublications();assert.equal(fs.existsSync(destination),committed);assert.equal(fs.existsSync(journal),false);
  }
});

test('publication cannot overwrite an existing asset or escape the media folder',()=>{
  const item=media();publishMedia(item,Buffer.from('keep'));
  assert.throws(()=>publishMedia(item,Buffer.from('replace')),/already exists/);
  assert.equal(fs.readFileSync(path.join(fixture.mediaDir,item.filename),'utf8'),'keep');
  assert.throws(()=>publishMedia({...media(),filename:'../outside.jpg'},Buffer.from('bad')),/Invalid/);
});

test('the read-only audit reports abandoned references, untracked files, missing inputs and recovery work',()=>{
  const ref={...media(),referenceOnly:true,createdAt:'2020-01-01'},missing=media(),untracked=media(),missingInput=randomUUID();
  publishMedia(ref,Buffer.from('reference'));
  store.saveMedia({...missing,generation:{mode:'reference',prompt:'',enhance:false,referenceIds:[missingInput],count:1,quality:'preview',duration:6,aspect:'1:1'}});
  fs.writeFileSync(path.join(fixture.mediaDir,untracked.filename),'untracked bytes');
  const untrackedJob=randomUUID();fs.mkdirSync(path.join(fixture.jobsDir,untrackedJob));
  fs.writeFileSync(path.join(journals,`${untracked.id}.json`),JSON.stringify({filename:untracked.filename}));
  const report=auditLibrary(fixture.directory);
  assert.equal(report.readOnly,true);assert.deepEqual(report.counts,{media:2,jobs:0});
  assert.deepEqual(report.unusedReferenceUploads,[{id:ref.id,filename:ref.filename,eligibleForCleanup:true}]);
  assert.deepEqual(report.untrackedMedia,[{filename:untracked.filename,bytes:15}]);
  assert.deepEqual(report.missingMedia,[{id:missing.id,filename:missing.filename}]);
  assert.deepEqual(report.missingInputs,[{owner:'media',id:missing.id,inputId:missingInput}]);
  assert.deepEqual(report.untrackedJobDirectories,[untrackedJob]);
  assert.equal(report.pendingRecovery.publications.length,1);
  assert.ok(fs.existsSync(path.join(fixture.mediaDir,untracked.filename)));assert.ok(store.getMedia(ref.id));
  const absent=path.join(root,'absent-library');assert.throws(()=>auditLibrary(absent));assert.equal(fs.existsSync(absent),false);
});
