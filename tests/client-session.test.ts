import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api,resetBrowserStorage} from '../src/lib/client-api';

function storage(){const values:Record<string,string>={};Object.defineProperties(values,{getItem:{value:(key:string)=>values[key]??null},setItem:{value:(key:string,value:string)=>{values[key]=value;}},removeItem:{value:(key:string)=>{delete values[key];}}});return values as unknown as Storage;}
test('shared-library client makes no identity bootstrap request and preserves recipes on upgrade',async t=>{
  const local=storage(),session=storage(),originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:local,sessionStorage:session,location:{replace(){}}}});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:local});
  t.after(()=>{for(const [name,descriptor] of [['window',originalWindow],['localStorage',originalStorage]] as const){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
  local.setItem('frok-browser-identity','retired');local.setItem('userPrompts','synthetic recipes');local.setItem('other-app','keep');session.setItem('frok-draft','draft');
  let epoch='initial',requests=0,reloads=0;
  window.location.replace=()=>{reloads++;};
  t.mock.method(globalThis,'fetch',async (target:string|URL|Request)=>{assert.equal(target,'/api/media');requests++;return Response.json({media:[]},{headers:{'X-Frok-Reset':epoch}});});
  await api('media');assert.equal(requests,1);assert.equal(local.getItem('frok-browser-identity'),null);assert.equal(local.getItem('userPrompts'),'synthetic recipes');
  epoch='after-reset';await assert.rejects(api('media'),/library was reset/);assert.equal(reloads,1);assert.equal(local.getItem('userPrompts'),null);assert.equal(session.getItem('frok-draft'),null);assert.equal(local.getItem('other-app'),'keep');
  resetBrowserStorage();assert.equal(local.getItem('frok-library-reset'),null);assert.equal(local.getItem('other-app'),'keep');
});
