import test, {before,beforeEach,after,afterEach,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// Shared-library fixtures only use explicitly selected disposable test storage.
export async function createLibraryFixture(){
  const directory=process.env.FROK_DATA_DIR;
  assert.ok(directory&&path.isAbsolute(directory));assert.match(directory,/[/\\]\.data[/\\][^/\\]*test[^/\\]*(?:[/\\]|$)/);
  process.env.FROK_PIPELINES_DIR=path.resolve('resources/pipelines');
  process.env.FROK_PIPELINE_HOME=path.join(directory,'pipeline-home');
  const registry=await import('../../src/lib/registry'),context=await import('../../src/lib/library');
  const {workerProtocolVersion}=await import('../../src/lib/worker-health');
  assert.equal(context.libraryDirectory(),path.join(directory,'library'),'A module loaded storage before the disposable fixture was configured.');
  context.libraryDatabase();
  registry.setServiceValue('workerProtocol',{pid:registry.serviceValue('workerPid',0),version:workerProtocolVersion});
  return {
    run:<T>(fn:()=>T)=>fn(),directory:context.libraryDirectory(),mediaDir:context.libraryMediaDir(),jobsDir:context.libraryJobsDir(),
    test:(name:string,fn:(t:TestContext)=>void|Promise<void>)=>test(name,fn),before,beforeEach,after,afterEach,
    request(url:string,init:RequestInit={}){const headers=new Headers();if(!['GET','HEAD'].includes(init.method??'GET')){headers.set('Origin',new URL(url).origin);headers.set('X-Frok-Request','1');}new Headers(init.headers).forEach((value,key)=>headers.set(key,value));return new Request(url,{...init,headers});},
    close(){context.closeLibraryDatabase();registry.registry.close();},
  };
}
