import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertAppRequest,expireBrowserKeys} from '../src/lib/request-security';
test('local single-user requests retain host, cross-origin and mutation protections',()=>{
  const previous=process.env.FROK_ORIGIN;process.env.FROK_ORIGIN='http://127.0.0.1:3000';
  try {
    assert.doesNotThrow(()=>assertAppRequest(new Request('http://127.0.0.1:3000/api/media')));
    assert.doesNotThrow(()=>assertAppRequest(new Request('http://127.0.0.1:3000/api/library',{method:'DELETE',headers:{Origin:'http://127.0.0.1:3000','X-Frok-Request':'1'}})));
    for(const headers of [{Host:'evil.example'},{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}] as Record<string,string>[])assert.throws(()=>assertAppRequest(new Request('http://127.0.0.1:3000/api/media',{headers})),/host|origin/i);
    assert.throws(()=>assertAppRequest(new Request('http://127.0.0.1:3000/api/library',{method:'DELETE'})),/same-origin/);
    process.env.FROK_ORIGIN='https://remote.example';assert.throws(()=>assertAppRequest(new Request('https://remote.example/api/media')),/only local/);
  }finally{if(previous===undefined)delete process.env.FROK_ORIGIN;else process.env.FROK_ORIGIN=previous;}
});
test('retired Frok cookies expire without creating an identity or clearing unrelated cookies',()=>{
  const response=expireBrowserKeys(new Request('http://localhost',{headers:{Cookie:'frok_session=old; frok_session_3440=older; other=keep'}}),new Response());
  const cookies=response.headers.getSetCookie();assert.equal(cookies.length,2);for(const cookie of cookies)assert.match(cookie,/Max-Age=0/);assert.ok(!cookies.join('').includes('other'));
});
